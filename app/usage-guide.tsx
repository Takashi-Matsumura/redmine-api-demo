import type { ReactNode } from "react";

/** 右パネルに表示する、このアプリの使い方の説明。 */
export function UsageGuide() {
  return (
    <div className="flex flex-col gap-8 text-sm text-black dark:text-zinc-50">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">使い方</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Redmine のチケットを月ごとに確認し、SharePoint で管理するための docx ファイル、またはナレッジ用の Markdown ファイルとして書き出せます。
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>手順</SectionHeading>
        <ol className="flex flex-col gap-4">
          <Step number={1} title="接続先を入力する">
            Redmine の URL と API キーを入力します。API キーは Redmine の「個人設定」画面の右側にある「API アクセスキー」で確認できます。
            <Note>入力した値は保存されません。再読み込みやタブを閉じると消えます。</Note>
            <Note>動作を試すだけなら「サンプルデータを使う」をONにします（Redmine には接続しません）。</Note>
          </Step>
          <Step number={2} title="対象月を選んで「一覧取得」">
            その月に<strong>作成または更新</strong>されたチケットが、全ステータスで一覧表示されます。各行の「クローズ」「進行中」で状態が分かります。100件を超える場合は「前へ」「次へ」でページを切り替えます。
            <Note>
              「再開済み」は、一度クローズされた後に未完了へ戻されたチケットです。「クローズ後に更新」は、クローズ済みのまま後からコメントなどの更新があったチケットで、再開の兆候として確認してください。一覧の上のラジオボタンで絞り込めます。
            </Note>
          </Step>
          <Step number={3} title="詳細を確認する">
            一覧の行を<strong>ダブルクリック</strong>すると、説明やコメントの履歴に加えて、ステータス変更履歴（いつ・誰がクローズ／再開したか）と再開回数を表示します。「閉じる」または Esc キーで閉じます。
          </Step>
          <Step number={4} title="ファイルに出力する">
            「出力はクローズ済みのチケットのみ」のON/OFFを選んでから、「docx出力」または「MD出力」を押します。一覧のページに関わらず、対象月の該当チケットをすべて出力します。
            <Note>チケットや添付が多い月は、出力に数分かかることがあります。</Note>
          </Step>
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>出力されるファイル</SectionHeading>
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">docx出力（Zip）</h4>
          <p>チケットごとのフォルダに、docx と添付ファイルを同じ階層で置きます。</p>
          <pre className="overflow-x-auto rounded bg-black/[.04] px-3 py-2 text-xs leading-relaxed dark:bg-white/[.06]">
            {`redmine-2026-10.zip
└─ redmine-2026-10/
   └─ 1234/
      ├─ 1234_件名.docx
      ├─ 画面.png
      └─ 仕様書.pdf`}
          </pre>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-zinc-600 dark:text-zinc-400">
            <li>docx には基本情報（最終クローズ日時・再開の検知を含む）・説明・添付ファイルの一覧・ステータス変更履歴・コメントが入ります。</li>
            <li>件名は50文字まで。ファイル名に使えない文字は「_」に置き換え、同じ名前の添付には「(2)」などの番号を付けます。</li>
            <li>添付は1件100MB・全体で1GB・5000件まで。取得できなかった添付は、docx の添付一覧に理由を記載します。</li>
          </ul>
          <p className="text-xs text-zinc-500">
            ※ Zip はエクスプローラー（Windows）や Finder（Mac）で展開してください。Mac のターミナルの{" "}
            <code>unzip</code> コマンドは日本語のファイル名を扱えず、展開に失敗します。ターミナルで展開する場合は{" "}
            <code>ditto -x -k redmine-2026-10.zip 展開先</code> を使ってください。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">MD出力</h4>
          <p>
            対象のチケットを1つの Markdown ファイル（<code className="text-xs">redmine-2026-10.md</code>）にまとめます。各チケットに最終クローズ日時・再開の検知・ステータス変更履歴も記載します。GitHub Copilot などに読み込ませる用途を想定しています。
          </p>
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">
          どちらの出力にも、プライベート注記は含まれません。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>うまくいかないとき</SectionHeading>
        <dl className="flex flex-col gap-3">
          <Trouble term="「認証に失敗しました（HTTP 401 / 403）」">
            API キーが正しいか確認してください。Redmine 側で REST API が無効になっている場合は、管理者に「管理 → 設定 → API」で有効にしてもらいます。
          </Trouble>
          <Trouble term="「チケットが見つかりません（HTTP 404）」">
            チケットが削除されたか、閲覧権限がない可能性があります。
          </Trouble>
          <Trouble term="「許可されていない接続先です」">
            社内ネットワークやローカルのアドレスには、安全のため接続できません。
          </Trouble>
          <Trouble term="出力後に「取得に失敗したチケット」が表示された">
            表示されたチケットは出力に含まれていません。時間をおいてから、もう一度出力してください。
          </Trouble>
        </dl>
      </section>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-b border-black/[.1] pb-1 text-base font-semibold dark:border-white/[.15]">
      {children}
    </h3>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white dark:bg-blue-500"
      >
        {number}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          <span className="sr-only">手順{number}: </span>
          {title}
        </p>
        <div className="text-zinc-700 dark:text-zinc-300">{children}</div>
      </div>
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-xs text-zinc-500">※ {children}</span>;
}

function Trouble({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-medium">{term}</dt>
      <dd className="text-zinc-600 dark:text-zinc-400">{children}</dd>
    </div>
  );
}
