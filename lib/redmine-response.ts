import "server-only";
import { RedmineApiError, RedmineUrlValidationError } from "@/lib/redmine";

/** Redmine 関連のエラーを、既存3ルート共通のJSONエラーレスポンス形式に変換する。 */
export function redmineErrorResponse(
  err: unknown,
  logLabel: string,
  messages?: { 404?: string },
): Response {
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
        message =
          messages?.[404] ??
          `Redmine からエラー応答がありました（HTTP ${err.status}）。接続元IP制限やネットワークの問題の可能性があります。`;
        break;
      default:
        message = `Redmine からエラー応答がありました（HTTP ${err.status}）。接続元IP制限やネットワークの問題の可能性があります。`;
    }
    return Response.json(
      { error: message, status: err.status, body: excerpt },
      { status: err.status },
    );
  }

  console.error(`${logLabel}:`, err);
  const message = err instanceof Error ? err.message : "不明なエラーが発生しました";
  return Response.json({ error: message }, { status: 500 });
}
