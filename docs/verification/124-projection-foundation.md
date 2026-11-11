# #124 着手: 射影変換の共通化と既存出力の回帰確認

実施日: 2026-11-11。基準: `4b2fc82c17d53a15c5176002a102776062b58a9e`。

## 今回の範囲

- [ADR 0009](../decisions/0009-3d-practice-contracts.md) に座標・状態・stream 所有権と
  #117 へ統合する保存契約案を記録。
- `mappingTransform.ts` に DOM 非依存の正逆ホモグラフィー・点変換・output UV / crop
  変換を公開。CSS は同じ係数計算へ委譲し、従来の計算順・退化時非表示を維持。
- 変更前の CSS を固定した fixture と、数学的な対応点・逆変換・跨ぎ出力のテストを追加。

**#124 の初回作業単位であり、3D 練習機能の完成ではない。** Three.js、GPU compositor、
会場モデル、背景 UI、保存 parser は未追加。段階 1 の GPU 画像比較・性能判定も未実施。

## 検証方法

`tests/fixtures/mapping-css-baseline.json` は基準コミットの `applyQuadCanvas` /
`applyVideoCrop` の結果を、実装変更前に保存したもの。期待値を変更後の関数から再生成しない。
矩形、遠近、左右 / 上下反転、回転、範囲外 crop、跨ぎ出力、大きな offset、古い強い遠近、
負座標、ゼロ / 負の crop、非凸・自己交差・退化の 15 ケースを含む。

純粋関数テストでは四隅と内点、解析的に既知の 200 個の射影変換、逆行列の右下係数が
0 の場合、非有限値・特異行列、2 出力の継ぎ目を確認する。CSS 文字列は固定値と完全一致を要求する。

ブラウザテストは両 Vite 設定の実エントリを起動し、実際の OutputWindow に非対称の
色・グリッド・透過領域のある canvas の captureStream を渡す。現在の CSS と固定 fixture の
CSS を同じ出力 DOM 上に適用し、スクリーンショット PNG を byte 単位で比較する。
単一 mapping と mask / 重ね順 / 無効 mapping / drafting mask を含む場合を比較し、
跨ぎ mapping は隣の output 矩形からも確認する。許容差はゼロ。

```bash
npm test
npm run check
npm run build
npm run build:web

# Playwright 既定の Chromium を使う場合:
node tests/browser/mapping-css-regression.mjs

# インストール済み Chromium を使い、代表画像 / 失敗画像を保存する場合:
CHROMIUM_PATH=/usr/bin/chromium MAPPING_ARTIFACT_DIR=/tmp/dropcaster-124-images \
  node tests/browser/mapping-css-regression.mjs
```

## 結果

- 環境: Linux x86_64、Node 24.22.1、Chromium 156.0.8078.79（headless）、Playwright。
- 変更前: 既存テスト 64 件、Node 型チェック、両ビルド成功。
- 変更後: 88 件のテスト、Node 型チェック、両ビルド成功。固定 fixture は基準コミットの
  ソースを直接読み直して再照合済み。
- Worker の `wrangler deploy --dry-run` も成功（本番デプロイなし）。この Cloud 環境は
  既定の設定ディレクトリに書けないため、`apps/web` で以下を実行した。

  ```bash
  XDG_CONFIG_HOME=/tmp/dropcaster-124-config WRANGLER_LOG_PATH=/tmp/dropcaster-124-wrangler.log \
    WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir=/tmp/dropcaster-124-worker
  ```

- ブラウザ: gallery / hosted 各 32 件、合計 64 件の PNG が完全一致。pageerror なし。
- これは同一ブラウザ内の CSS 回帰確認。GPU と CSS の一致、実機 GPU 性能、他ブラウザ、
  外部ディスプレイ、実 OP / Gist の取得、全 UI 操作の網羅確認ではない。

## 再開地点

1. 独立ハーネスで壁・床・箱、1 台の projector、GPU compositor と遮蔽を実装する。
   この fixture と座標関数を比較元にする。背景・観察カメラは projector から独立させる。
2. 照明前の投影テクスチャを CSS と比較し、色・alpha・mask・pixel 境界を含む許容差、
   ソース / プレビュー解像度、端末 / GPU、操作中 fps を記録する。方式の採否判断までを 1 単位にする。
3. 本体統合前に #104 の snapshot と通知抑制を修正し、#107 / #108 の復旧と整合させる。
   現状の `events.state` をそのまま 3D の購読元にしない。
4. #117 と保存形式を実装・確定し、段階 2〜4（出力窓なし・背景 UI・会場共有）へ進む。
   Epic と依存 Issue は、この基盤追加だけでは閉じない。
