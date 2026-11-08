# redmine-api-demo

Redmine REST API から対象月のチケット一覧・詳細（コメント履歴を含む）を確認できる検証ツール。あわせて、対象月のクローズ済みチケットをチケットごとの docx と添付ファイルにまとめて Zip でエクスポートする機能（SharePoint での管理用）と、対象月の全チケットを1つのMarkdownファイルとしてエクスポートする機能を持つ。8年分蓄積されたRedmineのチケットをナレッジとして書き出し、GitHub Copilot等に読み込ませる用途を想定している。DB・キャッシュ層、認証機能は持たない。

## 使い方

開発サーバを起動する。

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開き、画面上部に以下を入力する。

- **Redmine URL**: 接続先 Redmine のベースURL（例: `https://my.redmine.jp/xxxxx`）
- **APIキー**: Redmine の「個人設定」画面右側に表示されるAPIアクセスキー

### チケット一覧

「チケット一覧」で対象月（例: 2026年8月）を選び「一覧を取得」を押すと、その月に**作成または更新された**チケットが全ステータスで一覧表示される（ID降順）。各行には「クローズ」「進行中」のバッジを表示し、件数の内訳も表示する。

- Redmine のフィルタは OR を指定できないため、作成日（`created_on`）での絞り込みと更新日（`updated_on`）での絞り込みを別々に全件取得し、IDで重複を除いて結合している（`lib/redmine.ts` の `getIssuesCreatedOrUpdated()`）。上限は各1000件
- クローズかどうかは、Redmine 5.1 以降で issue の `status.is_closed` が返る場合はそれを使い、無い場合は `/issue_statuses.json` の `is_closed` で判定する

一覧は1ページ100件で、100件を超える場合は「前へ」「次へ」でページ送りできる（全件を取得したうえで画面側でページ送りする）。

一覧の行を**ダブルクリック**すると、そのチケットの詳細がダイアログで表示される。ダイアログには `id` / `subject` / `project.name` / `tracker.name` / `status.name` / `priority.name` / `author.name` / `assigned_to.name` / `created_on` / `updated_on` / `description` に加え、journals（履歴）のうち notes（コメント）を持つものが**全件**時系列順で表示される。デバッグ用に生のJSONレスポンスをダイアログ内の `<details>` に表示する。ダイアログは「閉じる」ボタンまたは Esc キーで閉じられる。

### docx(Zip)エクスポート

「クローズ済みをdocx(Zip)でエクスポート」を押すと、一覧と同じ条件（対象月に作成または更新）のうち**クローズ済み**のチケットを、次の構成の Zip（`redmine-YYYY-MM.zip`）としてダウンロードする。

```
redmine-2026-08.zip
└─ redmine-2026-08/
   └─ 1234/                              ← チケットID
      ├─ 1234_ログイン不具合の修正.docx   ← チケットID_件名
      ├─ エラー画面.png                    ← 添付ファイル（docx と同じ階層）
      └─ 修正仕様書.xlsx
```

- docx には、件名・Redmine へのリンク・メタ情報・説明・添付ファイル一覧（保存名/サイズ/登録者/登録日時/説明）・コメント（journals の notes）を載せる。プライベート注記は含めない
- ファイル名は Windows / SharePoint で使えない文字（`\ / : * ? " < > |` や制御文字）を `_` に置き換え、件名は50文字で切り詰める。同じフォルダ内で名前が重なった場合は `名前 (2).png` のように連番を付ける（大文字小文字は区別しない）
- 添付ファイルは1件100MB、エクスポート全体で1GBを上限とし、超過分や取得に失敗した分は取得せず、docx の添付一覧に理由を記載する
- 添付は Redmine が返す `content_url` を使わず、入力された Redmine URL と添付IDから `/attachments/download/:id` を組み立てて取得する（別ホストへの誘導を防ぐため）
- 終了後、エクスポート件数・取得に失敗したチケット・取得できなかった添付の件数を画面に表示する
- 1ファイルあたりの容量が大きいため、Zip は無圧縮（格納のみ）で作成する

### Markdownエクスポート

「MDでエクスポート」を押すと、対象月の条件（**起票日**の範囲、「MDエクスポートは完了（クローズ）済みのみ」チェックボックスの状態）に合致する**全チケット**（一覧のページ数に関わらず全件）を1つのMarkdownファイル（`redmine-YYYY-MM.md`）としてダウンロードする。

- 各チケットは見出し・メタ情報（プロジェクト/トラッカー/ステータス/優先度/起票者/担当者/日付）・説明・コメント（journalsのnotes）で構成される
- プライベート注記（`private_notes: true` のjournal）は本文に含めず、除外件数のみ front matter の `excluded_private_notes` に記録する
- 本文中の見出し記法（`#`〜`######`）や単独行の `---`/`===` はエスケープし、連結後のチケット区切り・見出し階層を壊さないようにしている
- 一覧取得はRedmineの `limit` 上限（100件）に従い自動でページングして全件取得する。チケット詳細（journals込み）の取得は並行数4で行い、一部失敗しても残りは出力する（失敗分は front matter の `failed_issue_count` と本文末尾の「取得に失敗したチケット」に記録）
- 安全のため1回のエクスポートで取得するチケット数には上限（既定1000件）があり、超過時は `truncated: true` として実際の取得件数を front matter に記録する

失敗時（一覧取得・詳細取得・エクスポートいずれも）は原因の見当がつくメッセージを画面にそのまま表示する。

