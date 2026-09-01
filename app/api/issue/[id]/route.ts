import type { NextRequest } from "next/server";
import { getIssue, RedmineApiError, RedmineUrlValidationError } from "@/lib/redmine";

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
    if (err instanceof RedmineUrlValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }

    if (err instanceof RedmineApiError) {
      const excerpt = err.body.slice(0, 500);
      let message: string;
      switch (err.status) {
        case 401:
        case 403:
          message = `Redmine への認証に失敗しました（HTTP ${err.status}）。REST API が無効化されているか、APIキーが不正な可能性があります。`;
          break;
        case 404:
          message = `チケットが見つかりません（HTTP 404）。IDが存在しないか、閲覧権限がない可能性があります。`;
          break;
        default:
          message = `Redmine からエラー応答がありました（HTTP ${err.status}）。接続元IP制限やネットワークの問題の可能性があります。`;
      }
      return Response.json(
        { error: message, status: err.status, body: excerpt },
        { status: err.status },
      );
    }

    console.error("Redmine issue fetch failed:", err);
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました";
    return Response.json({ error: message }, { status: 500 });
  }
}
