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

## `dropcaster dev` / `build` の仕組み（ユーザープロジェクト向け）

`dropcaster dev` / `dropcaster build` は Vite を **パッケージのディレクトリ** を `root` にして起動し、
`index.html` と `src/viewer/main.ts`（どちらもパッケージに同梱）をエントリにします。
ユーザーのギャラリー固有のもの — `sketches/` や `public/sketches.json` など — は Vite の
`publicDir` がユーザーの `cwd/public` を指すことで配信されます（`fs.allow` で `cwd` も許可）。
そのため、現状ユーザーは `index.html` を差し替えられません。`vite.config.ts` の sketches 監視
プラグインも `dropcaster dev` では効かない（`npm run dev` 専用）— `dropcaster dev --watch` は未実装。

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

## CI

- `.github/workflows/ci.yml` — PR と main push で `npm test` と両ビルド
  （`npm run build` / `npm run build:web`、それぞれ tsc を含む）、加えて
  `wrangler deploy --dry-run` を検証する。PR は CI が green であることを merge の前提とする
  （`verify` ジョブは main のブランチ保護で必須チェックに設定済み）。
- `.github/workflows/pr-policy.yml` — `pr-policy` ジョブが現在の PR タイトルを API から取得し、
  `scripts/check-pr-title.sh` で Conventional Commits 形式を検査する（squash merge の履歴に残るため）。
  タイトル・本文編集、Ready 化ではこの軽いワークフローだけ起動する。コード push では両方を起動する。
  `verify` / `pr-policy` のジョブ名と検査内容は分離前から維持し、ブランチ保護の必須チェック名を変えない。
  PR の base を変更した場合は、reopen または追加 push で新しい base に対する `verify` を実行してから merge する。
- `.github/workflows/deploy.yml` — main への push（対象パス変更時）で
  Cloudflare Workers へデプロイする。
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

`npm run test:projection-runtime` は両 viewer エントリで編集状態の停止・再開、テストパターン中の
作品切替、WebGL ロストからの復旧とキャンセルを検証する。実際の UI / popup / captureStream と
決定的な作品 fixture を使い、CI でも実行する。既存 Chromium は同じく `CHROMIUM_PATH` で指定する。
対象と検出確認は [状態・復旧の検証記録](docs/verification/124-runtime-recovery.md) を参照。

`npm run test:practice` は製品の個別作品／スライドショー UI からマッピングを起動し、実出力との併用、
3Dの遅延初期化・タブ非表示中の描画休止・明示的な実出力開始、投影ガイドの分離、既存編集、GLB／パッケージ保存、異常 import、容量不足、描画復旧・終了を両エントリで検証する。
`PRACTICE_ARTIFACT_DIR=/tmp/practice-images` でスクリーンショットを保存できる。
`PRACTICE_ENTRY=gallery|hosted`、`PRACTICE_CASE=workspace|workspaceSlideshow|lifecycle|projects|slideshow|recovery|outputs|unavailable|cancellation|loading|sample`
で失敗箇所だけを再実行できる。内蔵サンプルの実 UI は `/mapping`（`/practice` も互換 URL として維持）。GLB サンプルは `docs/samples/`。

## 注意点 / 既知の TODO

- `src/cli/` と `src/core/` は plain JS だが、`npm run check`（`tsc -p tsconfig.node.json`、
  JSDoc + checkJs 方式）で型チェックされる（CI でも実行）。この方式を選んだ理由と TypeScript
  化しない判断は [ADR 0005](docs/decisions/0005-jsdoc-checkjs-over-typescript.md) を参照。
  `src/core/modules/` の手書き
  `.d.ts` がそのまま型情報になるので、モジュールの公開面を変えたら `.d.ts` も更新すること。
  `sw-template.js` は SW コンテキストのコードなので検査対象外（tsconfig.node.json の exclude 参照）。
- 自動テスト: `npm test` で `node --test` ベースの最小回帰テストが走る（`tests/`）。現状カバーしているのは Service Worker 生成（`generateServiceWorker`）、scan の description 保持、srcdoc の組み立て（OP の p5js / html モードと Gist）、作品参照のパーサ、マッピング quad の凸判定と隅の移動制限（`src/viewer/utils/mappingTransform.ts`）。viewer の純関数は、他を import しない `.ts` なら `tests/` から拡張子付きで直接 import してテストできる（Node 24 の型除去で動く）。新機能を入れたら、回帰しやすい純粋関数・生成物は同様に追加してほしい。
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
`VENUE_ENTRY=gallery|hosted`、`VENUE_CASE=workflow|interaction|recovery|isolation` で絞り込める。
`VENUE_ARTIFACT_DIR=/tmp/venue-images` でスクリーンショットを保存できる。
`interaction` は実ポインタで移動・回転・サイズ・取消・undoを検証し、`workflow` は輪郭／グリッド／白黒の実ピクセル・popup・解像度・保存再開を確認する。
`recovery` は不正・遅延読込、GLB、容量不足、WebGL停止時の出力終了と書出を確認する。
`isolation` は作品の再生・マッピングの下書き・出力を保ったまま会場を作り、ファイルで明示反映する経路を確認する。