- **401 / 403**: REST API が未有効化、またはAPIキーが不正
- **404**: チケットが存在しない、または閲覧権限がない
- **その他**: 接続元IP制限やネットワークの可能性

入力したRedmine URL・APIキーはブラウザのメモリ上（React state）にのみ保持され、どこにも保存されない。タブを閉じる・再読み込みすると消える。

## 構成

- `app/page.tsx`: 確認用画面（Client Component）。入力フォーム・一覧表示（ページネーション）・詳細ダイアログ・エクスポートボタン
- `app/api/issues/route.ts`: Route Handler。`month=YYYY-MM` で、その月に作成または更新されたチケットを全件返す。各チケットにクローズ済みかどうか（`is_closed`）を付ける
- `app/api/export-docx/route.ts`: Route Handler。対象月のクローズ済みチケットを、チケットごとの docx と添付ファイルにまとめた Zip として返す
- `app/api/issue/[id]/route.ts`: Route Handler。チケット1件を journals 込みで取得する
- `app/api/export/route.ts`: Route Handler。対象月の全チケットを取得し、Markdownとして返す（`Content-Disposition: attachment`）
- `lib/redmine.ts`: Redmine REST API クライアント（`import "server-only"`）。`getIssues()` / `getIssue()` に加え、全件ページング取得の `getAllIssues()`、作成または更新で絞る `getIssuesCreatedOrUpdated()`、チケット詳細の並行取得（失敗を個別集計）を行う `getIssuesDetailed()`、ステータス一覧の `getIssueStatuses()`、添付ファイル取得の `downloadAttachment()` を実装
- `lib/markdown.ts`: チケット配列をMarkdown文字列に変換する純粋関数（`issuesToMarkdown()`）
- `lib/docx.ts`: チケット1件を docx に変換する（`issueToDocx()`、`docx` パッケージを使用）
- `lib/filename.ts`: Zip 内のファイル名を Windows / SharePoint 向けに整える（`sanitizeFileName()`、重複時に連番を付ける `UniqueNamer`）
- `lib/issue-list.ts`: 一覧APIの応答型（画面からも参照するため `lib/redmine.ts` と分離）
- `lib/month.ts`: 対象月（`YYYY-MM`）から日付範囲・当月値を求めるヘルパ（クライアント/サーバ両方から利用するため `lib/redmine.ts` から分離）
- `lib/redmine-response.ts`: Route Handler で共通のRedmineエラー→JSONレスポンス変換

### Redmineのフィルタ仕様に関する注意

Redmine は `issues.json` のクエリに `f[]`（拡張フィルタ）を1つでも含めると、`status_id=` のような短縮フィルタを無視する。そのため「完了済みのみ」は `status_id` ではなく `f[]=status_id&op[status_id]=c`（`c` はクローズ演算子）として渡している（`lib/redmine.ts` の `getIssues()`）。実環境での挙動確認が必要な場合は、Redmine画面で同条件に絞った件数と一覧・エクスポートの件数を突合すること。

## セキュリティ上の注意

- Redmine の APIキーはクライアント（ブラウザ）に露出させない。Redmine への `fetch` は必ずサーバー側（Route Handler）で実行する。Redmine は CORS ヘッダを返さないため、ブラウザから直接叩くことはできない
- 画面から入力された Redmine URL は、SSRF対策として接続前に検証される。プロトコルは `http`/`https` のみを許可し、DNS解決した実IPがループバック（127.0.0.0/8）・プライベート（10/8, 172.16/12, 192.168/16）・リンクローカル（169.254.0.0/16、クラウドメタデータ含む）などの内部アドレスである場合は接続を拒否する（`lib/redmine.ts` の `assertSafeRedmineUrl`）
- 検証で使ったDNS解決結果のIPに直接接続する（`fetch` によるホスト名の再解決は行わない）。検証後にDNS応答を変えて内部アドレスへ誘導する DNS リバインディング（TOCTOU）を防ぐため（`lib/redmine.ts` の `pinnedRequest`）。TLS証明書の検証は接続先IPではなく本来のホスト名に対して行われる

## Windows実機検証パッケージ

このアプリはWindows PC上での実機検証を想定している。Node.js（Windows版）を同梱した検証用パッケージを2通りの方法で用意できる。

### 自動ビルド（GitHub Actions）

`main` への push をトリガーに、`.github/workflows/windows-package.yml` が以下を自動実行する。

1. 本番ビルド（`npm run build`）と standalone 出力の組み立て
2. Windows版Node.js（その時点の最新LTS）を、公式の `SHASUMS256.txt` でチェックサム検証したうえで同梱
3. 起動用 `start.bat` と説明書 `README.txt` を生成
4. パッケージ一式を `redmine-api-demo-win.zip` にまとめ、`redmine-api-demo-win` という名前で GitHub Actions の artifact として公開

リポジトリの Actions タブから該当の実行を開き、artifact をダウンロードする（GitHubアカウントでのログインが必要。artifact の保存期間はデフォルト90日）。GitHub はartifactを常にzipで包んでダウンロードさせるため、**展開すると中に `redmine-api-demo-win.zip` がもう一つ入っている**（二重zip）。そのzipをさらに展開すると `start.bat` などが出てくる。`workflow_dispatch` にも対応しているため、pushを待たずに手動実行もできる。

### ローカルでの手動パッケージ化

`.claude/skills/windows-package/SKILL.md` に、macOS上でこのアプリをビルドし、Windows実機検証用パッケージとしてデスクトップにフォルダを作成する手順を記載している。
