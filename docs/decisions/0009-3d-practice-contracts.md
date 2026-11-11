# 0009: 3D 練習は既存の 2D 出力と座標・状態・保存の契約を共有する

## 状態

採用（2026-11-11）: 座標規約、描画の分離、状態と stream の所有権、段階的な導入方針。
Project の JSON 形状は当初の **#117 と共用する最小案**。実装時の形式確定は [0010](0010-portable-project-and-practice-ui.md) を参照。
この ADR の追加で [#124](https://github.com/shinyaoguri/dropcaster/issues/124) の段階 0〜4 が完了するわけではない。

## 文脈

会場を背景に既存の quad / crop / mask を編集し、別の観察視点から立体への映り方を
確認したい。現在の出力は複数の video と CSS `matrix3d`、SVG mask の合成であり、
`dc-output-canvas` は div。元 canvas の VideoTexture だけでは編集結果を再現できない。

基準は `4b2fc82c17d53a15c5176002a102776062b58a9e`。
[#104](https://github.com/shinyaoguri/dropcaster/issues/104) の snapshot 巻き戻りと
[#117](https://github.com/shinyaoguri/dropcaster/issues/117) の上位プロジェクト保存は未実装。
3D のために別の正規 state・保存機構を作ると、既存出力と編集結果が食い違う。

## 決定

### 2D と 3D の座標

| 空間 | 原点・向き・単位 | 変換と責務 |
|---|---|---|
| 元映像 | 左上、x 右 / y 下、UV 0..1 | source は映像全体に対する % crop |
| quad 内 | 左上、x 右 / y 下、UV 0..1 | TL / TR / BR / BL = (0,0) / (1,0) / (1,1) / (0,1) |
| 仮想キャンバス | 左上、x 右 / y 下、px | quad と mask、output.position / size の空間 |
| 出力内 | 左上、x 右 / y 下、UV 0..1 | canvas = output.position + UV × output.size |
| 会場 | 右手系、Y-up、メートル | model transform と projector の物理姿勢。2D の出力詰め直しと独立 |
| projector | ローカル -Z が前、+Y が上 | quaternion は [x,y,z,w]。観察カメラは別オブジェクト |

`mappingTransform.ts` の `quadHomography` は quad 内 UV → 仮想キャンバス px の
**行優先 3×3 行列**を返す。CSS は入力を canvas.width / height で割り、従来どおり
column-major の `matrix3d` にする。GPU は output UV → `outputUvToCanvas` →
逆ホモグラフィー（同次除算込み）→ `cropUvToSourceUv` の順にサンプリングする。
GPU の行列 uniform へ渡すときは転置配置が必要。2 三角形の通常 UV 補間で代用しない。

逆行列の右下係数は 0 にもなり得るため、1 に正規化する前提を置かない。
`null` の行列・無限遠の点は描画しない。quad 内 UV / source UV が範囲外なら
映像は存在しない。端の画素へ clamp して塗り延ばさない。crop の幅・高さだけは
既存 CSS と同じ `max(value, 0.0001)` を適用する。数学関数自体は内外の clip をしない。
WebGL の texture / framebuffer 原点との差は compositor の境界で一度だけ変換する。

projector の光学条件の正本は縦画角 `verticalFovDegrees`（0 < fov < 180）と
`aspect`（幅 / 高さ）。観察パネルの resize では変えない。投写比は導出値とする。
`lensShift` は投影面の幅・高さを 1 とした frustum 中心の移動（x 右、y 上が正）。
near 面の半高さを `h = near * tan(verticalFovDegrees * π / 360)`、半幅を `w = h * aspect` とすると、
左右は `-w + 2w*shiftX` / `w + 2w*shiftX`、上下は `h + 2h*shiftY` /
`-h + 2h*shiftY`。`0 < near < far`、位置はメートル、quaternion は単位長に検証する。
背景は同じ projector の投影行列で生成し、その output の矩形に対応付ける。

### CSS 出力を維持した描画 PoC

初期は 1 台の projector / 対象 outputId を明示する。実出力の最大 4 台と跨ぎ mapping は維持する。
Three.js はプレビュー開始時に遅延読込し、GPU 合成はプレビュー用 RenderTarget に限定する。
リストの先頭ほど前面、enabled=false は非表示、mask は同じリストの順で黒く合成、
drafting / 3 点未満の mask は非表示、退化 / 非凸 quad は非表示、という既存出力に合わせる。

画像比較は照明適用前の投影テクスチャで行う。色空間、alpha、動画の上下、境界の
antialias も比較対象。黒と mask は会場への寄与をゼロにし、会場材質自体を黒で置き換えない。
背面、視錐台外、depth map で遮蔽された面は投影しない。観察操作で projector は動かさない。
編集背景・ハンドル・ガイドは投影テクスチャにも実出力にも含めない。
プレビュー解像度だけを制限できるようにし、ソース解像度は変えない（[ADR 0002](0002-canvas-backing-store-decides-quality.md)）。

### 状態・snapshot・通知・stream の所有権

- 正規 mapping state は引き続き WindowController が保持する。snapshot は通知抑制とは
  無関係に commit ごとに更新し、通知 callback 内で読んでも最新であること。
- #104 の修正を本体統合前の前提とする。編集元への echo だけを抑止し、3D など別の
  購読者への通知は抑止しない。将来の通知では origin を分離し、InlineControlHost 側で
  自分の origin を除外する。Emitter 全体を無通知にするだけでは不十分。
- stream は WindowController が所有する。利用側には現在値（MediaStream または null）と
  差し替え / 停止通知を提供する。購読解除と consumer の解放はそれぞれ冪等にする。
- 配信を必要とする実出力と 3D consumer を別に登録し、最後の consumer が終了した時に
  owner が配信を止める。プレビュー側は借用した track を stop しない。既存の明示的な
  全停止 / ルート離脱は、consumer・再キャプチャ・復旧予約をまとめて解放する。
- 作品 / テスト切替、canvas 再生成、context lost 復旧でも同じ配信通知経路を使う。
  終了後に遅延した復旧が stream を再開しないよう、世代または取消状態を確認する。
  #107 / #108 の復旧経路と整合させる。
- プレビュー終了時は購読・controls・video.srcObject・texture・RenderTarget・depth map・
  rAF を解放する。3D 初期化失敗で 2D の状態や出力を破棄しない。

この変更では WindowController / Emitter の挙動は変えない。独立した描画 PoC は自前の
テストソースで先行できるが、現在の `events.state` を本体の 3D 表示へ接続してはいけない。

### #117 と共用する保存の最小案

| 区分 | 最小フィールド案 |
|---|---|
| Project | schemaVersion、id、name、createdAt / updatedAt、venue、content、show |
| Venue | id、revision、layout（MappingsState v2 を内包）、任意の scene、projectors |
| Scene | 会場 assetId、metersPerUnit、model transform、基本材質。右手系 Y-up に正規化 |
| Projector | id、outputId、position、quaternion、verticalFovDegrees、aspect、lensShift、near / far |
| Content | id、local / OP / Gist の参照、タイトル等、版識別子（未取得は未固定と区別） |
| Show | 現在の contentId または単純な参照順。後続 cue 機能と共用 |
| Assets | package 内の相対パス・識別子で GLB と必要な画像等を対応付ける |

Project と MappingsState の version は独立させる。3D フィールドを v2 の直下に追加して
既存 parser に渡さない（未知フィールドが失われる）。#117 側の形式を確定する際に
この案を統合し、実装した schema / fixture を正本にする。今は第 2 の parser や保存キーを作らない。

旧 v2 は既存 parser と独立した移行処理で読む。Project import は全体の構文・version・
有限値・一意 ID・参照・asset の存在を検証してから一括適用し、失敗時は現在設定を保持する。
projector.outputId は存在する output を参照する。output 削除では対応 projector も削除し、
残る projector の物理姿勢を 2D の座標詰め直しに連動させない。

export には端末固有 screen、Window、MediaStream、blob URL、選択 UI、復旧中状態を含めない。
必要な GLB 内画像等は同梱し、import 時にローカル URL を再生成する。作品本体の版固定と
オフライン準備は #120 の責務。参照しか保存していない作品を固定済みと表示しない。
読み込むだけで出力窓を開かず、ユーザー操作で投影を開始する。

## 影響

- 今回の実装は純粋な座標関数と CSS の委譲、回帰テストまで。新しい UI・依存・保存形式は導入しない。
- [着手範囲・検証記録](../verification/124-projection-foundation.md) を残し、描画 PoC は次の変更で行う。
- PoC では CSS/GPU の画像許容差と実機の性能を測定して方式を判断する。今回の CSS 同士の
  完全一致は GPU の色や性能の保証ではない。3D は自動校正ではなく、[ADR 0003](0003-manual-corner-pin-over-camera-calibration.md) の却下範囲外。
- 背景付き編集、練習モード、パッケージ保存へ進むには、状態修正と保存形式の実装が別途必要。
