import type { RedmineIssue } from "@/lib/redmine";
import { reopenSummaryText, statusChangeText, type ReopenAnalysis } from "@/lib/reopen";

export interface ExportMeta {
  redmineBaseUrl: string;
  month: string;
  from: string;
  to: string;
  closedOnly: boolean;
  excludedPrivateNotes: number;
  failures: { id: number; message: string }[];
  /** 件数上限（safety valve）で全件取得しきれなかった場合の取得数。 */
  truncated?: { fetchedCount: number };
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

function issueToMarkdown(
  issue: RedmineIssue,
  baseUrl: string,
  reopen: ReopenAnalysis | undefined,
): string {
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
  lines.push(
    `- 最終クローズ: ${issue.closed_on ?? "なし"} / 再開の検知: ${reopen ? reopenSummaryText(reopen) : "判定不可"}`,
  );
  lines.push("");
  lines.push("### 説明");
  lines.push("");
  lines.push(issue.description ? sanitizeBody(issue.description) : "(なし)");

  if (reopen && reopen.status_changes.length > 0) {
    lines.push("");
    lines.push(`### ステータス変更履歴（${reopen.status_changes.length}件）`);
    lines.push("");
    for (const c of reopen.status_changes) {
      lines.push(`- ${c.created_on} ${c.user?.name ?? "unknown"}: ${statusChangeText(c)}`);
    }
  }

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
  /** チケットID → 再開の検知結果。無いチケットは「判定不可」と出力する。 */
  reopenById: Map<number, ReopenAnalysis> = new Map(),
): string {
  const reopens = issues.map((i) => reopenById.get(i.id));
  const reopenedCount = reopens.filter((r) => r?.signal === "reopened").length;
  const updatedAfterCloseCount = reopens.filter((r) => r?.signal === "updated_after_close").length;
  const reopenedEverCount = reopens.filter((r) => (r?.reopen_count ?? 0) > 0).length;

  const filterDesc = `created_on or updated_on ${meta.from}..${meta.to}${meta.closedOnly ? " / status:closed" : ""}`;

  const frontMatter = [
    "---",
    "source: redmine",
    `redmine_base_url: ${yamlString(meta.redmineBaseUrl)}`,
    `month: ${yamlString(meta.month)}`,
    `filter: ${yamlString(filterDesc)}`,
    `issue_count: ${issues.length}`,
    `excluded_private_notes: ${meta.excludedPrivateNotes}`,
    `failed_issue_count: ${meta.failures.length}`,
    `reopened_issue_count: ${reopenedCount}`,
    `updated_after_close_issue_count: ${updatedAfterCloseCount}`,
    `reopened_ever_issue_count: ${reopenedEverCount}`,
    ...(meta.truncated
      ? [
          `truncated: true`,
          `truncated_fetched_count: ${meta.truncated.fetchedCount}`,
        ]
      : []),
    `exported_at: ${yamlString(meta.exportedAt)}`,
    "---",
    "",
  ].join("\n");

  const heading = `# Redmine ナレッジ ${meta.month}（${meta.closedOnly ? "完了" : "対象"}チケット ${issues.length}件）`;

  const body = issues.map((issue, i) => issueToMarkdown(issue, meta.redmineBaseUrl, reopens[i]));

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
      `## 注意: 件数上限に達しました\n\n件数上限に達したため ${meta.truncated.fetchedCount}件のみ取得しました。一部のチケットは含まれていません。`,
    );
  }

  return sections.join("\n") + "\n";
}
