# 開発ガイド

このリポジトリ自体（= dropcaster ツール本体）の開発メモです。
ギャラリーを作る側の使い方は [README.md](README.md) を参照してください。
Issue・PR・着手・レビューの共通規約は [AGENTS.md](AGENTS.md)、参加の入口は
[CONTRIBUTING.md](CONTRIBUTING.md)、エージェント設定は
[docs/agent-environment.md](docs/agent-environment.md) を参照してください。

## リポジトリ構成

- `src/viewer/` — ビューワ（純静的な SPA。実行時に Node は不要）。`vite` でビルドされ、
  公開パッケージにはソースのまま同梱される（消費側の Vite がビルドする）。
- `src/cli/` — `dropcaster` CLI（`commander` ベース）。`commands/`（init / scan / build / dev /
  preview / doctor）と `utils/`（config / manifest / service-worker / files）。
- `src/core/` — コンテンツパイプライン（Node 専用。`sketches/` に変更があったときだけ走る）。
  `scan-sketches.js`（スキャン → `public/sketches/` へコピー → `public/sketches.json` 生成 →
  プレビュー GIF 生成 → OpenProcessing メタデータ取得）と `modules/`。
- `index.html` / `vite.config.ts` / `tsconfig.json` — ビューワのエントリと Vite/TS 設定。
  これらも公開パッケージに含まれる。
- `sketches/` / `public/` — このリポジトリではローカル動作確認用なので git 管理しない（`.gitignore`）。
  `dropcaster init` で作るギャラリー側はこれらをコミットする。

## このリポジトリで開発する

```bash
npm install              # 依存をインストール（Chromium は自動 DL しない。プレビュー生成には `npx dropcaster doctor --install`）
npm run dev              # ビューワを Vite dev サーバで起動（ポート競合時は別ポートに）
npm run build            # tsc + vite build → dist/
npm run scan             # sketches/ をスキャン（プレビュー生成 ＋ OpenProcessing メタ取得）
npm run scan:reset       # public/sketches と public/previews を作り直してスキャン
npm run scan:watch       # sketches/ を監視してメタデータだけ更新（nodemon）
```

`npm run dev` は viewer のソース変更をホットリロードしますが、`sketches/` の変更は
`npm run scan` を実行するまで反映されません（意図的に明示 scan）。

