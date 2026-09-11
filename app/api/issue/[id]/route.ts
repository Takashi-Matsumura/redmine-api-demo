import type { NextRequest } from "next/server";
import { getIssue } from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";

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

  const redmineUrl = req.headers.get("x-redmine-url")?.trim();
  const apiKey = req.headers.get("x-redmine-api-key")?.trim();

  if (!redmineUrl || !apiKey) {
    return Response.json(
      { error: "Redmine URLとAPIキーを入力してください" },
      { status: 400 },
    );
  }

  try {
    const result = await getIssue(id, { redmineUrl, apiKey });
    return Response.json(result);
  } catch (err) {
    return redmineErrorResponse(err, "Redmine issue fetch failed", {
      404: "チケットが見つかりません（HTTP 404）。IDが存在しないか、閲覧権限がない可能性があります。",
    });
  }
}
