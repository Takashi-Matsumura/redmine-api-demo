import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * Redmine REST API クライアント。
 * チケット一覧・詳細・ステータス一覧の取得と、添付ファイルのダウンロードを扱う。
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
  /** true の場合、閲覧権限のある一部ユーザーのみに公開される注記。エクスポートでは除外する。 */
  private_notes?: boolean;
}

export interface RedmineAttachment {
  id: number;
  filename: string;
  filesize: number;
  content_type?: string;
  description?: string;
  /** Redmine が返すダウンロードURL。接続先検証のため使わず、ID からURLを組み立てる。 */
  content_url?: string;
  author?: RedmineNamed;
  created_on: string;
}

/** チケットのステータス。is_closed は Redmine 5.1 以降のみ issue 内に含まれる。 */
export interface RedmineIssueStatusRef extends RedmineNamed {
  is_closed?: boolean;
}

export interface RedmineIssue {
  id: number;
  subject: string;
  description?: string;
  project: RedmineNamed;
  tracker: RedmineNamed;
  status: RedmineIssueStatusRef;
  priority: RedmineNamed;
  author: RedmineNamed;
  assigned_to?: RedmineNamed;
  created_on: string;
  updated_on: string;
  journals?: RedmineJournal[];
  attachments?: RedmineAttachment[];
}

export interface RedmineIssueResponse {
  issue: RedmineIssue;
}

