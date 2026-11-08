import type { RedmineIssueResponse, RedmineIssueSummary } from "@/lib/redmine";
import type { ReopenAnalysis, ReopenSignal } from "@/lib/reopen";

/**
 * 一覧 API（/api/issues）・詳細 API（/api/issue/[id]）の応答型。画面（Client Component）からも参照するため、
 * server-only の lib/redmine.ts とは分けて型だけを置く。
 */
export type IssueListItem = RedmineIssueSummary & {
  /** クローズ済み（終了系ステータス）なら true。判定できなかった場合は null。 */
  is_closed: boolean | null;
  /** 再開済み／クローズ後に更新あり。該当しない・判定できない場合は null。 */
  reopen_signal: ReopenSignal | null;
};

export interface IssueListResponse {
  issues: IssueListItem[];
  /** 取得上限に達して一部のチケットを取得していない場合 true。 */
  truncated: boolean;
}

export interface IssueDetailResponse extends RedmineIssueResponse {
  /** クローズ済みかどうか。ステータス一覧を取得できず判定できない場合は null。 */
  is_closed: boolean | null;
  reopen: ReopenAnalysis;
}
