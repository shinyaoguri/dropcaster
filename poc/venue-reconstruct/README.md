# 会場の逆算推定器の精度計測 (#243)

壁に映した十字で実物の角をなぞり、会場の立体とプロジェクタ条件を逆算する推定器
([src/viewer/venue/venueReconstruct.ts](../../src/viewer/venue/venueReconstruct.ts)) を、
合成会場で測るスクリプト。UI には接続していない。方式全体は #242。

## 実行

リポジトリのルートで (Node.js 24 以上):

```bash
node poc/venue-reconstruct/bench.ts        # 各 100 試行
node poc/venue-reconstruct/bench.ts 20     # 試行回数を減らす
```

合成会場とプロジェクタ、なぞり方の構成は
[tests/fixtures/venue-reconstruct-scene.js](../../tests/fixtures/venue-reconstruct-scene.js) にあり、
単体テスト ([tests/venue-reconstruct.test.js](../../tests/venue-reconstruct.test.js)) と共有する。
なぞった画素は既存の `ProjectorNudge.projectToNdc` (three.js) で作り、各軸 ±2 px の一様ノイズを足す。
乱数は試行番号から決まるので、同じコードなら同じ表になる。結果と解釈は #243 の PR に記録する。
