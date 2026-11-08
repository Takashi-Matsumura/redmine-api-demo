import type { NextRequest } from "next/server";
import { getIssue, getIssueStatuses } from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";
import { readConnection } from "@/lib/connection";
import { analyzeReopen } from "@/lib/reopen";
import type { IssueDetailResponse } from "@/lib/issue-list";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/issue/[id]">,
) {
  const { id } = await ctx.params;

  if (!/^\d+$/.test(id)) {
    return Response.json(
      { error: `チケットIDは数字で指定してください（受け取った値: ${id}）` },
      { status: 400 },
    );
  }

  const conn = readConnection(req);
  if (conn instanceof Response) return conn;

  try {
    const [result, statuses] = await Promise.all([
      getIssue(id, conn),
      // ステータス一覧は再開判定の補助にのみ使うため、取得できなくても詳細表示は続ける
      getIssueStatuses(conn).catch((err) => {
        console.error("Redmine issue status fetch failed:", err);
        return null;
      }),
    ]);
    const issue = result.issue;
    const isClosed =
      issue.status.is_closed ??
      statuses?.find((s) => s.id === issue.status.id)?.is_closed ??
      null;

    const body: IssueDetailResponse = {
      ...result,
      is_closed: isClosed,
      reopen: analyzeReopen({ ...issue, is_closed: isClosed }, statuses),
    };
    return Response.json(body);
  } catch (err) {
    return redmineErrorResponse(err, "Redmine issue fetch failed", {
      404: "チケットが見つかりません（HTTP 404）。IDが存在しないか、閲覧権限がない可能性があります。",
    });
  }
}
