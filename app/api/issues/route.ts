import type { NextRequest } from "next/server";
import { getIssues, RedmineApiError, RedmineUrlValidationError } from "@/lib/redmine";

export async function GET(req: NextRequest) {
  const redmineUrl = req.headers.get("x-redmine-url")?.trim();
  const apiKey = req.headers.get("x-redmine-api-key")?.trim();

  if (!redmineUrl || !apiKey) {
    return Response.json(
      { error: "Redmine URLとAPIキーを入力してください" },
      { status: 400 },
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  const projectId = searchParams.get("project_id") ?? undefined;
  const statusId = searchParams.get("status_id") ?? undefined;
  const sort = searchParams.get("sort") ?? undefined;

  const limit = limitParam && /^\d+$/.test(limitParam) ? Number(limitParam) : undefined;
  const offset = offsetParam && /^\d+$/.test(offsetParam) ? Number(offsetParam) : undefined;

  try {
    const result = await getIssues(
      { redmineUrl, apiKey },
      { limit, offset, projectId, statusId, sort },
    );
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
        default:
          message = `Redmine からエラー応答がありました（HTTP ${err.status}）。接続元IP制限やネットワークの問題の可能性があります。`;
      }
      return Response.json(
        { error: message, status: err.status, body: excerpt },
        { status: err.status },
      );
    }

    console.error("Redmine issue list fetch failed:", err);
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました";
    return Response.json({ error: message }, { status: 500 });
  }
}