/** 一覧に含まれるチケット。journals / attachments は一覧取得時には含まれない。 */
export type RedmineIssueSummary = Omit<RedmineIssue, "journals" | "attachments">;

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
  /** 更新日（updated_on）の範囲フィルタ。両方指定時のみ有効。YYYY-MM-DD形式。 */
  updatedOnFrom?: string;
  updatedOnTo?: string;
  /**
   * true の場合、クローズ済み（終了系）ステータスのみに絞る。
   * createdOnFrom/createdOnTo と同じ f[]/op[]/v[] 形式で指定する必要がある。
   * Redmine は params[:f] が存在すると status_id の短縮フィルタを無視するため、
   * statusId と併用しても意図通りには絞り込めない。
   */
  closedOnly?: boolean;
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
  body: Buffer;
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
  maxBytes: number = MAX_RESPONSE_BYTES,
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
          if (total > maxBytes) {
            req.destroy(new Error("Redmine からの応答が大きすぎます"));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
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

/** 入力された Redmine URL の末尾スラッシュを除いたベースURL（サブディレクトリ運用を考慮）。 */
function redmineBase(parsed: URL): string {
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function assertOk(res: PinnedResponse): void {
  if (res.status < 200 || res.status >= 300) {
    throw new RedmineApiError(res.status, res.body.toString("utf-8"));
  }
}

/** チケット1件を取得する。既定では journals を含める。 */
export async function getIssue(
  id: string,
  { redmineUrl, apiKey }: RedmineConnection,
  opts?: { include?: ("journals" | "attachments")[] },
): Promise<RedmineIssueResponse> {
  const { parsed, address } = await assertSafeRedmineUrl(redmineUrl);
  const include = (opts?.include ?? ["journals"]).join(",");
  const target = new URL(
    `${redmineBase(parsed)}/issues/${encodeURIComponent(id)}.json?include=${include}`,
  );

  const res = await pinnedRequest(target, address, {
    "X-Redmine-API-Key": apiKey,
    Accept: "application/json",
  });
  assertOk(res);

  return JSON.parse(res.body.toString("utf-8")) as RedmineIssueResponse;
}

export interface RedmineIssueStatus {
  id: number;
  name: string;
  is_closed: boolean;
}

/** ステータス一覧（終了系かどうか＝is_closed を含む）を取得する。 */
export async function getIssueStatuses({
  redmineUrl,
  apiKey,
}: RedmineConnection): Promise<RedmineIssueStatus[]> {
  const { parsed, address } = await assertSafeRedmineUrl(redmineUrl);
  const target = new URL(`${redmineBase(parsed)}/issue_statuses.json`);

  const res = await pinnedRequest(target, address, {
    "X-Redmine-API-Key": apiKey,
    Accept: "application/json",
  });
  assertOk(res);

  const body = JSON.parse(res.body.toString("utf-8")) as {
    issue_statuses: { id: number; name: string; is_closed?: boolean }[];
  };
  return body.issue_statuses.map((s) => ({
    id: s.id,
    name: s.name,
    is_closed: Boolean(s.is_closed),
  }));
}

/** 添付ファイル1件の既定サイズ上限（100MB）。 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/**
 * 添付ファイルの本体をダウンロードする。
 * SSRF 対策として、Redmine が返す content_url（別ホストを指しうる）は使わず、
 * 入力された Redmine URL と添付ID から `/attachments/download/:id` を組み立てる。
 * リダイレクトは追わない（ログイン画面等へのリダイレクトはエラーとして扱う）。
 */
export async function downloadAttachment(
  attachmentId: number,
  { redmineUrl, apiKey }: RedmineConnection,
  opts?: { maxBytes?: number },
): Promise<Buffer> {
  const { parsed, address } = await assertSafeRedmineUrl(redmineUrl);
  const target = new URL(
    `${redmineBase(parsed)}/attachments/download/${encodeURIComponent(String(attachmentId))}`,
  );

  const res = await pinnedRequest(
    target,
    address,
    { "X-Redmine-API-Key": apiKey },
    opts?.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES,
  );
  assertOk(res);
  return res.body;
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
    updatedOnFrom,
    updatedOnTo,
    closedOnly,
  }: RedmineIssueListParams = {},
): Promise<RedmineIssueListResponse> {
  const { parsed, address } = await assertSafeRedmineUrl(redmineUrl);
  const target = new URL(`${redmineBase(parsed)}/issues.json`);

  const safeLimit = Math.min(
    Math.max(1, limit ?? DEFAULT_ISSUE_LIST_LIMIT),
    MAX_ISSUE_LIST_LIMIT,
  );
  target.searchParams.set("limit", String(safeLimit));
  target.searchParams.set("offset", String(Math.max(0, offset ?? 0)));
  target.searchParams.set("sort", sort || DEFAULT_ISSUE_LIST_SORT);
  if (projectId) target.searchParams.set("project_id", projectId);

  const hasAdvancedFilter = Boolean(
    (createdOnFrom && createdOnTo) || (updatedOnFrom && updatedOnTo) || closedOnly,
  );
  // Redmine は f[] を1つでも渡すと status_id の短縮フィルタを無視するため、
  // f[] を使うリクエストでは status_id を素通しせず f[] 形式に統一する。
  if (!hasAdvancedFilter) {
    target.searchParams.set("status_id", statusId || DEFAULT_ISSUE_LIST_STATUS);
  }
  if (createdOnFrom && createdOnTo) {
    target.searchParams.append("f[]", "created_on");
    target.searchParams.set("op[created_on]", "><");
    target.searchParams.append("v[created_on][]", createdOnFrom);
    target.searchParams.append("v[created_on][]", createdOnTo);
  }
  if (updatedOnFrom && updatedOnTo) {
    target.searchParams.append("f[]", "updated_on");
    target.searchParams.set("op[updated_on]", "><");
    target.searchParams.append("v[updated_on][]", updatedOnFrom);
    target.searchParams.append("v[updated_on][]", updatedOnTo);
  }
  if (closedOnly) {
    target.searchParams.append("f[]", "status_id");
    target.searchParams.set("op[status_id]", "c");
  }

  const res = await pinnedRequest(target, address, {
    "X-Redmine-API-Key": apiKey,
    Accept: "application/json",
  });
  assertOk(res);

  return JSON.parse(res.body.toString("utf-8")) as RedmineIssueListResponse;
}

const DEFAULT_MAX_EXPORT_ISSUES = 1000;

/**
 * 一覧を offset ページングしながら全件取得する。
 * limit/offset は呼び出し側では指定しない（内部で MAX_ISSUE_LIST_LIMIT 固定・自動送り）。
 */
export async function getAllIssues(
  conn: RedmineConnection,
  params: Omit<RedmineIssueListParams, "limit" | "offset">,
  opts?: { maxIssues?: number },
): Promise<{
  issues: RedmineIssueSummary[];
  totalCount: number;
  truncated: boolean;
}> {
  const maxIssues = opts?.maxIssues ?? DEFAULT_MAX_EXPORT_ISSUES;
  const issues: RedmineIssueSummary[] = [];
  let offset = 0;
  let totalCount = Infinity;

  while (offset < totalCount && issues.length < maxIssues) {
    const page = await getIssues(conn, {
      ...params,
      limit: MAX_ISSUE_LIST_LIMIT,
      offset,
    });
    totalCount = page.total_count;
    issues.push(...page.issues);
    if (page.issues.length === 0) break; // 想定外の空応答での無限ループ防止
    offset += page.issues.length;
  }

  const truncated = issues.length < totalCount;
  return { issues: issues.slice(0, maxIssues), totalCount, truncated };
}

/**
 * 対象期間に「作成または更新」されたチケットを全件取得する（id降順）。
 * Redmine のフィルタは AND 結合のみで OR を指定できないため、
 * 作成日での絞り込みと更新日での絞り込みを別々に取得し、ID で重複を除いて結合する。
 */
export async function getIssuesCreatedOrUpdated(
  conn: RedmineConnection,
  range: { from: string; to: string },
  opts?: { closedOnly?: boolean; maxIssues?: number },
): Promise<{ issues: RedmineIssueSummary[]; truncated: boolean }> {
  const closedOnly = opts?.closedOnly ?? false;
  const maxIssues = opts?.maxIssues ?? DEFAULT_MAX_EXPORT_ISSUES;

  const created = await getAllIssues(
    conn,
    { createdOnFrom: range.from, createdOnTo: range.to, closedOnly },
    { maxIssues },
  );
  const updated = await getAllIssues(
    conn,
    { updatedOnFrom: range.from, updatedOnTo: range.to, closedOnly },
    { maxIssues },
  );

  const byId = new Map<number, RedmineIssueSummary>();
  for (const issue of [...created.issues, ...updated.issues]) {
    byId.set(issue.id, issue);
  }
  const merged = [...byId.values()].sort((a, b) => b.id - a.id);

  return {
    issues: merged.slice(0, maxIssues),
    truncated: created.truncated || updated.truncated || merged.length > maxIssues,
  };
}

const DEFAULT_DETAIL_CONCURRENCY = 4;

/**
 * 複数チケットの詳細（journals込み）を並行数を絞って取得する。
 * 1件の失敗で全体を止めず、失敗は failures にまとめて返す。
 * 4xx はリトライせず即失敗、それ以外のエラーは1回だけリトライする。
 */
export async function getIssuesDetailed(
  conn: RedmineConnection,
  ids: number[],
  opts?: { concurrency?: number; include?: ("journals" | "attachments")[] },
): Promise<{
  issues: RedmineIssue[];
  failures: { id: number; message: string }[];
}> {
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_DETAIL_CONCURRENCY);
  // ids の並び順を保つため、結果を位置固定のスロットに書き込む（workerの完了順は不定なため）。
  const slots: (RedmineIssue | undefined)[] = new Array(ids.length);
  const failures: { id: number; message: string }[] = [];

  async function fetchOne(index: number): Promise<void> {
    const id = ids[index];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await getIssue(String(id), conn, { include: opts?.include });
        slots[index] = res.issue;
        return;
      } catch (err) {
        const isClientError = err instanceof RedmineApiError && err.status < 500;
        if (isClientError || attempt === 1) {
          const message = err instanceof Error ? err.message : "不明なエラー";
          failures.push({ id, message });
          return;
        }
      }
    }
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      await fetchOne(index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, worker),
  );

  const issues = slots.filter((issue): issue is RedmineIssue => issue !== undefined);
  return { issues, failures };
}
