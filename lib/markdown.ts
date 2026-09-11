import type { RedmineIssue } from "@/lib/redmine";

export interface ExportMeta {
  redmineBaseUrl: string;
  month: string;
  from: string;
  to: string;
  closedOnly: boolean;
  excludedPrivateNotes: number;
  failures: { id: number; message: string }[];
  /** 件数上限（safety valve）で全件取得しきれなかった場合の { 総数, 取得数 }。 */
  truncated?: { totalCount: number; fetchedCount: number };
  exportedAt: string;
}

/** front matter の値として安全な文字列にする（改行除去・二重引用符エスケープ）。 */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

/**
 * description/notes 本文中の見出し記法・水平線をエスケープし、
 * 連結後のチケット区切り・見出し階層を壊さないようにする。
 * それ以外の変換（Textile→Markdown等）は行わない。
 */
function sanitizeBody(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) return `\\${line}`;
      if (/^(-{3,}|={3,})\s*$/.test(line.trim())) return `\\${line}`;
      return line;
    })
    .join("\n");
}

function formatIssueUrl(baseUrl: string, id: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/issues/${id}`;
}

function issueToMarkdown(issue: RedmineIssue, baseUrl: string): string {
  const lines: string[] = [];
  lines.push(`## #${issue.id} ${issue.subject}`);
  lines.push("");
  lines.push(`- URL: ${formatIssueUrl(baseUrl, issue.id)}`);
  lines.push(
    `- プロジェクト: ${issue.project.name} / トラッカー: ${issue.tracker.name} / ステータス: ${issue.status.name} / 優先度: ${issue.priority.name}`,
  );
  lines.push(
    `- 起票: ${issue.author.name}（${issue.created_on}） / 担当: ${issue.assigned_to?.name ?? "未割当"} / 最終更新: ${issue.updated_on}`,
  );
  lines.push("");
  lines.push("### 説明");
  lines.push("");
  lines.push(issue.description ? sanitizeBody(issue.description) : "(なし)");

  const notes = (issue.journals ?? []).filter(
    (j) => j.notes && !j.private_notes,
  );
  lines.push("");
  lines.push(`### コメント（${notes.length}件）`);
  for (const note of notes) {
    lines.push("");
    lines.push(`**${note.created_on} ${note.user?.name ?? "unknown"}**`);
    lines.push("");
    lines.push(sanitizeBody(note.notes ?? ""));
  }

  return lines.join("\n");
}

export function issuesToMarkdown(
  issues: RedmineIssue[],
  meta: ExportMeta,
): string {
  const filterDesc = `created_on ${meta.from}..${meta.to}${meta.closedOnly ? " / status:closed" : ""}`;

  const frontMatter = [
    "---",
    "source: redmine",
    `redmine_base_url: ${yamlString(meta.redmineBaseUrl)}`,
    `month: ${yamlString(meta.month)}`,
    `filter: ${yamlString(filterDesc)}`,
    `issue_count: ${issues.length}`,
    `excluded_private_notes: ${meta.excludedPrivateNotes}`,
    `failed_issue_count: ${meta.failures.length}`,
    ...(meta.truncated
      ? [
          `truncated: true`,
          `truncated_total_count: ${meta.truncated.totalCount}`,
          `truncated_fetched_count: ${meta.truncated.fetchedCount}`,
        ]
      : []),
    `exported_at: ${yamlString(meta.exportedAt)}`,
    "---",
    "",
  ].join("\n");

  const heading = `# Redmine ナレッジ ${meta.month}（${meta.closedOnly ? "完了" : "対象"}チケット ${issues.length}件）`;

  const body = issues.map((issue) => issueToMarkdown(issue, meta.redmineBaseUrl));

  const sections = [frontMatter, heading, "", body.join("\n\n---\n\n")];

  if (meta.failures.length > 0) {
    sections.push("\n---\n");
    sections.push("## 取得に失敗したチケット\n");
    sections.push(
      meta.failures
        .map((f) => `- #${f.id}: ${f.message}`)
        .join("\n"),
    );
  }

  if (meta.truncated) {
    sections.push("\n---\n");
    sections.push(
      `## 注意: 件数上限に達しました\n\n対象 ${meta.truncated.totalCount}件中 ${meta.truncated.fetchedCount}件のみ取得しました。`,
    );
  }

  return sections.join("\n") + "\n";
}
