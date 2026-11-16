# changelog.d

利用者から見える変更 1 件につき 1 ファイルを置く。週 1 回のリリースで、**前回のタグ以降に追加された断片**が
束ねられて [GitHub Release](https://github.com/shinyaoguri/dropcaster/releases) の本文になる
([ADR 0022](../docs/decisions/0022-release-by-tags-and-changelog-fragments.md))。

- `feat` / `fix` / `perf` と破壊的変更 (`!`) の PR は断片を 1 つ追加しないと pr-policy が落ちる。
  利用者に見えない変更 (テスト・内部の整理など) ならラベル `changelog: none` を付ける
- `docs` / `chore` などでも、利用者に知らせたいなら断片を置いてよい
- **断片は消さない。** どれが今回ぶんかは履歴が知っている。消すにはリリースがコミットを作ることになり、
  そのために PR と必須チェックを通す仕掛けが要る
- 前回のタグ以降に断片が 1 つも増えていなければ、その週はリリースしない

## 形式

ファイル名は `<slug>.<分類>.md`。

- `<slug>`: 変更を表す短い kebab-case (例: `mapping-activity-bar`)
- `<分類>`: ノートの見出し。正本は [`scripts/release.js`](../scripts/release.js) の `SECTIONS`
  (`breaking` 破壊的変更 / `feature` 新機能 / `fix` 修正 / `perf` 性能 / `docs` ドキュメント)

本文は Release にそのまま載る文として、利用者の言葉で「何ができるようになったか / 何が直ったか」を書く。
最初の文だけで何が変わったか分かるようにする。段落はいくつでもよい。破壊的変更 (`.breaking.md`) は移行手順を必ず含める。
リンクは絶対 URL で書く (相対パスと `[文字][ラベル]` 形式は Release の本文で壊れる)。

```markdown
マッピング画面の左端にアクティビティバーを置き、ツール列をパネルごとに切り替え・折り畳めるようにした。
```

形は `node scripts/release.js lint` (CI の verify) が見る。

## 版の決まり方

最新の `v<major>.<minor>.<patch>` タグ (無ければ 0.1.0) から、今回の範囲のコミット題 (squash なので PR タイトル) と断片の分類で決まる。

| 範囲に含まれるもの | 1.0 未満 | 1.0 以降 |
| --- | --- | --- |
| 破壊的変更 (`!` / `.breaking.md`) | minor | major |
| `feat` / `.feature.md` | minor | minor |
| それ以外 | patch | patch |

1.0 は自動では出さない。メンテナが決めてタグを打つ。
