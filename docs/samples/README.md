# 会場サンプル

- `room-8x6.venue.json`: 内寸8m×6m、高さ3mの部屋とステージ。壁・床・箱を受信側でも編集できる。
  「プロジェクト」→「プロジェクト・会場・旧JSONを読む」で読み込む。現在の作品はそのまま使える。
  作成方法は[実寸の会場作成・配布手順](../venue-authoring.md)を参照。

- [textured-wall.dropcaster.json](textured-wall.dropcaster.json): 6 m × 4 m の壁、GLB 内画像、投影条件、2D 配置、内蔵映像の参照を含む portable package。
- [textured-wall.glb](textured-wall.glb): 同じ壁のモデルだけ。モデル1単位 = 1 m、壁は Z=-3、法線は +Z。
- 壁・床・箱の会場はアプリに内蔵。3D設定 → 会場 →「壁・床・箱のサンプル」で戻せる。

1. [3D練習](https://dropcaster.soui.dev/practice)を開く。実出力窓は不要。
2. 上部「プロジェクト」→「プロジェクト・会場・旧JSONを読む」で JSON を選ぶ。
3. 「保存した作品を開く」で内蔵映像を開く。会場の寸法が **6.00 × 4.00 × 0.00 m** であることを確認。
4. 2D の四隅・ソース切り出し・マスクを調整し、3D を回転して確認する。
5. 「パッケージを書き出す」で保存し、別ブラウザでも同じ操作で読み込む。

GLB/画像はリポジトリ内の `tests/fixtures/venue-glb.mjs` で生成したもの（本リポジトリと同じ MIT ライセンス）。
0 m の奥行きは面モデルの仕様。任意 GLB は形状・向き・単位を確認してから使う。
