# 開発ガイド

このリポジトリ自体（= dropcaster ツール本体）の開発メモです。
ギャラリーを作る側の使い方は [README.md](README.md) を参照してください。

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
  PR 時は `pr-policy` ジョブが `scripts/check-pr-title.sh` で PR タイトルの
  Conventional Commits 形式も検査する（squash merge でタイトルがそのまま履歴に残るため）。
- `.github/workflows/deploy.yml` — main への push（対象パス変更時）で
  Cloudflare Workers へデプロイする。
- `.github/workflows/freshness.yml` — 週次（月曜 09:00 JST）で `npm audit` と
  Markdown のリンク切れを検査し、検知したら label:freshness の Issue へ自動起票する。
- `.github/dependabot.yml` — npm と GitHub Actions の定期 version update（cooldown 7 日）。

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

## 注意点 / 既知の TODO

- `src/cli/` と `src/core/` は plain JS だが、`npm run check`（`tsc -p tsconfig.node.json`、
  JSDoc + checkJs 方式）で型チェックされる（CI でも実行）。`src/core/modules/` の手書き
  `.d.ts` がそのまま型情報になるので、モジュールの公開面を変えたら `.d.ts` も更新すること。
  `sw-template.js` は SW コンテキストのコードなので検査対象外（tsconfig.node.json の exclude 参照）。
- 自動テスト: `npm test` で `node --test` ベースの最小回帰テストが走る（`tests/`）。現状カバーしているのは Service Worker 生成（`generateServiceWorker`）と scan の description 保持。新機能を入れたら、回帰しやすい純粋関数・生成物は同様に追加してほしい。
- `dropcaster doctor` で FFmpeg / Chromium / Node の有無を確認できる。
- `.claude/settings.json` はこのリポジトリで頻繁に使う**読み取り・検証系コマンドだけ**を
  Claude Code に許可する。書き込み / 破壊系（`npm install`・`git push`・`gh pr create`・
  `wrangler deploy` など）は都度確認させるため意図的に入れていない。個人の一時的な許可は
  gitignore 済みの `.claude/settings.local.json` 側に置く。
