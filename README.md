# redmine-api-demo

Redmine REST API への疎通確認用の最小構成アプリ。対象月を指定してチケット一覧を取得し、一覧の行をダブルクリックするとチケット1件の内容（コメント履歴を含む）をダイアログで確認できる検証ツール。DB・キャッシュ層、認証機能は持たない。

## 使い方

開発サーバを起動する。

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開き、画面上部に以下を入力する。

- **Redmine URL**: 接続先 Redmine のベースURL（例: `https://my.redmine.jp/xxxxx`）
- **APIキー**: Redmine の「個人設定」画面右側に表示されるAPIアクセスキー

入力後、「チケット一覧」で対象月（例: 2026年8月）を選び「一覧を取得」を押すと、その月に起票された全ステータス（完了済みも含む）のチケットが一覧表示される（最大100件、`sort=id:desc` で新しい順）。

一覧の行を**ダブルクリック**すると、そのチケットの詳細がダイアログで表示される。ダイアログには `id` / `subject` / `project.name` / `tracker.name` / `status.name` / `priority.name` / `author.name` / `assigned_to.name` / `created_on` / `updated_on` / `description` に加え、journals（履歴）のうち notes（コメント）を持つものが**全件**時系列順で表示される。デバッグ用に生のJSONレスポンスをダイアログ内の `<details>` に表示する。ダイアログは「閉じる」ボタンまたは Esc キーで閉じられる。

失敗時は原因の見当がつくメッセージを画面にそのまま表示する。

- **401 / 403**: REST API が未有効化、またはAPIキーが不正
- **404**: チケットが存在しない、または閲覧権限がない
- **その他**: 接続元IP制限やネットワークの可能性

入力したRedmine URL・APIキーはブラウザのメモリ上（React state）にのみ保持され、どこにも保存されない。タブを閉じる・再読み込みすると消える。

## 構成

- `app/page.tsx`: 確認用画面（Client Component）。入力フォーム・一覧表示・詳細ダイアログ
- `app/api/issues/route.ts`: Route Handler。チケット一覧を取得する。`status_id` 未指定時は全ステータス（`*`）を対象にし、対象月の範囲は `created_on_from`/`created_on_to` パラメータで受け取り Redmine の拡張フィルタ（`f[]=created_on&op[created_on]=><`）に変換する
- `app/api/issue/[id]/route.ts`: Route Handler。チケット1件を journals 込みで取得する
- `lib/redmine.ts`: Redmine REST API クライアント（`import "server-only"`）。`getIssues()` / `getIssue()` を実装

## セキュリティ上の注意

- Redmine の APIキーはクライアント（ブラウザ）に露出させない。Redmine への `fetch` は必ずサーバー側（Route Handler）で実行する。Redmine は CORS ヘッダを返さないため、ブラウザから直接叩くことはできない
- 画面から入力された Redmine URL は、SSRF対策として接続前に検証される。プロトコルは `http`/`https` のみを許可し、DNS解決した実IPがループバック（127.0.0.0/8）・プライベート（10/8, 172.16/12, 192.168/16）・リンクローカル（169.254.0.0/16、クラウドメタデータ含む）などの内部アドレスである場合は接続を拒否する（`lib/redmine.ts` の `assertSafeRedmineUrl`）
- 検証で使ったDNS解決結果のIPに直接接続する（`fetch` によるホスト名の再解決は行わない）。検証後にDNS応答を変えて内部アドレスへ誘導する DNS リバインディング（TOCTOU）を防ぐため（`lib/redmine.ts` の `pinnedRequest`）。TLS証明書の検証は接続先IPではなく本来のホスト名に対して行われる

## Windows実機検証パッケージ

このアプリはWindows PC上での実機検証を想定している。Node.js（Windows版）を同梱した検証用パッケージを2通りの方法で用意できる。

### 自動ビルド（GitHub Actions）

`main` への push をトリガーに、`.github/workflows/windows-package.yml` が以下を自動実行する。

1. 本番ビルド（`npm run build`）と standalone 出力の組み立て
2. Windows版Node.js（その時点の最新LTS）を自動取得して同梱
3. 起動用 `start.bat` と説明書 `README.txt` を生成
4. `redmine-api-demo-win` という名前で GitHub Actions の artifact として公開

リポジトリの Actions タブから該当の実行を開き、artifact の zip をダウンロードすればよい（GitHubアカウントでのログインが必要。artifact の保存期間はデフォルト90日）。`workflow_dispatch` にも対応しているため、pushを待たずに手動実行もできる。

### ローカルでの手動パッケージ化

`.claude/skills/windows-package/SKILL.md` に、macOS上でこのアプリをビルドし、Windows実機検証用パッケージとしてデスクトップにフォルダを作成する手順を記載している。
