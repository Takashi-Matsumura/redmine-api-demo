import type { NextRequest } from "next/server";
import { getIssueStatuses, getIssuesCreatedOrUpdated } from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";
import { readConnection } from "@/lib/connection";
import { monthToDateRange } from "@/lib/month";
import type { IssueListItem, IssueListResponse } from "@/lib/issue-list";
import { detectReopenSignal } from "@/lib/reopen";

/**
 * 対象月に作成または更新されたチケットを全件返す（全ステータス、id降順）。
 * 各チケットにはクローズ済みかどうか（is_closed）と、再開の判定（reopen_signal）を付ける。ページ送りは画面側で行う。
 */
export async function GET(req: NextRequest) {
  const conn = readConnection(req);
  if (conn instanceof Response) return conn;

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const range = /^\d{4}-\d{2}$/.test(month) ? monthToDateRange(month) : null;
  if (!range) {
    return Response.json(
      { error: "対象月（YYYY-MM形式）を指定してください" },
      { status: 400 },
    );
  }

  try {
    const [{ issues, truncated }, statuses] = await Promise.all([
      getIssuesCreatedOrUpdated(conn, range),
      getIssueStatuses(conn),
    ]);
    const closedByStatusId = new Map(statuses.map((s) => [s.id, s.is_closed]));

    const items: IssueListItem[] = issues.map((issue) => {
      // Redmine 5.1 以降は issue 内の status に is_closed が含まれる。無ければステータス一覧から判定する。
      const isClosed = issue.status.is_closed ?? closedByStatusId.get(issue.status.id) ?? null;
      return {
        ...issue,
        is_closed: isClosed,
        reopen_signal: detectReopenSignal({ ...issue, is_closed: isClosed }),
      };
    });

    const body: IssueListResponse = { issues: items, truncated };
    return Response.json(body);
  } catch (err) {
    return redmineErrorResponse(err, "Redmine issue list fetch failed");
  }
}
