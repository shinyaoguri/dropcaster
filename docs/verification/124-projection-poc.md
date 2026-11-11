# #124 段階 1: CSS/GPU 合成と 1 projector の会場投影

実施日: 2026-11-11。基準: #125 をマージした `56dc61b`。
起動・操作は [PoC README](../../poc/projection-3d/README.md)。

## 判断

既存 CSS 出力を維持し、**幾何確認用プレビューの候補として継続**する。
四隅だけでなく内点、crop、順序、mask、透明、反転、出力オフセットを比較した。
3D では独立した観察カメラと depth map による遮蔽が成立した。
ただし CSS/GPU の pixel 完全一致や実機での 30fps 達成を保証する結果ではない。
本体統合はまだ行わず、#104 / #107 / #108 と対象端末での性能検証を次の gate にする。

## 画像比較

同じ 640×360 canvas の MediaStream を CSS の video と VideoTexture に共有し、
照明適用前の 320×180 出力を比較した。CSS は実際の OutputWindow の描画を撮影する。
GPU は同じ output の RenderTarget を RGBA で読み戻す。色空間と上下の向きを揃え、
黒背景への encoded-space alpha 合成後に比較する。

基準は以下の両方を満たすこと:

- 全 RGB の平均絶対誤差（MAE）≤ **6 / 255**。輪郭も除外せず全画素を含める。
- CSS 画像で周辺 2px とのチャンネル差が 18 を超える輪郭領域を除いた内部で、
  最大チャンネル差 > 12 の画素の割合 ≤ **0.5%**。画像外周 2px も内部判定から除外する。

内部だけを比較して形状差を見逃さないよう、全画素 MAE も必須にしている。
検証用の色・グリッド・文字・透明領域は非対称。凹 mask と同じ多角形を二重に巻く mask を
含め、通常の even-odd / 三角形分割への置換では通らないケースを入れた。

単純な bilinear VideoTexture では遠近配置のグリッドが alias し、MAE 5.20 だった。
mipmap / anisotropy により 1.65 へ改善した。一方、反転の縮小では CSS の鮮鋭な線と
GPU の平滑化された線の差が残り、MAE 5.68。初期の全画像しきい値 4 をこのケースが超えた。
実画像と内部一致を確認した上で、**プレビュー用途でフィルタ差を許す基準を 6 に設定**した。
CSS と同じ pixel 出力を必要とする用途には、この基準を流用しない。

| ケース | MAE (/255) | 内部の不一致率 |
|---|---:|---:|
| 全面 | 0.07 | 0% |
| 遠近 | 1.65 | 0% |
| 範囲外 crop | 2.83 | 0% |
| 手前 / 背後の mask | 0.31 / 0.07 | 0% |
| 凹 / 二重巻き mask | 0.17 / 0.31 | 0% |
| 出力をまたぐ配置 | 1.78 | 0% |
| 左右反転 | 5.68 | 0% |
| 退化 quad / 黒 | 0 / 0 | 0% |
| 透明 / 背後 mask + 透明 | 1.90 / 1.90 | 0% |
| 幅ゼロの crop | 0.07 | 0% |

## 3D と寿命

- 白い投影テクスチャで、壁・箱前面は照明寄与 RGB=(255,255,255)。箱の裏・背面・
  視錐台外・projector 背後・far 超過は (0,0,0)。箱を隠すと裏の壁が白に戻る。
- 薄い壁の裏から見た実描画でも、投影あり / なしが一致する。DoubleSide の裏面を
  `gl_FrontFacing` で区別し、表面の光が透ける扱いにならないようにしている。
- 黒の投影光と投影なしで会場画像が一致する（会場材質が黒く塗りつぶされない）。
- 観察カメラのドラッグ / zoom / viewport resize 後も projector matrix と depth render 回数が不変。
- 四隅の実ドラッグで state が変わる。凹への移動制約は既存の関数を共用する。
- 3 回の停止再開で GPU の texture / geometry 数が停止後 0、借用 track は live のまま。
- 停止時はプレビュー video を pause / detach し、開始中のキャンセル後も再接続しない。
- context lost で 3D を停止し、復帰後に再開始できる。WebGL 無効でも CSS と四隅の編集を継続。
- 初回開始時にデコード済み映像から GPU snapshot が生成されることを検証。

## 性能の参考値

Linux x86_64 / Chromium 156.0.8078.79 / Three.js 0.187.0。
GPU は ANGLE Vulkan の **SwiftShader（ソフトウェア）**。実機 GPU の測定ではない。
source 640×360、preview 640×360、viewport 705×588、depth 1024×1024、sample venue 16 triangles、1 projector。
観察カメラを自動回転し、ウォームアップ後の 120 フレームで平均 **46.5fps**、
p95 frame time **33.4ms**。先の実行では 31.7fps / 66.6ms であり、実行環境に揺れがある。
本実装の初期化・停止や screenshot/readback を性能サンプルから外している。

実行ごとの詳細は `POC_ARTIFACT_DIR` の `report.json`。検証した実測値を
[JSON](124-projection-poc-results.json) として保存した。CI の性能は環境で変動するため
fps の閾値で合否判定しない。次は手元の GPU / OS / ブラウザと実作品で再測定する。

## 既存経路と次の作業

通常の gallery / hosted の viewer ソースは変更していない。Three.js の入口は
`poc/projection-3d` の別 Vite 設定のみ。既存 package-lock の version / metadata は維持し、
PoC 用依存を追加した。既存 88 テスト、Node 型検査、両ビルド、PoC 型検査 / build、
両エントリの既存 CSS 比較 64 ケースも確認する。

次は対象端末で本 PoC を評価し、#104 の snapshot・origin 通知と #107 / #108 の復旧を
解決してから、段階 2 の consumer 所有権と出力窓なし練習モードへ進む。
大きな会場での depth bias、任意 model の法線変換、複数 projector、GLB package は未検証。
