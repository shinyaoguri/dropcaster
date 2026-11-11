# #130: 実寸の会場作成・配布と開始ボタンの統一

対象: #131。2026-11-11、Linux x64 / Node 24.22.1 / Chromium 156.0.8078.79 / SwiftShader。

## 実行

```bash
npm run check
npm test
npm run build
npm run build:web
npm run build:poc
CHROMIUM_PATH=/usr/bin/chromium PRACTICE_ARTIFACT_DIR=/tmp/venue-images npm run test:practice
```

`PRACTICE_CASE=venue` で作成・配布に絞れる。CIではさらに既存のPoC画像比較、runtime復旧、
CSS出力64比較とWorker dry-runを実行する。

## 結果

- unit 96件: 既存93件にv1移行、実寸の部屋と異常部材、会場共有と受信側保持を追加。
- practice 20ケース: gallery/hostedそれぞれの既存9ケースと新規venueケース。
  作品・スライドショー、popup併用、旧GLB/Project/v2読込、終了・復旧の既存経路も通過。
- 幅8m・高さ3m・奥行6mの部屋をUIから作成。生成geometryの外形8.3×3.1×6.15mを確認し、
  内寸は壁厚・床厚で狭くならないことを純粋関数で検証。
- 部材の名前・寸法・位置・回転・色、追加・複製・削除・undoを操作。固定背景へ反映し、
  マッピングとprojector行列を維持。部材6個の会場を停止・再読込後に復元。
- 会場ファイルを別ブラウザcontextへ渡し、形状を復元。受信側の作品参照・show・project idと
  同じ生存中video trackを保持。実出力窓は開かない。ゼロ寸法の不正importでは現在の会場を保持。
- スライドショーへの会場読込後も、作品送りが保存currentIndexへ反映し、間隔45秒を維持する。
- 日本語/英語、1440px/900pxを確認。既存ツール欄で部材を編集し、3Dをソース欄で確認する。
  個別作品とスライドショーの入口は、各既存マッピングボタンのCSSを共用する。

自動ブラウザは描画内容・寿命・保存の確認であり、実プロジェクタや任意会場の測量精度を保証するものではない。
128部材の上限は過大な入力を拒否する制限であり、その規模での操作fpsを保証する数値ではない。
複雑な形状には既存GLBを利用する。実寸部材はv2保存形式のため、共有先も更新済みアプリが必要。
