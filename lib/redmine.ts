import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Redmine REST API との疎通確認用の最小クライアント。
 * 一覧取得・ページング・キャッシュは扱わない。チケット1件の取得のみ。
 */

export interface RedmineNamed {
  id: number;
  name: string;
}

export interface RedmineJournal {
  id: number;
  notes?: string;
  created_on: string;
  user?: RedmineNamed;
}

export interface RedmineIssue {
  id: number;
  subject: string;
  description?: string;
  project: RedmineNamed;
  tracker: RedmineNamed;
  status: RedmineNamed;
  priority: RedmineNamed;
  author: RedmineNamed;
  assigned_to?: RedmineNamed;
  created_on: string;
  updated_on: string;
  journals?: RedmineJournal[];
}

export interface RedmineIssueResponse {
  issue: RedmineIssue;
}

/** Redmine からの非 2xx レスポンスをステータスコードと本文つきで表現するエラー。 */
export class RedmineApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Redmine API responded with ${status}`);
    this.name = "RedmineApiError";
    this.status = status;
    this.body = body;
  }
}

/** 接続先 Redmine の情報。検証用のため画面から都度受け取る想定。 */
export interface RedmineConnection {
  redmineUrl: string;
  apiKey: string;
}

/** 入力された Redmine URL がプロトコル/接続先として不正な場合のエラー。クライアント起因なので 400 として扱う。 */
export class RedmineUrlValidationError extends Error {}

function isDisallowedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local（クラウドメタデータ含む）
  if (a === 0) return true;
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isDisallowedIPv4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isDisallowedIPv4(mapped[1]);
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
    return false;
  }
  return true;
}

/**
 * SSRF 対策: 接続先がプライベート/ループバック/リンクローカルアドレスでないことを検証する。
 * ホスト名は DNS 解決した実 IP で判定するため、社内ホスト名を騙った迂回も防ぐ。
 */
async function assertSafeRedmineUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RedmineUrlValidationError("Redmine URLの形式が不正です");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RedmineUrlValidationError("Redmine URLは http または https で指定してください");
  }

  const hostname = parsed.hostname;
  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new RedmineUrlValidationError("Redmine URLの名前解決に失敗しました");
  }

  if (addresses.length === 0 || addresses.some(isDisallowedIp)) {
    throw new RedmineUrlValidationError(
      "許可されていない接続先です（内部/ローカルアドレスへの接続はブロックされます）",
    );
  }

  return parsed;
}

/** チケット1件を journals 込みで取得する。 */
export async function getIssue(
  id: string,
  { redmineUrl, apiKey }: RedmineConnection,
): Promise<RedmineIssueResponse> {
  const parsed = await assertSafeRedmineUrl(redmineUrl);
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  const url = `${base}/issues/${id}.json?include=journals`;

  const res = await fetch(url, {
    headers: {
      "X-Redmine-API-Key": apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
    redirect: "manual",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new RedmineApiError(res.status, body);
  }

  return (await res.json()) as RedmineIssueResponse;
}
