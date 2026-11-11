# #124: 既存 UI に統合した3D練習・会場共有の検証

対象: #128。前提修正は #125 / #126 / #127。初期リリースは段階 0〜4、選択した1台の
仮想プロジェクタを表示する。複数台の同時寄与は [#129](https://github.com/shinyaoguri/dropcaster/issues/129)。

## 再現

```bash
npm run check
npm test
npm run build
npm run build:web
npm run build:poc
CHROMIUM_PATH=/usr/bin/chromium npm run test:poc
CHROMIUM_PATH=/usr/bin/chromium npm run test:projection-runtime
CHROMIUM_PATH=/usr/bin/chromium PRACTICE_ARTIFACT_DIR=/tmp/practice-images npm run test:practice
CHROMIUM_PATH=/usr/bin/chromium node tests/browser/mapping-css-regression.mjs
# apps/web で npx wrangler deploy --dry-run
```

Playwright の Chromium を使う場合は CHROMIUM_PATH 不要。静的 fixture を使用し、OP/Gist/CDN
の公開状態には依存しない。個別作品・スライドショー・内蔵サンプルを実際の Router / UI から
開く。計測・状態観測用の prototype hook はテスト内だけに置く。

## 対象と結果

2026-11-11、Linux x64、Node 24.22.1、Chromium 156.0.8078.79、SwiftShader。

| 検証 | 対象 |
|---|---|
| unit 93 件 | 既存 88 件 + Project往復、旧 v2、有限値・参照、GLB異常、8 MiB base64、output削除 |
| CSS/GPU 14 比較 | PoC と本体が共用する compositor。crop、quad、順序、mask、黒、alpha、退化、跨ぎ |
| runtime 両入口 | 状態の巻戻り防止、テストパターン、src/srcdoc WebGL復旧・中止 |
| practice/lifecycle | popupゼロ、quad nudge/crop/mask編集→GPU反映、固定背景、視点独立、日英、900/1440px、併用・3回再開 |
| practice/projects | 画像埋込GLB、基本色、寸法・非均一scale、名前付き保存・複製、別context復元、旧v2、undo、schema/asset/ref/scene異常、容量不足 |
| practice/slideshow | 既存headerで送り・停止、校正を保つsrcdoc/URL切替、間隔とindexを保存して再開 |
| practice/recovery | 作品のcontext loss・canvas再生成、3D自身のcontext loss→2D継続・再試行、内部ルート離脱 |
| practice/outputs | 練習中の追加はpopupを開かない、4実出力、output削除と2D詰め直しでも物理姿勢は不変 |
| practice/unavailable | WebGL初期化失敗の説明、2D編集とsourceの維持、再試行 |
| practice/cancellation | dynamic import途中の終了、明示全停止、遅れてconsumerが復活しない、再開 |
| practice/loading | iframe読込途中の開始・終了、5秒を超える遅延canvasへの追従 |
| practice/sample | 外部サービス不要の `/practice` と builtin参照の保存・再開 |

practice の各ケースはユーザーギャラリーとホスト版の両方で実行する。
取り込み失敗テストは例外を意図的に発生させる。WebGL無効テストの renderer console.error は期待される。
未捕捉 pageerror は許容しない。実出力に会場背景・3D canvas が混ざらないこと、借用trackが
他の消費者終了で停止しないことを、実際の popup と decoded video で確認する。

CSS/GPU の許容差・境界 AA の違いは [PoC 記録](124-projection-poc.md)と同じ。
CSSの64比較は両側で連続した同一描画を確認してから比較する。動画decode直後はChromeの
補間/rasterizationが切り替わることがあり、即時screenshot同士では偽陽性が出た。
許容差を増やす変更はせず、安定後のPNG完全一致を維持する。
実出力の描画経路は CSS のまま。GPU を実出力の置き換えには使わない。

## 操作と性能

[測定データ](124-practice-performance.json)は、内蔵1920×1080映像、壁・床・箱16三角形、
1 mapping、1 projector、1440×900 viewport で、既存四隅ハンドルを120回移動したときの rAF 間隔。
640 / 320 px のプレビューを比較する。ソース解像度は両方とも1920×1080のまま。
会場・投影姿勢が変わらない編集では depth map を再利用する。

実測は640×360で **22.3 fps / p95 133.4 ms**、320×180で **31.8 fps / p95 66.7 ms**。
この環境では既定640pxで30fps目標を満たさず、320pxで平均30fpsを超えた。操作の最悪遅延を
保証する値ではない。静的サンプルの不要な毎フレーム再描画と、quad編集ごとの shader 再生成を
避ける実装にした。動く1080p作品や大きなGLBでは別途負荷を確認する。

再測定: `CHROMIUM_PATH=/usr/bin/chromium node tests/browser/practice-performance.mjs`。
`PRACTICE_PERFORMANCE_FILE=/tmp/performance.json` で結果を保存できる。
ソフトウェア GPU の測定であり、実機の30fps達成や任意 GLB の性能は保証しない。
保存した会場の規模と素材によって負荷は変わる。必要ならプレビュー解像度を下げる。

## 制限と追跡

- 実プロジェクタ・外部ディスプレイでの画角/色/光量確認は本環境では未実施。
- Chromium を自動確認。Safari/Firefox は未測定。3D失敗時には既存2Dを残す。
- GLBは静的・非圧縮で画像/buffer埋込。基本色とbase-color mapを扱い、PBR・透過の物理再現は対象外。
- 20 MiB / 30万三角形（package 30 MiB）、4 output、256 mapping、100作品参照を取込上限とする。
- 作品参照のOP/Gist再取得は既存サービスに依存し、版固定やオフラインの保証はしない（#120）。
- #117 の共通保存基盤・名前付き保存を先行実装。プロジェクト全体の管理画面やcue/版固定は別タスク。
- #129（複数仮想プロジェクタ）、#118（2Dの追加ズーム/パン）、#123（複数ソース/出力補正）とは分離する。
