import "server-only";
import type {
  RedmineAttachment,
  RedmineIssue,
  RedmineIssueListParams,
  RedmineIssueListResponse,
  RedmineIssueStatus,
  RedmineIssueSummary,
  RedmineJournal,
  RedmineNamed,
} from "@/lib/redmine";

/**
 * 開発用のサンプルデータ。本番の Redmine に接続できない環境で、一覧・詳細・エクスポートを確認するために使う。
 * 実行した日を基準に「今月」「先月」「先々月」のチケットを決まった内容で生成する（毎回同じ結果になる）。
 *
 * - 先月: 120件超（ページ送りの確認用）と、エクスポートの境界条件を確かめるためのチケットを含む
 * - 今月・先々月: 十数件
 */

export const SAMPLE_REDMINE_URL = "https://sample.redmine.invalid";

const STATUSES: RedmineIssueStatus[] = [
  { id: 1, name: "新規", is_closed: false },
  { id: 2, name: "進行中", is_closed: false },
  { id: 3, name: "解決", is_closed: false },
  { id: 4, name: "フィードバック", is_closed: false },
  { id: 5, name: "終了", is_closed: true },
  { id: 6, name: "却下", is_closed: true },
];
const PROJECTS: RedmineNamed[] = [
  { id: 1, name: "基幹システム" },
  { id: 2, name: "社内ポータル" },
  { id: 3, name: "帳票基盤" },
];
const TRACKERS: RedmineNamed[] = [
  { id: 1, name: "バグ" },
  { id: 2, name: "機能" },
  { id: 3, name: "サポート" },
];
const PRIORITIES: RedmineNamed[] = [
  { id: 1, name: "低め" },
  { id: 2, name: "通常" },
  { id: 3, name: "高め" },
  { id: 4, name: "急いで" },
];
const USERS: RedmineNamed[] = [
  { id: 1, name: "山田 太郎" },
  { id: 2, name: "佐藤 花子" },
  { id: 3, name: "鈴木 一郎" },
  { id: 4, name: "高橋 美咲" },
];
const SUBJECTS = [
  "ログイン画面でパスワードリセットのリンクが表示されない",
  "月次売上帳票の合計金額がずれる",
  "ポータルのお知らせ一覧に並び替え機能を追加",
  "CSV取込時に全角スペースが除去されない",
  "承認フローの差し戻し時に通知メールが送信されない",
  "検索結果のページ送りで同じ行が重複して表示される",
  "帳票PDFのフォントを游ゴシックに変更",
  "権限設定画面の操作手順についての問い合わせ",
  "夜間バッチの処理時間が長くなっている",
  "社員マスタの部署コード桁数変更への対応",
];

/** 状態を持たない決定的な疑似乱数（同じ seed なら同じ値）。 */
function pick<T>(list: T[], seed: number): T {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return list[Math.floor((x - Math.floor(x)) * list.length)];
}

