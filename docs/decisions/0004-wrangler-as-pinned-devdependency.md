# 0004: wrangler は devDependency に固定し、action を挟まず直接呼ぶ

- **状態**: 採用（2026-08-04）
- **文脈**: ホスト版のデプロイに `cloudflare/wrangler-action` を使っていた。action は自前で `npm i wrangler@4` を走らせて毎回最新版を引くため、wrangler の peerOptional である `@cloudflare/workers-types` が major 更新されるたびに ERESOLVE で落ちる。しかも CI（テスト・ビルド）は緑のままなので破損に気付けず、2026-07-19〜08-04 の 6 回にわたってデプロイだけが失敗し続けた（[#44](https://github.com/shinyaoguri/dropcaster/issues/44)）。
- **決定**:
  - wrangler は `devDependencies` に置き、版は lockfile と Dependabot PR + CI で管理する。デプロイは `npx wrangler deploy` を直接実行する
  - `@cloudflare/workers-types` は wrangler の peer に合わせて上げる（現在 v5 系）
  - デプロイ経路の破損を PR 時点で検出するため、CI に `wrangler deploy --dry-run`（API トークン不要でバンドルまで実行）を入れる
  - 推移的依存の undici（wrangler → miniflare → undici）は miniflare が exact pin していて advisory の patched（>= 7.29.0）に届かないため、`package.json` の `overrides` で `undici: ^7.29.0` に引き上げる
- **影響**:
  - override を消してよいのは、wrangler / miniflare 側が undici の patched 版に追いついたときだけ。消すと `npm audit` に 3 件出て、Dependabot の security update が「推移的依存なので上げられない」と毎回失敗し、その失敗が常態化する
  - `npm audit fix --force` は wrangler のダウングレードを提案してくるので実行しないこと
  - override 下でも `wrangler dev`（miniflare 経由）が起動して 200 を返すことは確認済み
  - 「CI は緑なのに本番経路だけ壊れる」型の破損に対しては、本番と同じ経路を dry-run で踏むのが有効という一般則を得た。同種のチェックを増やすときはこの ADR を参照する
