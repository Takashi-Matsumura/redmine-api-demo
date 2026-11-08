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
      ? journals.filter((j) => j.notes && isAfterClose(j.created_on, closedOn)).length
      : 0;

  return {
    signal: detectReopenSignal(issue),
    status_changes: statusChanges,
    reopen_count: statusChanges.filter((c) => c.kind === "reopen").length,
    notes_after_close: notesAfterClose,
  };
}