dev サーバ（`npm run dev` / `npm run dev:web`、利用者の `dropcaster dev`）では Service Worker を登録しません (#180)。
SW はローカル作品を StaleWhileRevalidate で返すので、登録すると作品を書き換えても 1 回目の再読み込みに古い版が出るためです。
`src/cli/utils/dev-service-worker.js` の Vite プラグイン（`vite.config.ts` と `apps/web/vite.config.ts` に入っている）が、
viewer に dev サーバで動いていることを伝え（`src/viewer/pwa/register.ts` が登録をやめる）、配信する index.html の先頭に
「同じオリジンに残っている登録を外し、制御されていたら 1 度だけ読み込み直す」スクリプトを入れます。
PWA の挙動（オフライン起動・更新の通知）は本番ビルドで確かめます。

```bash
npm run build && npx vite preview          # ユーザーギャラリー → http://localhost:4173
npm run build:web && npm run preview:web   # ホスト版
dropcaster build && dropcaster preview     # 利用者のギャラリー（下の「CLI をローカルプロジェクトでテストする」）
```

## `dropcaster dev` / `build` の仕組み（ユーザープロジェクト向け）

`dropcaster dev` / `dropcaster build` は Vite を **パッケージのディレクトリ** を `root` にして起動し、
`index.html` と `src/viewer/main.ts`（どちらもパッケージに同梱）をエントリにします。
ユーザーのギャラリー固有のもの — `sketches/` や `public/sketches.json` など — は Vite の
`publicDir` がユーザーの `cwd/public` を指すことで配信されます（`fs.allow` で `cwd` も許可）。
そのため、現状ユーザーは `index.html` を差し替えられません。`vite.config.ts` の sketches 監視
プラグインも `dropcaster dev` では効かない（`npm run dev` 専用）— `dropcaster dev --watch` は未実装。

Vite は `root` にある `vite.config.ts` も読むので、上の「dev サーバでは Service Worker を登録しない」プラグインは
`dropcaster dev` にも掛かります。`dropcaster dev` は `public/manifest.json` だけを生成し、`sw.js` は生成しません
（以前の版が `public/sw.js` を残していても登録されません）。`sw.js` を出力先に生成するのは `dropcaster build` です。

## CLI をローカルプロジェクトでテストする

```bash
# このリポジトリ内で:
npm link
# 別ディレクトリで:
mkdir /tmp/test-gallery && cd /tmp/test-gallery
npm link dropcaster
dropcaster init .            # or: npx /path/to/dropcaster init .

# あるいは npm link せずに直接:
npx /path/to/dropcaster init my-gallery
```

`npm link` がおかしくなったら `npm unlink -g dropcaster && npm link` で貼り直す。

## 配布

- GitHub から直接: `npm install -g github:shinyaoguri/dropcaster` / `npx github:shinyaoguri/dropcaster init my-gallery`
- npm へ公開する場合: `prepublishOnly` が `npm run build` を走らせる（成果物の dist はパッケージには
  含めず、消費側 Vite がビルドする方針 — `package.json` の `files` を参照）。

## リリース

判断は [ADR 0022](docs/decisions/0022-release-by-tags-and-changelog-fragments.md)。版の正本は `v<major>.<minor>.<patch>` のタグで、
`package.json` の version（`0.0.0-dev`）は動かさない。

- `feat` / `fix` / `perf` と破壊的変更の PR には `changelog.d/<slug>.<分類>.md` を 1 つ追加する
  （書き方は [changelog.d/README.md](changelog.d/README.md)）。利用者に見えない変更はラベル `changelog: none`。
- `.github/workflows/release.yml` が毎週月曜（と手動の `workflow_dispatch`）に、前回のタグ以降に増えた断片を束ねて
  タグと GitHub Release を作り、ホスト版を作り直す。断片が増えていなければ何もしない。
- 手元で次の版とノートを見る: `node scripts/release.js next-version` / `node scripts/release.js notes`
  （断片はコミット済みのものだけ数える）。
- 版の表示は `src/core/build-info.js` が `git describe` で求める。浅い clone（`fetch-depth: 1`）ではタグが取れず版不明になる。
- `src/core/build-info.js` と `scripts/release.js` が呼ぶ git は、`GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` など
  読むリポジトリを差し替える環境変数を引き継がない（`src/core/git-env.js`）。linked worktree の git hook の中から
  実行しても、パッケージ（`release.js` は cwd）のリポジトリを読む。環境変数で読み先を差し替えることはできない。

## CI

- `.github/workflows/ci.yml` — PR と main push で `npm test` と両ビルド
  （`npm run build` / `npm run build:web`、それぞれ tsc を含む）、加えて
  `wrangler deploy --dry-run` を検証する。PR は CI が green であることを merge の前提とする
  （`verify` ジョブは main のブランチ保護で必須チェックに設定済み）。
- `.github/workflows/pr-policy.yml` — `pr-policy` ジョブが現在の PR タイトルを API から取得し、
  `scripts/check-pr-title.sh` で Conventional Commits 形式を検査する（squash merge の履歴に残るため）。
  あわせて `node scripts/release.js check-pr` で変更履歴の断片の有無を検査する（ラベルの付け外しでも走り直す）。
  タイトル・本文編集、Ready 化ではこの軽いワークフローだけ起動する。コード push では両方を起動する。
  `verify` / `pr-policy` のジョブ名と検査内容は分離前から維持し、ブランチ保護の必須チェック名を変えない。
  PR の base を変更した場合は、reopen または追加 push で新しい base に対する `verify` を実行してから merge する。
- `.github/workflows/deploy.yml` — main への push（対象パス変更時）で
  Cloudflare Workers へデプロイする。

### ホスト版の secret（Gist 中継）

ホスト版の `/gist-api/*` は、Worker の secret `GITHUB_TOKEN` で GitHub API に問い合わせる
（[ADR 0017](docs/decisions/0017-hosted-gist-api-proxy.md)）。viewer が使うのは、`api.github.com` への
直接取得が制限や障害で使えないときだけ（[ADR 0018](docs/decisions/0018-gist-direct-first.md)）。
未設定のあいだ Worker は 503 を返し、viewer は直接取得のエラーを出すので、登録前にデプロイしても
挙動は中継の無い場合と同じになる。

1. GitHub で fine-grained personal access token を作る。Repository access は
   「Public repositories (read-only)」、Permissions は何も付けない（公開 Gist の読み取りに権限は要らない）。
   有効期限を設け、失効前に作り直す。
2. `cd apps/web && npx wrangler secret put GITHUB_TOKEN` で登録する（値はプロンプトで入力し、ファイルやコマンドラインに残さない）。
3. デプロイ後に `curl -sI https://<ホスト版のドメイン>/gist-api/gists/<公開 Gist の ID>` を実行し、
   応答ヘッダの `x-dc-gist-proxy` が `miss` / `revalidated` / `hit` のいずれかであること
   （`unconfigured` や `error` でないこと）を確かめる。ブラウザのアドレス欄で開くとナビゲーション要求になり、
   SPA fallback の index.html が返ることがあるので、curl か `fetch` で確かめる。
4. トークンが失効したり枠が尽きたりすると、中継は上流のエラーを返し、IP の枠が枯れた利用者には
   直接取得の制限エラーが出る。
   Workers Logs に `gist-proxy: GitHub responded ...` が出ていたらトークンを作り直して登録し直す。

手元で Worker ごと確かめるときは、`npm run build:web` のあと `apps/web` で `npx wrangler dev` を起動する。
トークンは gitignore 済みの `apps/web/.dev.vars` に `GITHUB_TOKEN=...` と書くか、
`CLOUDFLARE_INCLUDE_PROCESS_ENV=true` を付けて環境変数で渡す。`npm run dev:web`（Vite）は
`/gist-api` を `api.github.com` へ認証なしで転送するだけなので、中継の挙動は確かめられない。
- `.github/workflows/freshness.yml` — 週次（月曜 09:00 JST）で `npm audit` と
  Markdown のリンク切れを検査し、検知したら label:freshness の Issue へ自動起票する。
- `.github/dependabot.yml` — npm と GitHub Actions の定期 version update（cooldown 7 日）。

### 手元で検証する範囲

手元では次の対応から触った範囲を確認し、CI が全段を実行する。
テスト・ビルドは変更したソースと同じ版で実行し、失敗ログを再実行前に git 管理外へ保存する。

| 変更するもの | 確認するもの |
| --- | --- |
| CLI / core / scripts / JS テスト | `npm run check`、`npm test`。CLI の利用経路は上記の別ギャラリーでも確認 |
| viewer / 共有型 | `npm test`、`npm run build`、`npm run build:web` と、以下の該当ブラウザテストを両エントリで確認 |
| Worker / hosted 設定 | `npm run build:web`、`cd apps/web && npx wrangler deploy --dry-run` |
| 3D PoC | `npm run build:poc`、`npm run test:poc` |
| 会場の逆算 (`src/viewer/venue/venueReconstruct.ts`) | `npm test` に加え、精度の変化は `node poc/venue-reconstruct/bench.ts` の表で比べる ([README](poc/venue-reconstruct/README.md)) |
| Issue / PR テンプレート・文書 | YAML / Markdown リンク / symlink、変更前後の例と手順の整合性 |
| GitHub Actions | `actionlint`、起動イベント・権限・必須ジョブ名・既存検証段の維持、PR の実行結果 |

表示・動きの証跡と独立した反証は AGENTS.md の場面別スキルを使う。
性能の判断は dev サーバの数値で決めず、本番ビルドと同じ入力・解像度・ブラウザ・GPU で測る。
待ちを含むテストや外部プロセスにはタイムアウトと後始末を持たせる。

### wrangler は devDependency で固定し、直接呼ぶ

デプロイは `cloudflare/wrangler-action` ではなく `npx wrangler deploy` を直接実行し、
wrangler は `devDependencies` に置いて lockfile で版を固定する。`@cloudflare/workers-types`
は wrangler の peer に合わせて上げる（現在 v5 系）。推移的依存の undici は
`package.json` の `overrides` で `^7.29.0` に引き上げてある。

**この override を消さないこと**、`npm audit fix --force` を実行しないこと。
背景と、消したときに何が起きるかは
[ADR 0004](docs/decisions/0004-wrangler-as-pinned-devdependency.md) を参照。

## 設計判断の記録

確定した設計判断・検討して断念した方向は [docs/decisions/](docs/decisions/) に
1 判断 1 ファイルで置く。再挑戦・方針変更のときはまずここを読む。

### マッピング描画のブラウザ回帰確認

`node tests/browser/mapping-css-regression.mjs` は両 Vite エントリを起動し、実際の出力
ウィンドウの描画を変更前の固定 CSS と比較する。Playwright の Chromium が必要。
既存ブラウザを使う場合は `CHROMIUM_PATH=/path/to/chromium` を指定する。
`MAPPING_ARTIFACT_DIR=/tmp/mapping-images` で代表画像と失敗画像を保存できる。
`npm test` には含めず、通常の純粋関数テストはブラウザのインストールなしで実行できる。
対象・制約は [#124 の検証記録](docs/verification/124-projection-foundation.md) を参照。

3D 描画実験は `npm run dev:poc`、型検査とビルドは `npm run build:poc`、CSS/GPU・遮蔽・
寿命のブラウザ確認は `npm run test:poc`。CI は runner の Chrome / Chromium を優先し、
なければ Playwright の Chromium を入れて実行する。
操作と測定方法は [PoC README](poc/projection-3d/README.md) を参照。

`npm run test:sw` は生成した Service Worker を実 Chromium で動かし、作品 iframe を開いた後も
オフラインのホームにシェルが、各作品に自分の HTML が返ること、作品のサブリソースと作品カタログが
local のバケットだけに入ること（以前の版が runtime に入れたものは有効化のときに移ること）を
ルート配信とサブパス配信で確かめる
（viewer のビルドは不要。`CHROMIUM_PATH` も同じく使える）。SW テンプレートを変えたら実行する。
続けて `tests/browser/service-worker-update.mjs` が両 viewer エントリと、利用者の `dropcaster build --base /sub/`
（terser・manualChunks・サブパス配信）を OS の一時ディレクトリへビルドし、出力ウィンドウを開いたまま新しい版の
sw.js を配信しても、操作画面が再読み込みされず出力が映り続けること、更新の通知が操作画面にだけ出て押したときだけ
適用されること、この変更より前の版のページが送る `SKIP_WAITING` では切り替わらないこと、初回訪問で再読み込み
しないこと、全ウィンドウを閉じると新しい版になり、そのときオフラインでもアプリ・作品カタログ・遅延読み込みの画面が
開くこと、install 中にシェルの資産が 1 つでも取れなければ新しい版が待機に入らず旧版のまま動くこと、2 回更新しても
中身のバケットが 1 組のまま引き継がれ shell だけが入れ替わること、SW の無い環境で遅延チャンクが取れなければ
再読み込み（オフラインなら接続の確認）を案内することを確かめる (#164)。
`src/viewer/pwa/` を変えたときも実行する。`SW_UPDATE_ENTRY=gallery|hosted|cli-subpath`、`SW_UPDATE_CASE=<ケース名>`
で絞り込め、`SW_UPDATE_ARTIFACT_DIR=/tmp/sw-update-images` で通知の表示を保存できる。
最後に `tests/browser/service-worker-dev.mjs` が dev サーバ（利用者の `dropcaster dev`・`npm run dev`・`npm run dev:web`）を
実際に起動し、SW が登録されないこと、作品を書き換えるたびに 1 回目の再読み込みで新しい内容が出ること、同じオリジンに
SW とキャッシュが残っているブラウザ（残った SW が古い viewer を返し、応答の返らない要求を抱えている状態）でも
開けば登録が外れて同じになること、`dropcaster build` + `dropcaster preview` では今までどおり登録されることを確かめる (#180)。
dev サーバの設定（`src/cli/commands/dev.js`・両 `vite.config.ts`・`src/cli/utils/dev-service-worker.js`）を変えたときも実行する。
`SW_DEV_ENTRY=cli|gallery|hosted|cli-preview`、`SW_DEV_CASE=<ケース名>` で絞り込める。

`npm run test:routes` は両 viewer エントリで、Gist / OpenProcessing の取得や作品 iframe の読み込みを
保留したまま別ルートへ移り、遅れて届いた成功・失敗の結果が今の画面を上書きしないこと、破棄した
作品ページが離脱警告などのリスナーを付け直さないことを確かめる。ルート遷移・`App.ts` の世代確認・
`SketchPageController` の後始末を変えたら実行する。`ROUTES_CASE=<ケース名>` で 1 件だけ流せる。
Gist と OpenProcessing の html モードの作品を実際に開き、埋め込んだ script・CSS が元のファイル構成と同じに
働くこと (#110)、クエリ・`%XX`・`#` を含む参照のファイルが読み込まれること (#211) も確かめるので、
`src/core/modules/html-doc-builder.js` の埋め込みを変えたときも実行する。
同じスイートの `galleryHeader` は、ギャラリーのホームを幅 1600 / 1280 / 960 / 800 / 375px・英語と日本語で開き、
見出しとヘッダーのボタン列が重ならず、ボタンが画面内にあって押せることを矩形で確かめる (#178)。
ホームのヘッダー (`SketchGalleryView`、`style.css` の `.header`) を変えたら実行する。
`heroTooltip` は、カタログが空のホーム (hero) を英語と日本語で開き、幅 320 / 375 / 768px (ブラウザの文字サイズ 16px)、
768 / 900px (20px)、1024px (24px) で、ページが横にはみ出さないこと、「?」のツールチップが非表示のときも、
フォーカス・hover で表示したときも画面内にあり、48em 以上の幅では「?」の真上に出ることを確かめる (#284)。
hero (`OpIdEntryView`、`style.css` の `.op-hero-*`) を変えたら実行する。

`npm run test:slideshow` は両 viewer エントリのスライドショーで iframe ごとの rAF 回数を数え、
先読みした非表示の作品が待機中に描画せず、表示した作品だけが動くことを確かめる。Next / Previous、
連続切替、読み込み中の切替、待機中のリサイズ、マッピング中の出力も含む。`SketchPool` / `SketchFrame` の
pause・resume・先読み、`SlideshowView` の切替を変えたら実行する。`SLIDESHOW_ENTRY=gallery|hosted`、
`SLIDESHOW_CASE=<ケース名>` で絞り込め、`SLIDESHOW_ARTIFACT_DIR=/tmp/slideshow-images` で切替前後の
スクリーンショットを保存できる。

`npm run test:projection-runtime` は両 viewer エントリで編集状態の停止・再開、テストパターン中の
作品切替、WebGL ロストからの復旧とキャンセル、メイン画面が隠れたときの出力ウィンドウの案内 (#185) を
検証する。実際の UI / popup / captureStream と
決定的な作品 fixture を使い、CI でも実行する。既存 Chromium は同じく `CHROMIUM_PATH` で指定する。
`RUNTIME_CASE=<ケース名>` で 1 件だけ流せ、`RUNTIME_ARTIFACT_DIR=/tmp/runtime-images` で案内の出た出力を保存できる。
Playwright の Chromium は自動化中のページを常に visible に保つため、メイン画面の hidden は
`tests/browser/lib/main-hidden-notice.mjs` が `visibilityState` と `visibilitychange` を差し替えて再現する。
対象と検出確認は [状態・復旧の検証記録](docs/verification/124-runtime-recovery.md) を参照。

`npm run test:practice` は製品の個別作品／スライドショー UI からマッピングを起動し、実出力との併用、
3Dの遅延初期化・タブ非表示中の描画休止・明示的な実出力開始、投影ガイドの分離、既存編集、GLB／パッケージ保存、異常 import、容量不足、描画復旧・終了を両エントリで検証する。
`projects` は `/project` を開けなかったときの案内が原因 (下書きが無い・読み出せない・作品を取得できない・開く途中の失敗) ごとに分かれ、保存・読み出しの元の例外が console に残ること (#198) も確かめる。
`pinning` は OP / Gist 作品のコードの固定 (#197) を LAN の http（secure context でない、`--host-resolver-rules` で作る）で確かめる。
取得元 (OpenProcessing API・Gist API) を route で差し替えて内容を変えても固定時のコードで開き、取得元へ問い合わせないこと、
最新版の取得の失敗で固定を保つこと、書き出しにコードが入らないこと、受け取った側の照合と固定し直し、スライドショーでの解決を見る。
`src/viewer/practice/sketchSnapshot.ts`・`snapshotStore.ts`、`ProjectPanel` の作品一覧、`App.ts` の `/project` の解決を変えたら実行する。
`PRACTICE_ARTIFACT_DIR=/tmp/practice-images` でスクリーンショットを保存できる。
`PRACTICE_ENTRY=gallery|hosted`、`PRACTICE_CASE=workspace|workspaceSlideshow|lifecycle|projects|slideshow|recovery|outputs|unavailable|cancellation|loading|sample|slideshowDraft|pinning`
で失敗箇所だけを再実行できる。内蔵サンプルの実 UI は `/mapping`（`/practice` も互換 URL として維持）。GLB サンプルは `docs/samples/`。

## 注意点 / 既知の TODO

- `src/cli/` と `src/core/` は plain JS だが、`npm run check`（`tsc -p tsconfig.node.json`、
  JSDoc + checkJs 方式）で型チェックされる（CI でも実行）。この方式を選んだ理由と TypeScript
  化しない判断は [ADR 0005](docs/decisions/0005-jsdoc-checkjs-over-typescript.md) を参照。
  `src/core/modules/` の手書き
  `.d.ts` がそのまま型情報になるので、モジュールの公開面を変えたら `.d.ts` も更新すること。
  `sw-template.js` は SW コンテキストのコードなので検査対象外（tsconfig.node.json の exclude 参照）。
- 自動テスト: `npm test` で `node --test` ベースの最小回帰テストが走る（`tests/`）。現状カバーしているのは Service Worker 生成（`generateServiceWorker`）、scan のタイトル・説明の優先順位と保持、srcdoc の組み立て（OP の p5js / html モードと Gist）、作品参照のパーサ、マッピング quad の凸判定と隅の移動制限（`src/viewer/utils/mappingTransform.ts`）。viewer の純関数は、他を import しない `.ts` なら `tests/` から拡張子付きで直接 import してテストできる（Node 24 の型除去で動く）。新機能を入れたら、回帰しやすい純粋関数・生成物は同様に追加してほしい。
- 取り込み元（OpenProcessing / 公開 Gist）を増やすときは、srcdoc の組み立てを
  `src/core/modules/html-doc-builder.js` に載せ、参照の判定を `sketch-ref.js` に足す。
  判断の背景は [ADR 0006](docs/decisions/0006-gist-as-second-sketch-source.md) を参照。
  viewer の変更はユーザーギャラリー（`npm run dev`）とホスト版（`npm run dev:web`）の
  両経路で確認すること。
- `dropcaster doctor` で FFmpeg / Chromium / Node の有無を確認できる。
- `.claude/settings.json` はこのリポジトリで頻繁に使う**読み取り・検証系コマンドだけ**を
  Claude Code に許可する。書き込み / 破壊系（`npm install`・`git push`・`gh pr create`・
  `wrangler deploy` など）は都度確認させるため意図的に入れていない。個人の一時的な許可は
  gitignore 済みの `.claude/settings.local.json` 側に置く。

`npm run test:venue` は独立した `/venue` のGUI操作・実出力・共有・マッピングとの分離を両viewerで検証する。
`VENUE_ENTRY=gallery|hosted`、`VENUE_CASE=workflow|interaction|recovery|assets|isolation|reload` で絞り込める。
`VENUE_ARTIFACT_DIR=/tmp/venue-images` でスクリーンショットを保存できる。
`interaction` は実ポインタで移動・回転・サイズ・取消・undoを検証し、`workflow` は輪郭／グリッド／白黒の実ピクセル・popup・解像度・保存再開を確認する。
`recovery` は不正・遅延読込、GLB、容量不足、WebGL停止時の出力終了と書出を確認する。
画面のコードを取得できないとき・WebGL 以外の理由で始められないときに 3D 描画の停止と案内しないこと、保存・読み出しの元の例外が console に残ること (#198) も確かめる。
`assets` は GLB の会場で、校正値の確定と取り消しが GLB を復号し直さないこと、GLB・会場ファイル・マッピングの下書き・保存済みの下書きから
入るものは毎回検証することを、GLB の復号 (`atob`) の回数で確かめる (#171)。`VenueCalibrationPage` の `commit` / `apply` や
`parseProject` のアセットの扱いを変えたら実行する。
`isolation` は作品の再生・マッピングの下書き・出力を保ったまま会場を作り、ファイルで明示反映する経路を確認する。
`workflow` と `isolation` は、会場の画面が隠れたときに校正ウィンドウで操作している間だけ案内が出ること (#185) も確かめる。
