import type { NextRequest } from "next/server";
import JSZip from "jszip";
import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  downloadAttachment,
  getIssuesCreatedOrUpdated,
  getIssuesDetailed,
  isValidRedmineId,
  type RedmineIssue,
} from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";
import { readConnection } from "@/lib/connection";
import { monthToDateRange } from "@/lib/month";
import { issueToDocx, type AttachmentEntry } from "@/lib/docx";
import { sanitizeFileName, UniqueNamer } from "@/lib/filename";

// 添付ファイルのダウンロードを含むため、既定のタイムアウトに触れないようにする。
export const maxDuration = 300;

/** 1回のエクスポートで取得する添付ファイルの合計サイズ上限（1GB）。実際に受信したバイト数で数える。 */
const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
/** 1回のエクスポートで取得する添付ファイルの件数上限。 */
const MAX_ATTACHMENT_COUNT = 5000;
const ISSUE_CONCURRENCY = 4;
/** docx ファイル名に入れる件名の最大文字数（SharePoint のパス長制限への配慮）。 */
const SUBJECT_MAX_LENGTH = 50;

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/**
 * 対象月に作成または更新されたチケットを、チケットごとの docx と添付ファイルにまとめた Zip で返す。
 * closed_only=1 の場合はクローズ済みのチケットのみを対象にする。
 *
 * redmine-YYYY-MM.zip
 * └─ redmine-YYYY-MM/
 *    └─ <チケットID>/
 *       ├─ <チケットID>_<件名>.docx
 *       └─ <添付ファイル>...
 */
export async function GET(req: NextRequest) {
  const connOrError = readConnection(req);
  if (connOrError instanceof Response) return connOrError;
  const conn = connOrError;

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const range = /^\d{4}-\d{2}$/.test(month) ? monthToDateRange(month) : null;
  if (!range) {
    return Response.json(
      { error: "対象月（YYYY-MM形式）を指定してください" },
      { status: 400 },
    );
  }

  try {
    const closedOnly = req.nextUrl.searchParams.get("closed_only") === "1";
    const { issues: summaries, truncated } = await getIssuesCreatedOrUpdated(
      conn,
      range,
      { closedOnly },
    );

    if (summaries.length === 0) {
      return Response.json(
        {
          error: `${month} に作成・更新された${closedOnly ? "クローズ済みの" : ""}チケットはありません`,
        },
        { status: 404 },
      );
    }

    // 一覧の応答に正の整数でない ID が含まれていれば、取得に失敗したものとして扱う
    const invalidIdCount = summaries.filter((s) => !isValidRedmineId(s.id)).length;
    const { issues, failures } = await getIssuesDetailed(
      conn,
      summaries.map((s) => s.id).filter(isValidRedmineId),
      { include: ["journals", "attachments"] },
    );

    const rootFolder = `redmine-${month}`;
    const zip = new JSZip();
    /** 取得中の分（上限まで確保した量）と取得済みの分（実際のバイト数）の合計。 */
    let reservedBytes = 0;
    let attachmentCount = 0;
    let skippedAttachments = 0;

    async function addIssue(issue: RedmineIssue): Promise<void> {
      // getIssuesDetailed で要求した ID と一致することを確認済みだが、パスに使う前に念のため再確認する
      if (!isValidRedmineId(issue.id)) return;
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
        // 申告サイズは Redmine の応答なので信用しない。判定の目安にだけ使い、実際の上限は受信バイト数で守る
        const declaredSize =
          typeof attachment.filesize === "number" && Number.isFinite(attachment.filesize) && attachment.filesize >= 0
            ? attachment.filesize
            : 0;

        if (!isValidRedmineId(attachment.id)) {
          entries.push({ attachment, skippedReason: "添付IDが不正" });
          skippedAttachments += 1;
          continue;
        }
        if (attachmentCount >= MAX_ATTACHMENT_COUNT) {
          entries.push({
            attachment,
            skippedReason: `エクスポート全体の件数上限（${MAX_ATTACHMENT_COUNT}件）超過`,
          });
          skippedAttachments += 1;
          continue;
        }
        if (declaredSize > DEFAULT_MAX_ATTACHMENT_BYTES) {
          entries.push({
            attachment,
            skippedReason: `1ファイルの上限（${formatBytes(DEFAULT_MAX_ATTACHMENT_BYTES)}）超過`,
          });
          skippedAttachments += 1;
          continue;
        }
        const remaining = MAX_TOTAL_ATTACHMENT_BYTES - reservedBytes;
        if (declaredSize > remaining || remaining <= 0) {
          entries.push({
            attachment,
            skippedReason: `エクスポート全体の上限（${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}）超過`,
          });
          skippedAttachments += 1;
          continue;
        }

        // 受信できる最大量（1ファイルの上限と全体の残りの小さい方）を取得前に確保する。
        // 申告サイズより大きなデータが返されても、確保した量を超えた時点で受信を打ち切るため、
        // 並行実行中の他チケットと合わせても全体の上限を超えない。
        const allowance = Math.min(DEFAULT_MAX_ATTACHMENT_BYTES, remaining);
        reservedBytes += allowance;
        attachmentCount += 1;
        try {
          const data = await downloadAttachment(attachment.id, conn, { maxBytes: allowance });
          // 確保した量のうち、実際に受信しなかった分を戻す
          reservedBytes -= allowance - data.length;
          const zipName = namer.take(
            sanitizeFileName(attachment.filename, { fallback: `attachment-${attachment.id}` }),
          );
          zip.file(`${folder}/${zipName}`, data);
          entries.push({ attachment, zipName });
        } catch (err) {
          reservedBytes -= allowance;
          const message = err instanceof Error ? err.message : "不明なエラー";
          entries.push({ attachment, skippedReason: `取得失敗（${message}）` });
          skippedAttachments += 1;
        }
      }

      const docx = await issueToDocx(issue, { redmineBaseUrl: conn.redmineUrl, attachments: entries });
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
        "X-Export-Invalid-Issues": String(invalidIdCount),
        "X-Export-Skipped-Attachments": String(skippedAttachments),
        "X-Export-Truncated": truncated ? "1" : "0",
      },
    });
  } catch (err) {
    return redmineErrorResponse(err, "Redmine docx export failed");
  }
}
