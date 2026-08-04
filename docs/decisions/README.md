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
