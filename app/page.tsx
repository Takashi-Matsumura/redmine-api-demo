"use client";

import { useRef, useState } from "react";
import type { RedmineIssue, RedmineIssueResponse } from "@/lib/redmine";
import type { IssueListItem, IssueListResponse } from "@/lib/issue-list";
import { currentMonthValue } from "@/lib/month";

/** 一覧の各行に出す、クローズ済み／進行中の区別。 */
function ClosedBadge({ isClosed }: { isClosed: IssueListItem["is_closed"] }) {
  if (isClosed === null) {
    return (
      <span className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-500 dark:border-zinc-600">
        判定不可
      </span>
    );
  }
  return isClosed ? (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
      クローズ
    </span>
  ) : (
    <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
      進行中
    </span>
  );
}

/** チケット詳細（ステータス・担当者・説明・journalsのnotes）の表示。詳細ダイアログで使う。 */
function IssueDetailView({ issue }: { issue: RedmineIssue }) {
  const journals = issue.journals ?? [];
  const notes = journals.filter((j) => j.notes);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm text-black dark:text-zinc-50">
        <dt className="font-medium text-zinc-500">id</dt>
        <dd>{issue.id}</dd>
        <dt className="font-medium text-zinc-500">subject</dt>
        <dd>{issue.subject}</dd>
        <dt className="font-medium text-zinc-500">project</dt>
        <dd>{issue.project.name}</dd>
        <dt className="font-medium text-zinc-500">tracker</dt>
        <dd>{issue.tracker.name}</dd>
        <dt className="font-medium text-zinc-500">status</dt>
        <dd>{issue.status.name}</dd>
        <dt className="font-medium text-zinc-500">priority</dt>
        <dd>{issue.priority.name}</dd>
        <dt className="font-medium text-zinc-500">author</dt>
        <dd>{issue.author.name}</dd>
        <dt className="font-medium text-zinc-500">assigned_to</dt>
        <dd>{issue.assigned_to?.name ?? "未割当"}</dd>
        <dt className="font-medium text-zinc-500">created_on</dt>
        <dd>{issue.created_on}</dd>
        <dt className="font-medium text-zinc-500">updated_on</dt>
        <dd>{issue.updated_on}</dd>
      </dl>

      <div>
        <p className="text-sm font-medium text-zinc-500">description</p>
        <p className="whitespace-pre-wrap text-sm text-black dark:text-zinc-50">
          {issue.description || "(なし)"}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium text-zinc-500">
          journals（{journals.length}件）のnotes（コメント）全{notes.length}件
        </p>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-500">(notes 付きの履歴なし)</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((j) => (
              <li
                key={j.id}
                className="whitespace-pre-wrap rounded border border-black/[.1] px-3 py-2 text-sm text-black dark:border-white/[.15] dark:text-zinc-50"
              >
                <span className="text-zinc-500">
                  {j.created_on} / {j.user?.name ?? "unknown"}
                </span>
                <br />
                {j.notes}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [redmineUrl, setRedmineUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [targetMonth, setTargetMonth] = useState(currentMonthValue);
  const [closedOnly, setClosedOnly] = useState(true);
  const [issueList, setIssueList] = useState<IssueListResponse | null>(null);
  const [issueListMonth, setIssueListMonth] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [issueListLoading, setIssueListLoading] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [docxExportLoading, setDocxExportLoading] = useState(false);
  const [docxExportError, setDocxExportError] = useState<string | null>(null);
  const [docxExportResult, setDocxExportResult] = useState<string | null>(null);

  const [modalIssue, setModalIssue] = useState<RedmineIssueResponse | null>(
    null,
  );
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const ISSUE_LIST_PAGE_SIZE = 100;

  async function handleFetchIssueList() {
    if (!redmineUrl || !apiKey || !targetMonth) return;

    setIssueListLoading(true);
    setIssueListError(null);
    setIssueList(null);
    setPage(0);

    try {
      const params = new URLSearchParams({ month: targetMonth });
      const res = await fetch(`/api/issues?${params.toString()}`, {
        headers: {
          "X-Redmine-Url": redmineUrl,
          "X-Redmine-Api-Key": apiKey,
        },
      });
      const body = await res.json();

      if (!res.ok) {
        setIssueListError(body.error ?? `取得に失敗しました（HTTP ${res.status}）`);
        return;
      }

      setIssueList(body as IssueListResponse);
      setIssueListMonth(targetMonth);
    } catch (err) {
      setIssueListError(
        err instanceof Error ? err.message : "不明なエラーが発生しました",
      );
    } finally {
      setIssueListLoading(false);
    }
  }

  async function handleExportDocxZip() {
    if (!redmineUrl || !apiKey || !targetMonth) return;

    setDocxExportLoading(true);
    setDocxExportError(null);
    setDocxExportResult(null);

    try {
      const params = new URLSearchParams({ month: targetMonth });
      const res = await fetch(`/api/export-docx?${params.toString()}`, {
        headers: {
          "X-Redmine-Url": redmineUrl,
          "X-Redmine-Api-Key": apiKey,
        },
      });

      if (!res.ok) {
        const body = await res.json();
        setDocxExportError(body.error ?? `エクスポートに失敗しました（HTTP ${res.status}）`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `redmine-${targetMonth}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      const issueCount = res.headers.get("X-Export-Issue-Count") ?? "?";
      const failed = (res.headers.get("X-Export-Failed-Issues") ?? "")
        .split(",")
        .filter(Boolean);
      const skipped = Number(res.headers.get("X-Export-Skipped-Attachments") ?? "0");
      const truncated = res.headers.get("X-Export-Truncated") === "1";

      const lines = [`クローズ済みチケット ${issueCount}件をエクスポートしました。`];
      if (failed.length > 0) {
        lines.push(`取得に失敗したチケット（Zipに含まれていません）: ${failed.map((id) => `#${id}`).join(", ")}`);
      }
      if (skipped > 0) {
        lines.push(`取得できなかった添付ファイル: ${skipped}件（各チケットの docx に理由を記載しています）`);
      }
      if (truncated) {
        lines.push("件数が上限に達したため、一部のチケットは含まれていません。");
      }
      setDocxExportResult(lines.join("\n"));
    } catch (err) {
      setDocxExportError(
        err instanceof Error ? err.message : "不明なエラーが発生しました",
      );
    } finally {
      setDocxExportLoading(false);
    }
  }

  async function handleExportMarkdown() {
    if (!redmineUrl || !apiKey || !targetMonth) return;

    setExportLoading(true);
    setExportError(null);

    try {
      const params = new URLSearchParams({
        month: targetMonth,
        closed_only: closedOnly ? "1" : "0",
      });
      const res = await fetch(`/api/export?${params.toString()}`, {
        headers: {
          "X-Redmine-Url": redmineUrl,
          "X-Redmine-Api-Key": apiKey,
        },
      });

      if (!res.ok) {
        const body = await res.json();
        setExportError(body.error ?? `エクスポートに失敗しました（HTTP ${res.status}）`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `redmine-${targetMonth}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "不明なエラーが発生しました",
      );
    } finally {
      setExportLoading(false);
    }
  }

  async function handleOpenIssueModal(id: number) {
    setModalLoading(true);
    setModalError(null);
    setModalIssue(null);
    dialogRef.current?.showModal();

    try {
      const res = await fetch(`/api/issue/${id}`, {
        headers: {
          "X-Redmine-Url": redmineUrl,
          "X-Redmine-Api-Key": apiKey,
        },
      });
      const body = await res.json();

      if (!res.ok) {
        setModalError(body.error ?? `取得に失敗しました（HTTP ${res.status}）`);
        return;
      }

      setModalIssue(body as RedmineIssueResponse);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "不明なエラーが発生しました");
    } finally {
      setModalLoading(false);
    }
  }

  const allIssues = issueList?.issues ?? [];
  const total = allIssues.length;
  const closedCount = allIssues.filter((i) => i.is_closed === true).length;
  const openCount = allIssues.filter((i) => i.is_closed === false).length;
  const pageCount = Math.max(1, Math.ceil(total / ISSUE_LIST_PAGE_SIZE));
  const start = page * ISSUE_LIST_PAGE_SIZE;
  const pageIssues = allIssues.slice(start, start + ISSUE_LIST_PAGE_SIZE);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black lg:flex-row lg:justify-center">
      <main className="flex w-full max-w-2xl flex-col gap-6 px-6 py-16 lg:mx-auto">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Redmine チケット一覧・詳細確認
        </h1>

        <div className="flex flex-col gap-3">
          <input
            type="url"
            value={redmineUrl}
            onChange={(e) => setRedmineUrl(e.target.value)}
            placeholder="Redmine URL（例: https://my.redmine.jp/xxxxx）"
            className="rounded border border-black/[.15] bg-white px-3 py-2 text-black dark:border-white/[.2] dark:bg-zinc-900 dark:text-zinc-50"
          />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="APIキー"
            autoComplete="off"
            className="rounded border border-black/[.15] bg-white px-3 py-2 text-black dark:border-white/[.2] dark:bg-zinc-900 dark:text-zinc-50"
          />
          <p className="text-xs text-zinc-500">
            入力値はこの画面を離れる（再読み込み・タブを閉じる）と消えます。保存はされません。
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-black/[.1] pt-6 dark:border-white/[.15]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-black dark:text-zinc-50">
              チケット一覧
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="rounded border border-black/[.15] bg-white px-2 py-1.5 text-sm text-black dark:border-white/[.2] dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button
                type="button"
                onClick={handleFetchIssueList}
                disabled={issueListLoading || !redmineUrl || !apiKey || !targetMonth}
                className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-black disabled:opacity-50 dark:border-white/[.2] dark:text-zinc-50"
              >
                {issueListLoading ? "取得中..." : "一覧を取得"}
              </button>
              <button
                type="button"
                onClick={handleExportDocxZip}
                disabled={docxExportLoading || !redmineUrl || !apiKey || !targetMonth}
                className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-black disabled:opacity-50 dark:border-white/[.2] dark:text-zinc-50"
              >
                {docxExportLoading ? "エクスポート中..." : "クローズ済みをdocx(Zip)でエクスポート"}
              </button>
              <button
                type="button"
                onClick={handleExportMarkdown}
                disabled={exportLoading || !redmineUrl || !apiKey || !targetMonth}
                className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-black disabled:opacity-50 dark:border-white/[.2] dark:text-zinc-50"
              >
                {exportLoading ? "エクスポート中..." : "MDでエクスポート"}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
            <input
              type="checkbox"
              checked={closedOnly}
              onChange={(e) => setClosedOnly(e.target.checked)}
            />
            MDエクスポートは完了（クローズ）済みのみ（起票日が対象月のチケットが対象）
          </label>
          <p className="text-xs text-zinc-500">
            一覧は、対象月に作成または更新されたチケットを全ステータス表示します。docx(Zip)エクスポートはそのうちクローズ済みのチケットのみを、チケットごとの docx と添付ファイルにまとめます。
          </p>

          {(!redmineUrl || !apiKey) && (
            <p className="text-xs text-zinc-500">
              上のRedmine URLとAPIキーを入力すると一覧を取得できます。
            </p>
          )}

          {issueListError && (
            <p className="whitespace-pre-wrap rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {issueListError}
            </p>
          )}

          {docxExportError && (
            <p className="whitespace-pre-wrap rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {docxExportError}
            </p>
          )}

          {docxExportResult && (
            <p className="whitespace-pre-wrap rounded border border-green-400 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              {docxExportResult}
            </p>
          )}

          {exportError && (
            <p className="whitespace-pre-wrap rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {exportError}
            </p>
          )}

          {issueList && (
              <>
                <p className="text-xs text-zinc-500">
                  {issueListMonth} に作成・更新: {total}件（クローズ {closedCount}件 / 進行中 {openCount}件
                  {total - closedCount - openCount > 0 && ` / 判定不可 ${total - closedCount - openCount}件`}）
                  {total > 0 && `　${start + 1}〜${start + pageIssues.length}件を表示`}
                  （行をダブルクリックで詳細表示）
                </p>
                {issueList.truncated && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    件数が上限に達したため、一部のチケットは表示されていません。
                  </p>
                )}
                {total > 0 && (
                  <ul className="flex flex-col divide-y divide-black/[.08] rounded border border-black/[.1] dark:divide-white/[.1] dark:border-white/[.15]">
                    {pageIssues.map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          onDoubleClick={() => handleOpenIssueModal(i.id)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-black/[.03] dark:hover:bg-white/[.06]"
                        >
                          <ClosedBadge isClosed={i.is_closed} />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-black dark:text-zinc-50">
                              #{i.id} {i.subject}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {i.project.name} / {i.tracker.name} / {i.status.name} / 作成 {i.created_on.slice(0, 10)} / 更新 {i.updated_on.slice(0, 10)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {pageCount > 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-black disabled:opacity-50 dark:border-white/[.2] dark:text-zinc-50"
                    >
                      前へ
                    </button>
                    <span className="text-xs text-zinc-500">
                      {page + 1} / {pageCount} ページ
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={page >= pageCount - 1}
                      className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-black disabled:opacity-50 dark:border-white/[.2] dark:text-zinc-50"
                    >
                      次へ
                    </button>
                  </div>
                )}
              </>
          )}
        </div>
      </main>

      <aside className="w-full shrink-0 border-t border-black/[.1] px-6 py-16 dark:border-white/[.15] lg:w-96 lg:border-t-0 lg:border-l lg:pl-10">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          実環境 検証手順
        </h2>
        <ol className="mt-4 flex list-decimal flex-col gap-4 pl-5 text-sm text-black dark:text-zinc-50">
          <li>
            上のRedmine URLとAPIキーを実環境の値で入力する。
          </li>
          <li>
            対象月を選び「一覧を取得」をクリックし、実際のRedmine画面で「作成日がその月」または「更新日がその月」のチケットと件数が一致するか確認する（Redmine画面では2つの条件で別々に絞り込み、重複を除いて合算する）。
          </li>
          <li>
            一覧の行をダブルクリックし、ダイアログに表示された詳細（ステータス・担当者・説明・journalsのnotes）が実際のRedmine画面と一致するか確認する。
          </li>
          <li>
            誤ったAPIキーやRedmine URLを入力し、エラーメッセージが適切に表示されるか確認する。
          </li>
          <li>
            ダイアログ内の「生JSONレスポンス」を開き、想定外のフィールドや欠落がないか確認する。
          </li>
          <li>
            一覧の「クローズ」「進行中」の表示が、Redmine のステータス設定（「終了したチケット」にチェックがあるか）と一致するか確認する。
          </li>
          <li>
            101件以上ある月で「次へ」「前へ」を操作し、ページが重複・欠落なく切り替わること（表示範囲の件数表示と実際の行数が一致すること）を確認する。
          </li>
          <li>
            「クローズ済みをdocx(Zip)でエクスポート」で取得したZipを展開し、チケットIDのフォルダ数が一覧の「クローズ」件数と一致するか確認する。
          </li>
          <li>
            添付ファイルのあるチケットのフォルダを開き、添付ファイルが docx と同じ場所にすべて揃っていること、Word で docx を開いて内容（説明・コメント・添付一覧）が Redmine 画面と一致することを確認する。
          </li>
          <li>
            「MDでエクスポート」でダウンロードしたファイルの front matter の issue_count が、同条件で一覧取得した total_count と一致するか確認する（101件以上ある月は特に）。
          </li>
          <li>
            エクスポートしたファイルを開き、front matter・チケットの区切り・見出し階層が崩れていないこと、プライベート注記が本文に含まれていないことを確認する。
          </li>
        </ol>
        <p className="mt-6 text-xs text-zinc-500">
          この手順は画面表示用の固定テキストです。実環境のAPIキー等は送信・保存されません。
        </p>
      </aside>

      <dialog
        ref={dialogRef}
        onClose={() => {
          setModalIssue(null);
          setModalError(null);
        }}
        className="m-auto w-[90vw] max-w-2xl rounded-lg border border-black/[.15] bg-white p-0 text-black backdrop:bg-black/40 dark:border-white/[.2] dark:bg-zinc-900 dark:text-zinc-50"
      >
        <div className="flex max-h-[80vh] flex-col gap-4 overflow-auto p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">チケット詳細</h3>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-black/[.05] dark:hover:bg-white/[.1]"
            >
              閉じる
            </button>
          </div>

          {modalLoading && (
            <p className="text-sm text-zinc-500">取得中...</p>
          )}

          {modalError && (
            <p className="whitespace-pre-wrap rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {modalError}
            </p>
          )}

          {modalIssue && (
            <>
              <IssueDetailView issue={modalIssue.issue} />
              <details>
                <summary className="cursor-pointer text-sm text-zinc-500">
                  生JSONレスポンス
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-black/[.04] p-3 text-xs text-black dark:bg-white/[.06] dark:text-zinc-50">
                  {JSON.stringify(modalIssue, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
