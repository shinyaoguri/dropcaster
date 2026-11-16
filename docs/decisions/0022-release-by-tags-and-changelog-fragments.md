# 0022: 版はタグ、変更履歴は PR ごとの断片で持ち、週 1 回ファイルを変えずにリリースする

## 状態

採用（2026-11-16）。#226。

## 文脈

`package.json` の版は 0.1.0 のまま一度も動かず、タグ・GitHub Release・CHANGELOG も無かった。
マッピング画面下端の版表示（#154）・CLI の `--version`・ホスト版 Service Worker のキャッシュ世代はどれも
`package.json` の版を名乗るので、どの変更を含む版かを区別できなかった。

main はブランチ保護で `verify` / `pr-policy` を必須チェックにし、署名付きコミットを求めている。
Actions の既定のトークン（GITHUB_TOKEN）が作った PR・push は、再帰を防ぐ仕様で他のワークフローを起こさない。

## 決定

- **リリースはリポジトリのファイルを 1 つも変えない。** 版は `v<major>.<minor>.<patch>` のタグ、ノートは
  GitHub Release の本文に置く。`.github/workflows/release.yml` が週 1 回（と手動で）GITHUB_TOKEN だけで動く。
- 変更履歴の材料は PR ごとに置く `changelog.d/<slug>.<分類>.md` の断片。リリースは前回のタグ以降に
  **追加された**断片を束ねる。断片は消さない（今回ぶんは履歴が知っている）。断片が増えていなければ出さない。
- `feat` / `fix` / `perf` と破壊的変更の PR は断片が無いと `pr-policy` が落ちる。利用者に見えない変更は
  ラベル `changelog: none` で免除する。判定は既定ブランチの `scripts/release.js` で行い、PR のコードは実行しない。
- 次の版は最新タグ（無ければ 0.1.0）からコミット題と断片の分類で決める。1.0 未満では feat と破壊的変更を
  minor、それ以外を patch にする。1.0 はメンテナが決めて手で出す。
- 版は `verify` が success の SHA にだけ打つ。
- 表示する版はビルド時に `git describe` でタグから求める（`src/core/build-info.js`）。タグより先なら
  `0.2.0+3` のようにコミット数を添える。`package.json` の版は「リリースされた版ではない」印の `0.0.0-dev` に固定する。
  GITHUB_TOKEN のタグでは deploy が起きないので、release.yml がリリース後に deploy.yml を workflow_dispatch で起こす。

### 退けた案

- **release-please / changesets（リリース PR 方式）**: CHANGELOG.md と `package.json` を更新する PR を作り、
  それを merge して版を出す。GITHUB_TOKEN で作った PR では `verify` / `pr-policy` が起動せず必須チェックを
  満たせない。GitHub App か PAT の secret を足せば動くが、鍵の管理・失効という壊れる場所がリリースのたびに増える。
  ノートを CHANGELOG.md と Release に二重に持つことにもなる。
- **リリースがタグ用のコミット（版を書き換えた package.json）を main の外に作る**: タグが main から辿れなくなり、
  `git describe` で版を求められない。
- **`package.json` の版を正本のまま手で上げる**: 現状がまさにそれで、上がらなかった。

## 影響

- GitHub から `npm install` したギャラリーにはタグの情報が無いので、版番号の代わりにコミットだけを表示する
  （コミットのリンク先で、どのタグに含まれるかは GitHub が示す）。
- リリースノートの粒度は断片を書く人に依る。断片の形は `node scripts/release.js lint`（CI の verify）が見る。
- 断片が溜まって `changelog.d/` の見通しが悪くなったら、1.0 のタグの後などに `changelog.d/archive/` へ
  中身を変えずに移す（rename は「追加」に数えない）。それまでは整理の仕組みを足さない。
- 週次の cron の起動時刻は GitHub の混雑で遅れる。待てないときは release.yml を手で起動する。
