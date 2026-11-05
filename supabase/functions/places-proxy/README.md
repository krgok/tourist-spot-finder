# places-proxy(Google API の中継。Supabase Edge Function)

Google の API キーを**ブラウザに置かず**に、検索・経路・写真を使うための中継です(任意の機能)。
キーはサーバー側の秘密(環境変数)にだけ置き、ログイン済みの利用者(できれば家族だけ)が呼べます。

> **この関数は、デプロイしないと何も変わりません。** リポジトリのコードは、`js/config.js` の `API_PROXY_URL` が空(既定)の間は使われず、
> 従来どおり利用者自身の API キーをブラウザから使います。**デプロイ・秘密の設定は、あなたが行います**(以下の手順)。
> 秘密の値(キー・利用者の ID)をこのリポジトリに書かないでください。

## 何を守るか

- **認証**: `Authorization: Bearer <Supabase のログイン JWT>` を、サーバー側で Supabase Auth に問い合わせて検証(anon キーのトークンは通らない)
- **配信元(補助的な絞り込み)**: `ALLOWED_ORIGIN` に書いた origin(このアプリの URL)以外は 403。CORS も同じ origin にだけ。ただし `Origin` ヘッダーはブラウザ以外から偽装できるため、**これだけでは「ブラウザ以外を拒否」にはなりません**。実際の防御は、下の JWT の検証・利用者の限定・回数の制限です
- **利用者の限定(必須)**: `ALLOWED_USER_IDS` に書いた利用者以外は 403(**サインアップが開いていても、家族だけに絞れる**)。**未設定・空の場合は、設定ミスを防ぐため、すべての呼び出しを拒否(500)します**(`ALLOWED_ORIGIN` が未設定のときと同じ)
- **操作の固定**: `searchNearby` / `searchText` / `computeRoutes` / `photo` のみ。**フィールドマスク・件数(20)・順位付けはサーバー側で固定**(クライアントは料金の高い項目を要求できない)。半径は 100〜10000m、座標・言語・移動手段・タイプ名・写真名は形式を検査
- **キーの保護**: キーは `X-Goog-Api-Key` ヘッダーにだけ入れ(URL に入れない)、エラー文・応答・ログには出さない。写真は、キーを含まない Google の画像配信 URL(`googleusercontent.com` / `ggpht.com` の https のみ)だけを返す
- **回数の制限**: 1 人あたり 1 分 120 回(`RATE_LIMIT_PER_MIN` で変更。1 回の検索で、検索 1 回 + 写真の取得が最大 20 回呼ばれるため、余裕を持たせています)。**実行環境ごとのメモリ上の制限(ベストエフォート)**で、確実な上限ではありません。確実な上限は Google 側の割り当て(クォータ)で設定してください

## デプロイ手順(あなたが行う)

前提: [Supabase CLI](https://supabase.com/docs/guides/cli) をインストールし、`supabase login` 済みであること。以下の `<ref>` は Supabase プロジェクトの ref、`<...>` は自分の値に置き換えます。
(私はこの環境から Supabase に接続しないため、これらのコマンドは実行して確認していません。)

1. **サーバー用の Google API キーを新しく作る**(ブラウザ用のキーとは**別**)
   - API の制限: **Places API (New)** と **Routes API** だけ
   - アプリケーションの制限: なし(Edge Functions の送信元 IP は固定ではないため、IP や HTTP リファラーの制限は使えません)
   - **割り当て(クォータ)の 1 日の上限と、予算アラートを必ず設定**(アプリケーションの制限が使えない分、これが被害の上限になります)
2. **許可する利用者の ID を調べる**(必須。設定しないと関数は動きません。SQL Editor で自分のプロジェクトに対して実行)
   ```sql
   select id, email from auth.users;
   ```
3. **秘密を設定する**(値はシェルの履歴に残ります。気になる場合は `--env-file` を使い、ファイルはコミットしないでください)
   ```bash
   supabase secrets set GOOGLE_MAPS_SERVER_KEY='<サーバー用のキー>' ALLOWED_ORIGIN='https://<ユーザー名>.github.io' ALLOWED_USER_IDS='<id1>,<id2>' --project-ref <ref>
   ```
4. **デプロイする**(JWT の検証は**有効のまま**。`--no-verify-jwt` は付けない)
   ```bash
   supabase functions deploy places-proxy --project-ref <ref>
   ```
   (CLI が `supabase init` を求める場合は、リポジトリの直下で `supabase init` を実行してから、もう一度デプロイしてください。生成される `supabase/config.toml` に秘密は含まれませんが、内容を確認してからコミットしてください。)
5. **アプリに URL を設定する**: `js/config.js` の `API_PROXY_URL` を `https://<ref>.supabase.co/functions/v1/places-proxy` にする(CSP の `connect-src` が許可しているホストと同じです。テストが、Supabase と同じホストであることを検査します)。
6. **動作確認**: ログインして検索 → 一覧が出る/写真が出る/経路の時間が出る。**ログインしていないと検索ボタンが使えない**こと。許可していない別アカウントで「このアカウントには…許可されていません」と出ること。

## 地図について

地図の表示(Maps JavaScript API)は、ブラウザで Google のスクリプトを読み込むため、**ブラウザ用のキーが引き続き必要**です。
ただしこのキーは、**HTTP リファラー制限(このアプリの URL)と「Maps JavaScript API」だけ**に制限すれば、盗まれても Places/Routes は使えず、被害が小さくなります。
地図用のキーを設定しなくても、一覧・写真・経路の時間と距離は使えます(地図は出ません)。

## 費用・運用

- Edge Functions の呼び出し回数と、Google の API の料金がかかります(家族の利用なら小さい見込みですが、Supabase と Google の最新の料金・無料枠を確認してください)。
- Google が 401/403 を返した場合は「サーバー側の API キーの設定を確認してください」と表示されます(利用者のログインの問題ではありません)。Google Cloud で、キーの API の制限・有効化を確認してください。
- 共有の Supabase プロジェクトに置く場合、他アプリへの影響に注意してください(関数名 `places-proxy` は専用)。

## 元に戻す

1. `js/config.js` の `API_PROXY_URL` を `''`(空)に戻す(従来どおり、利用者自身のキーを使う動作に戻ります)
2. `supabase functions delete places-proxy --project-ref <ref>`、`supabase secrets unset GOOGLE_MAPS_SERVER_KEY ALLOWED_ORIGIN ALLOWED_USER_IDS --project-ref <ref>`
3. Google Cloud で、サーバー用のキーを削除

## テスト

`handler.js` は Deno に依存しない純粋なハンドラーで、`npm test`(`test/proxy.test.js`)で、認証・配信元・利用者の限定(未設定なら拒否)・回数制限・入力の検証・エラーの扱い・キーが出力されないこと・フィールドマスクのクライアントとの一致を検査しています。
**`index.ts`(Deno の入口)だけは、ローカルに Deno が無いため未テストです**。デプロイ後の動作確認(上の 6)で確かめてください。
