"use client";

import { useState, type FormEvent } from "react";
import type {
  RedmineIssueListResponse,
  RedmineIssueResponse,
} from "@/lib/redmine";

/**
 * APIキーが用意できない環境でも画面の表示ロジックを確認できるようにするための
 * ハードコードされたダミーデータ。ネットワーク通信は一切行わない。
 */
const SAMPLE_ISSUE_RESPONSE: RedmineIssueResponse = {
  issue: {
    id: 1234,
    subject: "サンプルチケット：ログイン画面のレイアウト崩れ",
    description:
      "モバイル表示時にログインボタンがフッターと重なる。\n375px幅で再現します。",
    project: { id: 1, name: "サンプルプロジェクト" },
    tracker: { id: 1, name: "バグ" },
    status: { id: 2, name: "進行中" },
    priority: { id: 2, name: "通常" },
    author: { id: 1, name: "山田 太郎" },
    assigned_to: { id: 2, name: "鈴木 花子" },
    created_on: "2026-08-20T09:00:00Z",
    updated_on: "2026-08-28T03:30:00Z",
    journals: [
      {
        id: 1,
        notes: "再現手順を確認しました。対応します。",
        created_on: "2026-08-21T01:15:00Z",
        user: { id: 2, name: "鈴木 花子" },
      },
      {
        id: 2,
        notes: "",
        created_on: "2026-08-24T06:40:00Z",
        user: { id: 2, name: "鈴木 花子" },
      },
      {
        id: 3,
        notes: "修正版をステージングにデプロイしました。確認をお願いします。",
        created_on: "2026-08-27T08:05:00Z",
        user: { id: 2, name: "鈴木 花子" },
      },
      {
        id: 4,
        notes: "確認しました、問題なさそうです。",
        created_on: "2026-08-28T03:30:00Z",
        user: { id: 1, name: "山田 太郎" },
      },
    ],
  },
};

export default function Home() {
  const [redmineUrl, setRedmineUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RedmineIssueResponse | null>(null);
  const [isSample, setIsSample] = useState(false);

  const [issueList, setIssueList] = useState<RedmineIssueListResponse | null>(
    null,
  );
  const [issueListLoading, setIssueListLoading] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);

  async function fetchIssue(id: string) {
    if (!redmineUrl || !apiKey || !id) return;

    setLoading(true);
    setError(null);
    setData(null);
    setIsSample(false);

    try {
      const res = await fetch(`/api/issue/${encodeURIComponent(id)}`, {
        headers: {
          "X-Redmine-Url": redmineUrl,
          "X-Redmine-Api-Key": apiKey,
        },
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? `取得に失敗しました（HTTP ${res.status}）`);
        return;
      }

      setData(body as RedmineIssueResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fetchIssue(ticketId);
  }

  async function handleFetchIssueList() {
    if (!redmineUrl || !apiKey) return;

    setIssueListLoading(true);
    setIssueListError(null);
    setIssueList(null);

    try {
      const res = await fetch("/api/issues?limit=25", {
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

  async function handleSelectIssue(id: number) {
    setTicketId(String(id));
    await fetchIssue(String(id));
  }

  function handleShowSample() {
    setError(null);
    setData(SAMPLE_ISSUE_RESPONSE);
    setIsSample(true);
  }

  const issue = data?.issue;
  const journals = issue?.journals ?? [];
  const latestNotes = journals
    .slice(-3)
    .reverse()
    .filter((j) => j.notes);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Redmine 疎通確認
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
          <div className="flex gap-3">
            <input
              type="text"
              inputMode="numeric"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              placeholder="チケットID（例: 1234）"
              className="flex-1 rounded border border-black/[.15] bg-white px-3 py-2 text-black dark:border-white/[.2] dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
            >
              {loading ? "取得中..." : "取得"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            入力値はこの画面を離れる（再読み込み・タブを閉じる）と消えます。保存はされません。
          </p>
        </form>

        <div>
          <button
            type="button"
            onClick={handleShowSample}
            className="rounded border border-black/[.15] px-4 py-2 text-sm text-black dark:border-white/[.2] dark:text-zinc-50"
          >
            サンプルデータで試す
          </button>
          <p className="mt-1 text-xs text-zinc-500">
            APIキーがまだ用意できない場合、実際のRedmineには接続せずダミーデータで画面表示を確認できます。
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-black/[.1] pt-6 dark:border-white/[.15]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-black dark:text-zinc-50">
              チケット一覧
            </h2>
            <button
              type="button"
              onClick={handleFetchIssueList}
              disabled={issueListLoading || !redmineUrl || !apiKey}
              className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-black disabled:opacity-50 dark:border-white/[.2] dark:text-zinc-50"
            >
              {issueListLoading ? "取得中..." : "一覧を取得（最新25件を取得）"}
            </button>
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
                {issueList.offset + issueList.issues.length}件を表示
              </p>
              <ul className="flex flex-col divide-y divide-black/[.08] rounded border border-black/[.1] dark:divide-white/[.1] dark:border-white/[.15]">
                {issueList.issues.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectIssue(i.id)}
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

        {isSample && data && (
          <p className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            これはサンプルデータです。実際のRedmineには接続していません。
          </p>
        )}

        {error && (
          <p className="whitespace-pre-wrap rounded border border-red-400 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {issue && (
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

            <details>
              <summary className="cursor-pointer text-sm text-zinc-500">
                生JSONレスポンス
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded bg-black/[.04] p-3 text-xs text-black dark:bg-white/[.06] dark:text-zinc-50">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </main>
    </div>
  );
}
