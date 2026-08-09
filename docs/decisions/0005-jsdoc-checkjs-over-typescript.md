# 0005: Node 側は plain JS + JSDoc + checkJs で型を担保し、TypeScript には移行しない

- **状態**: 採用（2026-07-19）
- **文脈**: `src/cli/` と `src/core/` は plain JS で型チェックも lint も無く、退行検出が人手レビュー頼りだった（[#33](https://github.com/shinyaoguri/dropcaster/issues/33)）。選択肢は JSDoc + `tsc --checkJs` / TypeScript 化 / ESLint の 3 つ。`src/core/modules/` には既に手書きの `.d.ts` があり、型情報の資産が JS 側に寄っていた。
- **決定**:
  - Node 側（cli / core / scripts / tests）は plain JS のまま維持し、型は JSDoc で書いて `tsconfig.node.json`（`allowJs` + `checkJs`、`strict: false`）で検査する。実行は `npm run check`、CI の verify ジョブでも走らせる
  - 型の正本は `src/core/modules/*.d.ts` に置き、JSDoc は typedef 経由で参照するだけにする（二重管理にしない）
  - `sw-template.js` は Service Worker コンテキストで実行されるコードの正本なので検査対象から外す
  - viewer は TypeScript（`tsconfig.json`）、worker は `apps/web/tsconfig.json` が担う。この 3 分割を保つ
- **影響**:
  - 依存追加は `@types/node` のみで済み、素振りの時点で実バグ級の JSDoc 不整合を複数検出できた（`formatEnvReport` の未記載オプション、`downloadAssets` の `onProgress` など 26 件）
  - `strict: false` なので null 安全までは担保しない。成否判定は `if (x.error)` ではなく `if ('error' in x)` のように narrow できる形で書く
  - モジュールの公開面を変えたら `.d.ts` も更新する必要がある（[DEVELOPMENT.md](../../DEVELOPMENT.md) の「注意点 / 既知の TODO」にも記載）
  - TypeScript の major 更新で checkJs の推論が厳しくなり、既存の JSDoc が落ちることがある。TS 7 では `@param {object}` と書いた引数のプロパティ参照（TS2339）と型引数なし `new Promise` の引数なし `resolve()`（TS2810）が不許可になった（[#55](https://github.com/shinyaoguri/dropcaster/pull/55)）。対応は型注釈を補う側で行い、TypeScript 化に倒すならこの ADR を改めて見直してから
