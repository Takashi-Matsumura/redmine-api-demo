import type { RedmineIssueSummary } from "@/lib/redmine";

/**
 * 一覧 API（/api/issues）の応答型。画面（Client Component）からも参照するため、
 * server-only の lib/redmine.ts とは分けて型だけを置く。
 */
export type IssueListItem = RedmineIssueSummary & {
  /** クローズ済み（終了系ステータス）なら true。判定できなかった場合は null。 */
  is_closed: boolean | null;
};

export interface IssueListResponse {
  issues: IssueListItem[];
  /** 取得上限に達して一部のチケットを取得していない場合 true。 */
  truncated: boolean;
}
