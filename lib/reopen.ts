import type { RedmineJournal, RedmineNamed } from "@/lib/redmine";

/**
 * クローズ後の再開を検知するための判定。画面（Client Component）とAPIルートの両方から使うため、
 * server-only のモジュールには依存しない。
 *
 * - reopened: 現在は未完了だが closed_on がある（一度クローズされた後に再開された）
 * - updated_after_close: 現在はクローズ済みだが、最後のクローズより後に更新がある（再開の兆候）
 */
export type ReopenSignal = "reopened" | "updated_after_close";

/**
 * クローズ時、Redmine は closed_on に updated_on と同じ時刻を入れる。
 * 古いデータ（Redmine 3.0 への移行時に履歴から補完された closed_on）では秒単位でずれることがあるため、
 * この範囲内の差は「クローズ後の更新」とみなさない。
 */
const CLOSE_TOLERANCE_MS = 60 * 1000;

function isAfterClose(iso: string, closedOn: string): boolean {
  const t = Date.parse(iso);
  const c = Date.parse(closedOn);
  if (Number.isNaN(t) || Number.isNaN(c)) return false;
  return t - c > CLOSE_TOLERANCE_MS;
}

export function detectReopenSignal(issue: {
  is_closed: boolean | null;
  closed_on?: string | null;
  updated_on: string;
}): ReopenSignal | null {
  if (!issue.closed_on || issue.is_closed === null) return null;
  if (!issue.is_closed) return "reopened";
  return isAfterClose(issue.updated_on, issue.closed_on) ? "updated_after_close" : null;
}

export interface StatusRef {
  id: number;
  name: string;
  /** ステータス一覧で見つからなかった場合は null。 */
  is_closed: boolean | null;
}

/** journals から読み取ったステータス変更1件。 */
export interface StatusChange {
  journal_id: number;
  created_on: string;
  user?: RedmineNamed;
  from: StatusRef | null;
  to: StatusRef | null;
  /** reopen: クローズ→未完了、close: 未完了→クローズ、other: それ以外 */
  kind: "reopen" | "close" | "other";
}

export interface ReopenAnalysis {
  /** 一覧と同じ判定（closed_on と updated_on による）。 */
  signal: ReopenSignal | null;
  /** journals のステータス変更（古い順）。 */
  status_changes: StatusChange[];
  /** クローズ→未完了の変更回数。 */
  reopen_count: number;
  /** 現在クローズ済みの場合、最後のクローズより後に付いたコメントの数。 */
  notes_after_close: number;
}

/**
 * チケット詳細の journals からステータス変更とクローズ後のコメントを読み取る。
 * statuses が無い（ステータス一覧を取得できなかった）場合は、クローズかどうかを判定できないため kind は other になる。
 */
export function analyzeReopen(
  issue: {
    is_closed: boolean | null;
    closed_on?: string | null;
    updated_on: string;
    journals?: RedmineJournal[];
  },
  statuses: { id: number; name: string; is_closed: boolean }[] | null,
  opts?: { excludePrivateNotes?: boolean },
): ReopenAnalysis {
  const byId = new Map((statuses ?? []).map((s) => [String(s.id), s]));
  const toRef = (value: string | null | undefined): StatusRef | null => {
    if (value == null || value === "") return null;
    const s = byId.get(value);
    return s
      ? { id: s.id, name: s.name, is_closed: s.is_closed }
      : { id: Number(value), name: `ステータスID ${value}`, is_closed: null };
  };

  const journals = [...(issue.journals ?? [])].sort(
    (a, b) => Date.parse(a.created_on) - Date.parse(b.created_on),
  );

  const statusChanges: StatusChange[] = [];
  for (const j of journals) {
    for (const d of j.details ?? []) {
      if (d.property !== "attr" || d.name !== "status_id") continue;
      const from = toRef(d.old_value);
      const to = toRef(d.new_value);
      const kind =
        from?.is_closed === true && to?.is_closed === false
          ? "reopen"
          : from?.is_closed === false && to?.is_closed === true
            ? "close"
            : "other";
      statusChanges.push({
        journal_id: j.id,
        created_on: j.created_on,
        user: j.user,
        from,
        to,
        kind,
      });
    }
  }

  const closedOn = issue.closed_on;
  const notesAfterClose =
    issue.is_closed === true && closedOn
      ? journals.filter(
          (j) =>
            j.notes &&
            !(opts?.excludePrivateNotes && j.private_notes) &&
            isAfterClose(j.created_on, closedOn),
        ).length
      : 0;

  return {
    signal: detectReopenSignal(issue),
    status_changes: statusChanges,
    reopen_count: statusChanges.filter((c) => c.kind === "reopen").length,
    notes_after_close: notesAfterClose,
  };
}

/** 出力（docx / Markdown）向けの、再開の検知結果を1行で表した文。 */
export function reopenSummaryText(reopen: ReopenAnalysis): string {
  const parts: string[] = [];
  if (reopen.signal === "reopened") parts.push("再開済み（クローズ後に未完了へ戻されています）");
  if (reopen.signal === "updated_after_close") parts.push("クローズ後に更新あり（再開の兆候）");
  if (reopen.reopen_count > 0) parts.push(`再開${reopen.reopen_count}回`);
  if (reopen.notes_after_close > 0) parts.push(`クローズ後のコメント${reopen.notes_after_close}件`);
  return parts.length > 0 ? parts.join(" / ") : "なし";
}

/** ステータス変更1件を「旧 → 新」の文にする。 */
export function statusChangeText(change: StatusChange): string {
  const name = (r: StatusRef | null) => r?.name ?? "(なし)";
  const mark = change.kind === "reopen" ? "（再開）" : change.kind === "close" ? "（クローズ）" : "";
  return `${name(change.from)} → ${name(change.to)}${mark}`;
}

/**
 * 出力用に、チケットごとの再開の検知結果を求める。
 * 出力にはプライベート注記を含めないため、クローズ後のコメント数からも除く。
 * statuses が null（ステータス一覧を取得できなかった）でも、Redmine 5.1 以降は issue 内の is_closed で判定できる。
 */
export function analyzeReopenForExport(
  issue: {
    status: { id: number; is_closed?: boolean };
    closed_on?: string | null;
    updated_on: string;
    journals?: RedmineJournal[];
  },
  statuses: { id: number; name: string; is_closed: boolean }[] | null,
): ReopenAnalysis {
  const isClosed =
    issue.status.is_closed ?? statuses?.find((s) => s.id === issue.status.id)?.is_closed ?? null;
  return analyzeReopen({ ...issue, is_closed: isClosed }, statuses, { excludePrivateNotes: true });
}
