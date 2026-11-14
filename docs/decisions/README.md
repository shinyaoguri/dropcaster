# 設計判断の記録（軽量 ADR）

このリポジトリの確定した設計判断を 1 判断 1 ファイルで記録する。セッションのメモリがリセットされても、判断の背景と意図をここから復元できるようにするのが目的。

- ファイル名: `NNNN-短い説明.md`（連番）
- 構成: **状態**（採用/却下/廃止 + 日付） / **文脈**（なぜ判断が必要だったか） / **決定** / **影響**
- 過去の判断を覆すときは古いファイルを消さず、状態を「廃止（→ NNNN）」に変えて新しい ADR を足す
- 使い方・仕様は [README.md](../../README.md)、開発手順は [DEVELOPMENT.md](../../DEVELOPMENT.md) が正本。ここには「なぜそうなっているか」だけを書く

## 一覧

| # | 判断 | 状態 |
|---|---|---|
| [0001](0001-same-origin-sandboxless-iframe.md) | スケッチは同一オリジン・sandbox なし iframe で実行する | 採用 |
| [0002](0002-canvas-backing-store-decides-quality.md) | 投影出力の画質は canvas バッキングストア解像度だけで決める | 採用 |
| [0003](0003-manual-corner-pin-over-camera-calibration.md) | 投影面の対応付けは手動コーナーピンを維持し、カメラ校正は採らない | 却下 |
| [0004](0004-wrangler-as-pinned-devdependency.md) | wrangler は devDependency に固定し、action を挟まず直接呼ぶ | 採用 |
| [0005](0005-jsdoc-checkjs-over-typescript.md) | Node 側は plain JS + JSDoc + checkJs で型を担保し、TypeScript には移行しない | 採用 |
| [0006](0006-gist-as-second-sketch-source.md) | 公開 Gist を 2 つ目のスケッチソースとして扱う | 採用（ホスト版の認証は0017で更新） |
| [0007](0007-mapping-quad-stays-convex.md) | マッピングの quad は凸四角形に限り、隅の移動を凸の範囲へ制限する | 採用 |
| [0008](0008-output-removal-collapses-canvas.md) | 出力の削除は追加の逆操作として仮想キャンバスを詰め直し、取り残しを残った出力へ寄せる | 採用 |
| [0009](0009-3d-practice-contracts.md) | 3D 練習は既存 2D と座標・状態・保存を共有し、描画 PoC から段階導入する | 採用（保存形式は 0010 で確定） |
| [0010](0010-portable-project-and-practice-ui.md) | 共通 Project v1・GLB パッケージ・既存 UI への練習統合 | 採用（UIは0012で更新） |
| [0011](0011-measured-venue-authoring.md) | メートル単位の部材編集、Project v2、作品を含めない会場配布 | 採用 |
| [0012](0012-unified-mapping-workspace.md) | マッピング入口を統一し、実出力を明示操作、3Dを右側タブに置く | 採用 |
| [0013](0013-simple-venue-and-projector-guides.md) | 基本立体の会場編集、観察専用の投影ガイド、設定・共有メニュー | 採用 |
| [0014](0014-interactive-venue-editing.md) | 会場のGUI編集を1ドラッグ単位で確定し、3D操作と数値入力を共有する | 採用 |
| [0015](0015-standalone-venue-calibration.md) | 会場作成と実プロジェクタでの位置合わせを独立させ、3Dを作品のプレビューに特化する | 採用 |
| [0016](0016-shared-development-workflow.md) | エージェント共通の開発規約、完了条件と検証の対応、反証と視覚的証跡、CI責務の分離 | 採用 |
| [0017](0017-hosted-gist-api-proxy.md) | ホスト版は Gist API を Worker がトークン付きで中継し、利用者の IP の枠に依存しない | 採用（取得順は0018で更新） |
| [0018](0018-gist-direct-first.md) | Gist は直接取得を基本とし、ホスト版の Worker 中継は直接取得が使えないときの予備にする | 採用 |
