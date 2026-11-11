# 1 projector の 3D 描画 PoC (#124 段階 1)

壁・床・箱の会場で、既存 CSS 出力とプレビュー用 GPU 合成を比較する独立実験。
作品・WindowController・既存のマッピング保存には接続していない。

## ローカルで試す

Node.js 24 以上、Chrome / Edge 等の WebGL2 対応ブラウザが必要。
リポジトリのルートで:

```bash
npm ci
npm run dev:poc
```

[http://127.0.0.1:5124](http://127.0.0.1:5124) を開き「3Dを開始」。
ソースは固定 640×360 のテスト canvas で、実出力窓やプロジェクタは不要。

1. 左上の緑の四隅をドラッグする。変更は CSS と右の 3D に反映される。
2. 配置サンプルで crop、マスク前後、凹形、二重巻き、出力をまたぐ配置、反転、退化を試す。
3. 右をドラッグで回転、右ドラッグでパン、ホイールでズームする。投影位置は動かない。
4. 「箱を表示」を切り替え、箱の裏の壁への遮蔽を確認する。
5. 映像を「黒」にし、「投影光を表示」の on/off で会場の明るさが変わらないことを確認する。
6. プレビュー幅を変える。ソース canvas と CSS の解像度は変わらない。
7. 「3Dを停止」→「3Dを開始」。停止中も左の CSS 出力と編集を利用できる。

左下は GPU 合成の**スナップショット**。編集・映像変更時に更新し、ドラッグ中は最大 10Hz に
抑えて GPU 読み戻しの負荷を制限する。右の 3D は rAF で連続描画する。
UI は日本語 / English を切替可能。終了はターミナルで `Ctrl+C`。

## 検証

```bash
npm run build:poc
npx playwright install chromium
npm run test:poc
```

既存 Chromium を使う場合と比較画像 / JSON を保存する場合:

```bash
CHROMIUM_PATH=/usr/bin/chromium POC_ARTIFACT_DIR=/tmp/projection-poc \
  npm run test:poc
```

テストは 14 ケースの CSS/GPU 画像比較、投影 shader の照明前サンプル、黒の寄与、
ドラッグ、カメラ独立性、depth 再利用、3 回の停止再開・GPU リソース解放、context lost / 復帰、
WebGL 無効時の 2D 継続を確認する。CI でも実行する。

## 構造と制約

- `MappingCompositor.ts`: MediaStream を借用する video → VideoTexture → output ごとの
  RenderTarget。正逆ホモグラフィーは共有関数を使う。SVG と同じ nonzero 巻き数で mask を処理する。
- `ProjectionPreview.ts`: 1 台の projector、depth texture、加算する投影光、独立した OrbitControls。
  会場 / projector が変わるまで depth map を再利用する。Three.js は開始時に動的 import する。
- `main.ts`: PoC 専用 source owner と操作 UI。実際の OutputWindow を iframe 内に表示して比較する。
  GPU 側の dispose は借用 stream を停止しない。ページ離脱時に owner が stream を止める。
- Three.js は PoC 用 devDependency。通常の viewer / hosted build にこの入口や Three.js は含まれない。

CSS と GPU の縮小フィルタ・輪郭の antialias は完全一致しない。GPU は alias を抑えるため
video の mipmap と最大 4x anisotropy を使う。許容差・測定値は
[検証記録](../../docs/verification/124-projection-poc.md)を参照。

これは小規模な幾何検証用。任意 GLB、背景付きの既存編集 UI、作品・スライドショーの接続、
project 保存、複数 projector、光学的な明るさ・反射、任意の巨大 mask は対象外。
sample は単位 scale の model transform を使う。一般の model 法線変換・depth bias・会場規模の
検証はモデル読込を実装する際に必要。プレビュー解像度だけを抑え、ソース画質は下げない。
