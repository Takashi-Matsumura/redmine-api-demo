import "server-only";
import type { RedmineConnection } from "@/lib/redmine";
import { SAMPLE_REDMINE_URL } from "@/lib/sample-data";

/**
 * リクエストヘッダから接続先を読み取る。各 Route Handler 共通。
 * `X-Redmine-Sample: 1` の場合は Redmine に接続せず、開発用のサンプルデータを使う。
 * 入力が足りない場合は、そのまま返せる 400 レスポンスを返す。
 */
export function readConnection(req: Request): RedmineConnection | Response {
  if (req.headers.get("x-redmine-sample") === "1") {
    return { redmineUrl: SAMPLE_REDMINE_URL, apiKey: "", sample: true };
  }

  const redmineUrl = req.headers.get("x-redmine-url")?.trim();
  const apiKey = req.headers.get("x-redmine-api-key")?.trim();
  if (!redmineUrl || !apiKey) {
    return Response.json(
      { error: "Redmine URLとAPIキーを入力してください" },
      { status: 400 },
    );
  }
  return { redmineUrl, apiKey };
}
