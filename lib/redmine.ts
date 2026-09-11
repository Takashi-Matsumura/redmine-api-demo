import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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

/** 一覧に含まれるチケット。journals は一覧取得時には含まれない。 */
export type RedmineIssueSummary = Omit<RedmineIssue, "journals">;

export interface RedmineIssueListResponse {
  issues: RedmineIssueSummary[];
  total_count: number;
  offset: number;
  limit: number;
}

/** 一覧取得時のフィルタ・ページング条件。 */
export interface RedmineIssueListParams {
  limit?: number;
  offset?: number;
  projectId?: string;
  statusId?: string;
  sort?: string;
  /** 起票日（created_on）の範囲フィルタ。両方指定時のみ有効。YYYY-MM-DD形式。 */
  createdOnFrom?: string;
  createdOnTo?: string;
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
 * 検証に使った IP をそのまま返し、実接続でホスト名を再解決させない
 * （再解決すると、検証後に DNS 応答を変える DNS リバインディングで迂回されうる）。
 */
async function assertSafeRedmineUrl(
  rawUrl: string,
): Promise<{ parsed: URL; address: string }> {
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

  return { parsed, address: addresses[0] };
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

interface PinnedResponse {
  status: number;
  body: string;
}

/**
 * assertSafeRedmineUrl で検証済みの IP アドレスに直接接続する。
 * ホスト名の再解決を一切行わないことで DNS リバインディングを防ぐ。
 * TLS 検証（SNI・証明書のホスト名照合）は本来のホスト名に対して行われるため、
 * 接続先を偽装される心配はない。
 */
function pinnedRequest(
  target: URL,
  address: string,
  headers: Record<string, string>,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const port = target.port ? Number(target.port) : isHttps ? 443 : 80;

    const req = requestFn(
      {
        hostname: address,
        port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { ...headers, Host: target.host },
        timeout: REQUEST_TIMEOUT_MS,
        ...(isHttps ? { servername: target.hostname } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;

        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("Redmine からの応答が大きすぎます"));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Redmine への接続がタイムアウトしました"));
    });
    req.on("error", reject);
    req.end();
  });
}

/** チケット1件を journals 込みで取得する。 */
export async function getIssue(
  id: string,
  { redmineUrl, apiKey }: RedmineConnection,
): Promise<RedmineIssueResponse> {
  const { parsed, address } = await assertSafeRedmineUrl(redmineUrl);
  const target = new URL(
    `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/issues/${id}.json?include=journals`,
  );

  const res = await pinnedRequest(target, address, {
    "X-Redmine-API-Key": apiKey,
    Accept: "application/json",
  });

  if (res.status < 200 || res.status >= 300) {
    throw new RedmineApiError(res.status, res.body);
  }

  return JSON.parse(res.body) as RedmineIssueResponse;
}

const DEFAULT_ISSUE_LIST_LIMIT = 25;
const MAX_ISSUE_LIST_LIMIT = 100;
/** 未指定時のデフォルト並び順。id降順（作成が新しい順）で「最新」を保証する。 */
const DEFAULT_ISSUE_LIST_SORT = "id:desc";
/**
 * 未指定時のデフォルトステータス。
 * Redmine の issues.json は status_id を省略すると「未完了」のみを返すため、
 * 完了済みチケットも含めた全件を返すよう明示的に指定する。
 */
const DEFAULT_ISSUE_LIST_STATUS = "*";

/** チケット一覧を取得する。 */
export async function getIssues(
  { redmineUrl, apiKey }: RedmineConnection,
  {
    limit,
    offset,
    projectId,
    statusId,
    sort,
    createdOnFrom,
    createdOnTo,
  }: RedmineIssueListParams = {},
): Promise<RedmineIssueListResponse> {
  const { parsed, address } = await assertSafeRedmineUrl(redmineUrl);
  const target = new URL(
    `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/issues.json`,
  );

  const safeLimit = Math.min(
    Math.max(1, limit ?? DEFAULT_ISSUE_LIST_LIMIT),
    MAX_ISSUE_LIST_LIMIT,
  );
  target.searchParams.set("limit", String(safeLimit));
  target.searchParams.set("offset", String(Math.max(0, offset ?? 0)));
  target.searchParams.set("sort", sort || DEFAULT_ISSUE_LIST_SORT);
  if (projectId) target.searchParams.set("project_id", projectId);
  target.searchParams.set("status_id", statusId || DEFAULT_ISSUE_LIST_STATUS);
  if (createdOnFrom && createdOnTo) {
    target.searchParams.append("f[]", "created_on");
    target.searchParams.set("op[created_on]", "><");
    target.searchParams.append("v[created_on][]", createdOnFrom);
    target.searchParams.append("v[created_on][]", createdOnTo);
  }

  const res = await pinnedRequest(target, address, {
    "X-Redmine-API-Key": apiKey,
    Accept: "application/json",
  });

  if (res.status < 200 || res.status >= 300) {
    throw new RedmineApiError(res.status, res.body);
  }

  return JSON.parse(res.body) as RedmineIssueListResponse;
}