function monthStart(offset: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

/** 基準月（offset: 0=今月, -1=先月…）の day 日 hour 時を ISO 文字列にする。日が月末を超える場合は月末に丸める。 */
function at(offset: number, day: number, hour = 10): string {
  const start = monthStart(offset);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const d = new Date(start.getFullYear(), start.getMonth(), Math.min(day, lastDay), hour, 0, 0);
  // 今月分で未来日になる場合は現在時刻に丸める
  return new Date(Math.min(d.getTime(), Date.now())).toISOString();
}

// --- 添付ファイルの中身 -------------------------------------------------

/** 1x1 の PNG 画像。 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** 添付ID → 中身。ここに無い添付ID（ATTACHMENT_MISSING）はダウンロード時に 404 になる。 */
const attachmentData = new Map<number, Buffer>();
/** 申告サイズだけが大きく、ダウンロードはされない想定の添付（1ファイル上限の確認用）。 */
const DECLARED_ONLY_SIZES = new Map<number, number>();
/** ダウンロードすると 404 を返す添付（取得失敗の確認用）。 */
export const SAMPLE_MISSING_ATTACHMENT_IDS = new Set<number>();

let nextAttachmentId = 1;
function attachment(
  filename: string,
  data: Buffer | { declaredSize: number } | "missing",
  opts: { author: RedmineNamed; createdOn: string; description?: string; contentType?: string },
): RedmineAttachment {
  const id = nextAttachmentId++;
  let filesize: number;
  if (data === "missing") {
    SAMPLE_MISSING_ATTACHMENT_IDS.add(id);
    filesize = 2048;
  } else if (Buffer.isBuffer(data)) {
    attachmentData.set(id, data);
    filesize = data.length;
  } else {
    DECLARED_ONLY_SIZES.set(id, data.declaredSize);
    filesize = data.declaredSize;
  }
  return {
    id,
    filename,
    filesize,
    content_type: opts.contentType,
    description: opts.description,
    content_url: `${SAMPLE_REDMINE_URL}/attachments/download/${id}/${encodeURIComponent(filename)}`,
    author: opts.author,
    created_on: opts.createdOn,
  };
}

function text(content: string): Buffer {
  return Buffer.from(content, "utf-8");
}

// --- チケット生成 -------------------------------------------------------

let nextJournalId = 1;
function journal(
  notes: string,
  user: RedmineNamed,
  createdOn: string,
  privateNotes = false,
): RedmineJournal {
  return { id: nextJournalId++, notes, user, created_on: createdOn, private_notes: privateNotes };
}

function status(id: number): RedmineNamed {
  const s = STATUSES.find((x) => x.id === id)!;
  return { id: s.id, name: s.name };
}

interface IssueSeed {
  id: number;
  subject: string;
  description?: string;
  statusId: number;
  createdOn: string;
  updatedOn: string;
  journals?: RedmineJournal[];
  attachments?: RedmineAttachment[];
}

function buildIssue(seed: IssueSeed): RedmineIssue {
  return {
    id: seed.id,
    subject: seed.subject,
    description: seed.description,
    project: pick(PROJECTS, seed.id),
    tracker: pick(TRACKERS, seed.id + 1),
    status: status(seed.statusId),
    priority: pick(PRIORITIES, seed.id + 2),
    author: pick(USERS, seed.id + 3),
    assigned_to: seed.id % 7 === 0 ? undefined : pick(USERS, seed.id + 4),
    created_on: seed.createdOn,
    updated_on: seed.updatedOn,
    journals: seed.journals ?? [],
    attachments: seed.attachments ?? [],
  };
}

/** 一般的なチケット。偶数日に作成、数日後に更新。 */
function genericIssue(id: number, offset: number, index: number): RedmineIssue {
  const day = (index % 27) + 1;
  const createdOn = at(offset, day, 9 + (index % 8));
  const updatedOn = at(offset, Math.min(day + (index % 4), 28), 17);
  const statusId = pick([1, 2, 3, 4, 5, 5, 5, 6], id);
  const author = pick(USERS, id);
  const assignee = pick(USERS, id + 1);
  const journals = [
    journal(`確認しました。${assignee.name}で対応します。`, assignee, createdOn),
  ];
  if (STATUSES.find((s) => s.id === statusId)!.is_closed) {
    journals.push(journal("対応が完了したためクローズします。", author, updatedOn));
  }
  const attachments =
    index % 5 === 0
      ? [
          attachment(`調査メモ_${id}.txt`, text(`チケット #${id} の調査メモ\n再現手順と原因を記載。\n`), {
            author: assignee,
            createdOn,
            contentType: "text/plain",
          }),
        ]
      : [];
  return buildIssue({
    id,
    subject: pick(SUBJECTS, id),
    description: `## 現象\n${pick(SUBJECTS, id)}。\n\n## 期待する動作\n仕様どおりに動作すること。\n`,
    statusId,
    createdOn,
    updatedOn,
    journals,
    attachments,
  });
}

/** エクスポートの境界条件を確かめるためのチケット（すべて先月に関係する）。 */
function specialIssues(): RedmineIssue[] {
  const yamada = USERS[0];
  const sato = USERS[1];
  const c = at(-1, 3);
  const u = at(-1, 20, 15);

  return [
    buildIssue({
      id: 9001,
      subject: "【サンプル】添付ファイル名の重複（画面.png が複数）",
      description: "同じ名前の添付ファイルが複数あるチケット。\nZip 内では「画面 (2).png」のように連番が付く。",
      statusId: 5,
      createdOn: c,
      updatedOn: u,
      journals: [journal("差し替えの画像を添付しました。", sato, u)],
      attachments: [
        attachment("画面.png", PNG_1X1, { author: yamada, createdOn: c, description: "初回のスクリーンショット", contentType: "image/png" }),
        attachment("画面.png", PNG_1X1, { author: sato, createdOn: u, description: "差し替え後", contentType: "image/png" }),
        attachment("画面.PNG", PNG_1X1, { author: sato, createdOn: u, description: "大文字の拡張子", contentType: "image/png" }),
      ],
    }),
    buildIssue({
      id: 9002,
      subject: "【サンプル】ファイル名に使えない文字: 原因/対策 <緊急>?",
      description: "件名と添付ファイル名に Windows で使えない文字（\\ / : * ? \" < > |）を含むチケット。",
      statusId: 5,
      createdOn: c,
      updatedOn: u,
      attachments: [
        attachment("見積*最新?.csv", text("項目,金額\n設計,100000\n実装,250000\n"), { author: yamada, createdOn: c, contentType: "text/csv" }),
        attachment("../../etc/passwd", text("ディレクトリをさかのぼる名前の添付\n"), { author: yamada, createdOn: c }),
        attachment("CON.txt", text("Windows の予約名\n"), { author: yamada, createdOn: c }),
      ],
    }),
    buildIssue({
      id: 9003,
      subject:
        "【サンプル】とても長い件名のチケット：".padEnd(120, "あいうえおかきくけこ"),
      description: "件名が長いチケット。docx のファイル名では件名を50文字で切り詰める。",
      statusId: 6,
      createdOn: c,
      updatedOn: u,
    }),
    buildIssue({
      id: 9004,
      subject: "【サンプル】取得できない添付ファイルを含む",
      description:
        "1ファイルの上限（100MB）を超える添付と、ダウンロードに失敗する添付を含むチケット。\ndocx の添付一覧に「未取得」と理由が表示される。",
      statusId: 5,
      createdOn: c,
      updatedOn: u,
      attachments: [
        attachment("設計書.pdf", minimalPdf("Sample design document"), { author: sato, createdOn: c, contentType: "application/pdf" }),
        attachment("操作動画.mp4", { declaredSize: 150 * 1024 * 1024 }, { author: sato, createdOn: c, contentType: "video/mp4" }),
        attachment("削除済みのファイル.xlsx", "missing", { author: sato, createdOn: c }),
      ],
    }),
    buildIssue({
      id: 9005,
      subject: "【サンプル】プライベート注記と複数行のコメント",
      description: "説明文の中の制御文字\u000bは docx では除去される。\n\n* 箇条書き1\n* 箇条書き2\n\n<pre>\nコード片\n</pre>",
      statusId: 5,
      createdOn: c,
      updatedOn: u,
      journals: [
        journal("1件目のコメント。\n複数行の\nコメントです。", yamada, at(-1, 5)),
        journal("これはプライベート注記なので、エクスポートには含まれない。", sato, at(-1, 6), true),
        journal("3件目のコメント。対応完了。", yamada, u),
      ],
    }),
    buildIssue({
      id: 9006,
      subject: "【サンプル】先々月に作成・先月に更新されてクローズ",
      description: "作成日は先々月、更新日は先月のチケット。先月の一覧・エクスポートの両方に含まれる。",
      statusId: 5,
      createdOn: at(-2, 10),
      updatedOn: at(-1, 12),
      journals: [journal("先月になってクローズしました。", yamada, at(-1, 12))],
    }),
    buildIssue({
      id: 9007,
      subject: "【サンプル】先月に作成されたが進行中",
      description: "進行中のため、一覧には表示されるがエクスポートには含まれない。",
      statusId: 2,
      createdOn: c,
      updatedOn: u,
    }),
    buildIssue({
      id: 9008,
      subject: "【サンプル】説明・添付・コメントなし",
      statusId: 5,
      createdOn: c,
      updatedOn: c,
    }),
    buildIssue({
      id: 9010,
      subject: "【サンプル】詳細の応答に別のIDが返るチケット",
      description: "詳細の応答の id が \"../../9010\" になっている（不正なサーバを想定）。フォルダ名には使われず、「取得に失敗したチケット」として表示される。",
      statusId: 5,
      createdOn: c,
      updatedOn: u,
    }),
    buildIssue({
      id: 9009,
      subject: "【サンプル】詳細の取得に失敗するチケット",
      description: "このチケットは一覧には出るが、詳細の取得で 500 エラーになる。エクスポート後に「取得に失敗したチケット」として表示される。",
      statusId: 5,
      createdOn: c,
      updatedOn: u,
    }),
  ];
}

/** 詳細の応答で要求と異なる ID を返すチケットID（応答 ID の検証の確認用）。 */
const SAMPLE_MISMATCHED_ID_ISSUE_IDS = new Set<number>([9010]);

/** 詳細の取得で 500 を返すチケットID（取得失敗の確認用）。 */
export const SAMPLE_BROKEN_ISSUE_IDS = new Set<number>([9009]);

function buildAll(): RedmineIssue[] {
  const issues: RedmineIssue[] = [];
  let id = 1001;
  const counts: [offset: number, count: number][] = [
    [-2, 12],
    [-1, 125],
    [0, 15],
  ];
  for (const [offset, count] of counts) {
    for (let i = 0; i < count; i++) {
      issues.push(genericIssue(id, offset, i));
      id += 1;
    }
  }
  issues.push(...specialIssues());
  return issues;
}

let cache: { key: string; issues: RedmineIssue[] } | null = null;

/** 月が変わったら作り直す（基準月が「今月」のため）。 */
function allIssues(): RedmineIssue[] {
  const key = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  if (!cache || cache.key !== key) {
    nextAttachmentId = 1;
    nextJournalId = 1;
    attachmentData.clear();
    DECLARED_ONLY_SIZES.clear();
    SAMPLE_MISSING_ATTACHMENT_IDS.clear();
    cache = { key, issues: buildAll() };
  }
  return cache.issues;
}

// --- Redmine API 相当の関数 ----------------------------------------------

function inRange(iso: string, from: string, to: string): boolean {
  // Redmine の >< は日付（ローカル日付）で比較する
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return date >= from && date <= to;
}

function toSummary(issue: RedmineIssue): RedmineIssueSummary {
  // 一覧 API は journals / attachments を含まない
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { journals, attachments, ...summary } = issue;
  return summary;
}

/** issues.json 相当。作成日・更新日・クローズの絞り込みと、id 降順・limit/offset に対応する。 */
export function sampleIssueList(params: RedmineIssueListParams): RedmineIssueListResponse {
  const closedIds = new Set(STATUSES.filter((s) => s.is_closed).map((s) => s.id));
  let issues = allIssues();

  if (params.createdOnFrom && params.createdOnTo) {
    issues = issues.filter((i) => inRange(i.created_on, params.createdOnFrom!, params.createdOnTo!));
  }
  if (params.updatedOnFrom && params.updatedOnTo) {
    issues = issues.filter((i) => inRange(i.updated_on, params.updatedOnFrom!, params.updatedOnTo!));
  }
  if (params.closedOnly) {
    issues = issues.filter((i) => closedIds.has(i.status.id));
  }

  const sorted = [...issues].sort((a, b) => b.id - a.id);
  const limit = Math.min(Math.max(1, params.limit ?? 25), 100);
  const offset = Math.max(0, params.offset ?? 0);
  return {
    issues: sorted.slice(offset, offset + limit).map(toSummary),
    total_count: sorted.length,
    offset,
    limit,
  };
}

/** issues/:id.json 相当。見つからなければ undefined。 */
export function sampleIssue(
  id: number,
  include: ("journals" | "attachments")[],
): RedmineIssue | undefined {
  const issue = allIssues().find((i) => i.id === id);
  if (!issue) return undefined;
  return {
    ...toSummary(issue),
    // 不正なサーバを想定し、要求とは異なる（パスとして危険な）ID を返す
    ...(SAMPLE_MISMATCHED_ID_ISSUE_IDS.has(id) ? { id: `../../${id}` as unknown as number } : {}),
    ...(include.includes("journals") ? { journals: issue.journals } : {}),
    ...(include.includes("attachments") ? { attachments: issue.attachments } : {}),
  };
}

export function sampleStatuses(): RedmineIssueStatus[] {
  return STATUSES;
}

/** 添付ファイルの中身。見つからない（または取得失敗扱いの）添付は undefined。 */
export function sampleAttachmentData(id: number): Buffer | undefined {
  allIssues();
  if (DECLARED_ONLY_SIZES.has(id)) {
    // 本来はエクスポート側の上限判定で取得されない。万一呼ばれたら申告どおりの大きさを返す。
    return Buffer.alloc(DECLARED_ONLY_SIZES.get(id)!);
  }
  return attachmentData.get(id);
}
