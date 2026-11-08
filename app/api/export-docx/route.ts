import type { NextRequest } from "next/server";
import JSZip from "jszip";
import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  downloadAttachment,
  getIssuesCreatedOrUpdated,
  getIssuesDetailed,
  type RedmineConnection,
  type RedmineIssue,
} from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";
import { monthToDateRange } from "@/lib/month";
import { issueToDocx, type AttachmentEntry } from "@/lib/docx";
import { sanitizeFileName, UniqueNamer } from "@/lib/filename";

// 添付ファイルのダウンロードを含むため、既定のタイムアウトに触れないようにする。
export const maxDuration = 300;

/** 1回のエクスポートで取得する添付ファイルの合計サイズ上限（1GB）。 */
const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
const ISSUE_CONCURRENCY = 4;
/** docx ファイル名に入れる件名の最大文字数（SharePoint のパス長制限への配慮）。 */
const SUBJECT_MAX_LENGTH = 50;

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/**
 * 対象月に作成または更新されたクローズ済みチケットを、チケットごとの docx と添付ファイルにまとめた Zip で返す。
 *
 * redmine-YYYY-MM.zip
 * └─ redmine-YYYY-MM/
 *    └─ <チケットID>/
 *       ├─ <チケットID>_<件名>.docx
 *       └─ <添付ファイル>...
 */
export async function GET(req: NextRequest) {
  const redmineUrl = req.headers.get("x-redmine-url")?.trim();
  const apiKey = req.headers.get("x-redmine-api-key")?.trim();

  if (!redmineUrl || !apiKey) {
    return Response.json(
      { error: "Redmine URLとAPIキーを入力してください" },
      { status: 400 },
    );
  }

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const range = /^\d{4}-\d{2}$/.test(month) ? monthToDateRange(month) : null;
  if (!range) {
    return Response.json(
      { error: "対象月（YYYY-MM形式）を指定してください" },
      { status: 400 },
    );
  }

  const conn: RedmineConnection = { redmineUrl, apiKey };

  try {
    const { issues: summaries, truncated } = await getIssuesCreatedOrUpdated(
      conn,
      range,
      { closedOnly: true },
    );

    if (summaries.length === 0) {
      return Response.json(
        { error: `${month} に作成・更新されたクローズ済みチケットはありません` },
        { status: 404 },
      );
    }

    const { issues, failures } = await getIssuesDetailed(
      conn,
      summaries.map((s) => s.id),
      { include: ["journals", "attachments"] },
    );

    const rootFolder = `redmine-${month}`;
    const zip = new JSZip();
    let reservedBytes = 0;
    let skippedAttachments = 0;

    async function addIssue(issue: RedmineIssue): Promise<void> {
      const folder = `${rootFolder}/${issue.id}`;
      const namer = new UniqueNamer();
      const docxName = namer.take(
        `${sanitizeFileName(`${issue.id}_${issue.subject}`, {
          maxLength: SUBJECT_MAX_LENGTH + String(issue.id).length + 1,
          keepExtension: false,
          fallback: String(issue.id),
        })}.docx`,
      );

      const entries: AttachmentEntry[] = [];
      for (const attachment of issue.attachments ?? []) {
        if (attachment.filesize > DEFAULT_MAX_ATTACHMENT_BYTES) {
          entries.push({
            attachment,
            skippedReason: `1ファイルの上限（${formatBytes(DEFAULT_MAX_ATTACHMENT_BYTES)}）超過`,
          });
          skippedAttachments += 1;
          continue;
        }
        if (reservedBytes + attachment.filesize > MAX_TOTAL_ATTACHMENT_BYTES) {
          entries.push({
            attachment,
            skippedReason: `エクスポート全体の上限（${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}）超過`,
          });
          skippedAttachments += 1;
          continue;
        }

        // 並行実行中の他チケットと合わせて上限を超えないよう、取得前にサイズを確保する
        reservedBytes += attachment.filesize;
        try {
          const data = await downloadAttachment(attachment.id, conn);
          const zipName = namer.take(
            sanitizeFileName(attachment.filename, { fallback: `attachment-${attachment.id}` }),
          );
          zip.file(`${folder}/${zipName}`, data);
          entries.push({ attachment, zipName });
        } catch (err) {
          reservedBytes -= attachment.filesize;
          const message = err instanceof Error ? err.message : "不明なエラー";
          entries.push({ attachment, skippedReason: `取得失敗（${message}）` });
          skippedAttachments += 1;
        }
      }

      const docx = await issueToDocx(issue, { redmineBaseUrl: redmineUrl!, attachments: entries });
      zip.file(`${folder}/${docxName}`, docx);
    }

    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < issues.length) {
        const issue = issues[cursor];
        cursor += 1;
        await addIssue(issue);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(ISSUE_CONCURRENCY, issues.length) }, worker),
    );

    // docx・画像・Office ファイルの多くは既に圧縮済みのため、再圧縮せず格納のみ行う（大容量時の処理時間短縮）
    const body = await zip.generateAsync({ type: "uint8array", compression: "STORE" });

    return new Response(body as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${rootFolder}.zip"`,
        "X-Export-Issue-Count": String(issues.length),
        "X-Export-Failed-Issues": failures.map((f) => f.id).join(","),
        "X-Export-Skipped-Attachments": String(skippedAttachments),
        "X-Export-Truncated": truncated ? "1" : "0",
      },
    });
  } catch (err) {
    return redmineErrorResponse(err, "Redmine docx export failed");
  }
}
