import "server-only";
import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { RedmineAttachment, RedmineIssue } from "@/lib/redmine";

/** docx に載せる添付ファイル1件の扱い。zipName があれば同じフォルダに保存済み、なければ skippedReason を表示する。 */
export interface AttachmentEntry {
  attachment: RedmineAttachment;
  zipName?: string;
  skippedReason?: string;
}

const FONT = { ascii: "Yu Gothic", hAnsi: "Yu Gothic", eastAsia: "Yu Gothic", cs: "Yu Gothic" };

// XML 1.0 で使えない制御文字（タブ・改行以外）は docx を壊すため除去する
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

function clean(text: string): string {
  return text.replace(XML_INVALID, "");
}

/** 改行を含む文字列を、段落ごとの Paragraph 配列に変換する。 */
function multilineParagraphs(text: string | undefined, emptyLabel = "(なし)"): Paragraph[] {
  const body = clean(text ?? "").replace(/\r\n?/g, "\n");
  if (!body.trim()) {
    return [new Paragraph({ children: [new TextRun({ text: emptyLabel, color: "808080" })] })];
  }
  return body.split("\n").map((line) => new Paragraph({ children: [new TextRun(line)] }));
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };

function cell(text: string, opts?: { bold?: boolean; shade?: boolean; width?: number }): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts?.shade ? { fill: "F2F2F2" } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: clean(text), bold: opts?.bold })] })],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun(text)] });
}

/** チケット1件（journals・attachments 込み）を docx のバイナリに変換する。 */
export async function issueToDocx(
  issue: RedmineIssue,
  opts: { redmineBaseUrl: string; attachments: AttachmentEntry[] },
): Promise<Buffer> {
  const issueUrl = `${opts.redmineBaseUrl.replace(/\/+$/, "")}/issues/${issue.id}`;

  const meta: [string, string][] = [
    ["プロジェクト", issue.project.name],
    ["トラッカー", issue.tracker.name],
    ["ステータス", issue.status.name],
    ["優先度", issue.priority.name],
    ["起票者", issue.author.name],
    ["担当者", issue.assigned_to?.name ?? "未割当"],
    ["作成日時", formatDateTime(issue.created_on)],
    ["更新日時", formatDateTime(issue.updated_on)],
  ];

  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: meta.map(
      ([label, value]) =>
        new TableRow({ children: [cell(label, { bold: true, shade: true, width: 25 }), cell(value, { width: 75 })] }),
    ),
  });

  const attachmentSection: (Paragraph | Table)[] = [heading(`添付ファイル（${opts.attachments.length}件）`)];
  if (opts.attachments.length === 0) {
    attachmentSection.push(new Paragraph({ children: [new TextRun({ text: "(なし)", color: "808080" })] }));
  } else {
    attachmentSection.push(
      new Paragraph({
        children: [
          new TextRun({ text: "保存済みの添付は、この docx と同じフォルダに「保存名」で置かれています。", color: "595959" }),
        ],
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: ["保存名", "サイズ", "登録者", "登録日時", "説明"].map((h) => cell(h, { bold: true, shade: true })),
          }),
          ...opts.attachments.map(
            ({ attachment, zipName, skippedReason }) =>
              new TableRow({
                children: [
                  cell(zipName ?? `${attachment.filename}（未取得: ${skippedReason ?? "不明な理由"}）`),
                  cell(formatBytes(attachment.filesize)),
                  cell(attachment.author?.name ?? ""),
                  cell(formatDateTime(attachment.created_on)),
                  cell(attachment.description ?? ""),
                ],
              }),
          ),
        ],
      }),
    );
  }

  const notes = (issue.journals ?? []).filter((j) => j.notes && !j.private_notes);
  const commentSection: Paragraph[] = [heading(`コメント（${notes.length}件）`)];
  if (notes.length === 0) {
    commentSection.push(new Paragraph({ children: [new TextRun({ text: "(なし)", color: "808080" })] }));
  }
  for (const j of notes) {
    commentSection.push(
      new Paragraph({
        spacing: { before: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 1 } },
        children: [
          new TextRun({ text: `${formatDateTime(j.created_on)}　${clean(j.user?.name ?? "不明なユーザー")}`, bold: true }),
        ],
      }),
      ...multilineParagraphs(j.notes),
    );
  }

  const doc = new Document({
    creator: "redmine-api-demo",
    title: clean(`#${issue.id} ${issue.subject}`),
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(clean(`#${issue.id} ${issue.subject}`))] }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new ExternalHyperlink({ link: issueUrl, children: [new TextRun({ text: issueUrl, style: "Hyperlink" })] })],
          }),
          metaTable,
          heading("説明"),
          ...multilineParagraphs(issue.description),
          ...attachmentSection,
          ...commentSection,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
