"use client";

import { useRef, useState } from "react";
import type {
  RedmineIssue,
  RedmineIssueListResponse,
  RedmineIssueResponse,
} from "@/lib/redmine";

/** 対象月（YYYY-MM）から、その月の初日・末日（YYYY-MM-DD）を求める。不正な形式なら null。 */
function monthToDateRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  const lastDay = new Date(year, monthNum, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${pad(lastDay)}`,
  };
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** チケット詳細（ステータス・担当者・説明・journalsのnotes）の表示。詳細ダイアログで使う。 */
function IssueDetailView({ issue }: { issue: RedmineIssue }) {
  const journals = issue.journals ?? [];
  const latestNotes = journals
    .slice(-3)
    .reverse()
    .filter((j) => j.notes);

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
          journals（{journals.length}件）の最新3件の notes
        </p>
        {latestNotes.length === 0 ? (
          <p className="text-sm text-zinc-500">(notes 付きの履歴なし)</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {latestNotes.map((j) => (
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
  const [issueList, setIssueList] = useState<RedmineIssueListResponse | null>(
    null,
  );
  const [issueListLoading, setIssueListLoading] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);

  const [modalIssue, setModalIssue] = useState<RedmineIssueResponse | null>(
    null,
  );
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function handleFetchIssueList() {
    if (!redmineUrl || !apiKey) return;

    const range = monthToDateRange(targetMonth);
    if (!range) {
      setIssueListError("対象月を選択してください");
      return;
    }

    setIssueListLoading(true);
    setIssueListError(null);
    setIssueList(null);

    try {
      const params = new URLSearchParams({
        limit: "100",
        created_on_from: range.from,
        created_on_to: range.to,
      });
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

      setIssueList(body as RedmineIssueListResponse);
    } catch (err) {
      setIssueListError(
        err instanceof Error ? err.message : "不明なエラーが発生しました",
      );
    } finally {
      setIssueListLoading(false);
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

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black lg:flex-row lg:justify-center">
      <main className="flex w-full max-w-2xl flex-col gap-6 px-6 py-16 lg:mx-auto">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Redmine 疎通確認
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
            <div className="flex items-center gap-2">
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
            </div>
          </div>

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

          {issueList && (
            <>
              <p className="text-xs text-zinc-500">
                {issueList.total_count}件中 {issueList.offset + 1}〜
                {issueList.offset + issueList.issues.length}
                件を表示（行をダブルクリックで詳細表示）
              </p>
              <ul className="flex flex-col divide-y divide-black/[.08] rounded border border-black/[.1] dark:divide-white/[.1] dark:border-white/[.15]">
                {issueList.issues.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onDoubleClick={() => handleOpenIssueModal(i.id)}
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-black/[.03] dark:hover:bg-white/[.06]"
                    >
                      <span className="text-black dark:text-zinc-50">
                        #{i.id} {i.subject}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {i.project.name} / {i.tracker.name} / {i.status.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
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
            対象月を選び「一覧を取得」をクリックし、実際のRedmine画面でその月に起票されたチケット一覧と件数が一致するか確認する。
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
