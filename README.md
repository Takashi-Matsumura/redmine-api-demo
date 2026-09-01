# redmine-api-demo

Redmine REST API への疎通確認用の最小構成アプリ。チケットIDを1件指定して、内容が取得・表示できることだけを確認する検証ツール。一覧取得やページング、DB・キャッシュ層、認証機能は持たない。

## 使い方

開発サーバを起動する。

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開き、画面上のフォームに以下を入力して「取得」を押す。

- **Redmine URL**: 接続先 Redmine のベースURL（例: `https://my.redmine.jp/xxxxx`）
- **APIキー**: Redmine の「個人設定」画面右側に表示されるAPIアクセスキー
- **チケットID**: 取得したいチケットの数字ID

成功すると `id` / `subject` / `project.name` / `tracker.name` / `status.name` / `priority.name` / `author.name` / `assigned_to.name` / `created_on` / `updated_on` / `description`、および履歴（journals）の件数と最新3件のnotesが表示される。デバッグ用に生のJSONレスポンスを `<details>` 内に表示する。

失敗時は原因の見当がつくメッセージを画面にそのまま表示する。

- **401 / 403**: REST API が未有効化、またはAPIキーが不正
- **404**: チケットが存在しない、または閲覧権限がない
- **その他**: 接続元IP制限やネットワークの可能性

入力したRedmine URL・APIキーはブラウザのメモリ上（React state）にのみ保持され、どこにも保存されない。タブを閉じる・再読み込みすると消える。

### APIキーがまだない場合

画面の「サンプルデータで試す」ボタンを押すと、実際のRedmineには接続せず、ハードコードされたダミーデータで表示ロジックだけを確認できる。ネットワーク通信は発生しない。サンプルデータ表示中は画面上に注記が出るため、実データと混同することはない。

## 構成

- `app/page.tsx`: 確認用画面（Client Component）。入力フォームと結果表示
- `app/api/issue/[id]/route.ts`: Route Handler。`lib/redmine.ts` を呼び出し、Redmine からの応答をステータスに応じたメッセージに変換して返す
- `lib/redmine.ts`: Redmine REST API クライアント（`import "server-only"`）。チケット1件を取得する `getIssue()` のみを実装

## セキュリティ上の注意

- Redmine の APIキーはクライアント（ブラウザ）に露出させない。Redmine への `fetch` は必ずサーバー側（Route Handler）で実行する。Redmine は CORS ヘッダを返さないため、ブラウザから直接叩くことはできない
- 画面から入力された Redmine URL は、SSRF対策として接続前に検証される。プロトコルは `http`/`https` のみを許可し、DNS解決した実IPがループバック（127.0.0.0/8）・プライベート（10/8, 172.16/12, 192.168/16）・リンクローカル（169.254.0.0/16、クラウドメタデータ含む）などの内部アドレスである場合は接続を拒否する（`lib/redmine.ts` の `assertSafeRedmineUrl`）
- 検証で使ったDNS解決結果のIPに直接接続する（`fetch` によるホスト名の再解決は行わない）。検証後にDNS応答を変えて内部アドレスへ誘導する DNS リバインディング（TOCTOU）を防ぐため（`lib/redmine.ts` の `pinnedRequest`）。TLS証明書の検証は接続先IPではなく本来のホスト名に対して行われる
