import type { NextRequest } from "next/server";
import { getIssue } from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";
import { readConnection } from "@/lib/connection";

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
    const result = await getIssue(id, conn);
    return Response.json(result);
  } catch (err) {
    return redmineErrorResponse(err, "Redmine issue fetch failed", {
      404: "チケットが見つかりません（HTTP 404）。IDが存在しないか、閲覧権限がない可能性があります。",
    });
  }
}
