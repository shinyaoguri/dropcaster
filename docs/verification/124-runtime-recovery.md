# #124 本体統合前の状態・映像復旧確認

## 範囲

独立 PoC の PR #126 はユーザーによる動作確認後、`828b32e` として main にマージした。
この変更は #124 の段階2に先立ち、既存の WindowController にある #104 / #107 / #108 を修正する。
3D の本体接続、出力窓なしの consumer 管理、Project 保存はまだ含まない。

## 変更と設計

- **#104:** 正規 state の更新時に `events.state` も必ず更新する。操作起点の
  `InlineControlHost` だけが同期通知中の echo を抑える。他の host / subscriber は更新を受け取り、
  callback 内の snapshot も最新になる。既存の trailing debounce 600 ms と pagehide / destroy
  の保存、v2 データ形式を維持する。
- **#107:** iframe の load と document 内の canvas 生成・置換を監視する。reload 後に
  canvas がまだ無ければ生成を待ち、capture・resize / context 監視・各 video の bind を再設定する。
  source の世代を変更して旧 callback を無効にし、停止・破棄・作品切替・テスト表示で
  listener / observer / timer / track を解放する。通常の context restored でも再 capture する。
  WebGL 警告は新しい stream の映像データがデコードされてから解除する。
- **#108:** テスト表示中の `setSource` は off で戻る先だけを更新する。テスト種類の変更では
  同じ stream を維持し、off で最新作品を capture する。生成失敗時は元の stream と選択表示を保つ。
  テスト映像の寸法も通知し、停止で off を通知する。パネル再表示時は現在の選択を読む。
- ロスト済み canvas は弱参照の集合で記録する。テスト表示から通常映像へ戻すとき、
  未復旧なら復旧待ちを再開する。監視を外している間に自然復帰した場合はリロードしない。

元 canvas の解像度・描画頻度、同一オリジン / sandbox なし iframe、CSS 投影計算、出力の
並び方は変更しない。source の選択は既存どおり iframe 内の最初の canvas を対象とする。

## 再現できる検証

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:projection-runtime
```

`tests/browser/projection-runtime.mjs` は実際のギャラリー / ホスト版エントリを読み込み、
実装クラス・UI・popup・canvas.captureStream を使って両経路で以下を検証する。
外部の作品サービスへ依存せず、same-origin の決定的な作品 fixture を使う。

| 対象 | 確認内容 |
| --- | --- |
| 編集の継続 | 実際の mapping / output 追加・削除、JSON ファイル import、全出力窓を閉じた後の再マウント、次の編集後に保存済みの項目と座標が維持されること |
| state 通知 | 起点へ echo しない、別 host と一般 subscriber へ届く、通知時の snapshot が最新 |
| 校正 | スライド切替と同じ setSource 経路で3回ソース変更してもテスト track は live のまま、種類変更と再マウント、off で最新作品の青画素と寸法を確認 |
| 校正の失敗・停止 | captureStream の生成失敗時に元映像・UI を維持、停止で off、再開で最新作品を配信 |
| WebGL reload | WEBGL_lose_context、srcdoc / src の両経路、load より350 ms遅い canvas 生成、旧 track の停止、新 track の緑画素、全出力 video への bind、警告解除 |
| 再監視 | 新 canvas の resize、再ロストと native restore、同じ iframe の終了済み track、ナビゲーションを伴わない canvas 置換 |
| 復旧の中断 | テスト表示と off による復旧再開、校正中に自然復帰した場合の不要な reload 抑止、別作品へ切替、reload 後の canvas 生成前に停止、reload 期限前の destroy |

停止・切替の検証は予約済み処理の期限を越えて待ち、映像や iframe が勝手に再開されないことを確認する。
意図したテストパターン生成失敗と、連続した再 bind に伴う play() の AbortError は console に出るが、
未捕捉のブラウザ例外は成功扱いにしない。

修正前の `828b32e` の別 worktree に対し同じ harness を適用し、各不具合の検出も確認した。
`RUNTIME_TEST_ROOT` で worktree を指定し、`RUNTIME_CASE=state|pattern|recovery` で個別に実行できる。

- state: 追加後の snapshot は期待2件に対して1件。
- pattern: grid 選択のままテスト track が終了し、作品側の640×360へ切り替わる。
- recovery: iframe は再読込されるが新 stream と警告解除を待って timeout。

## 検証環境と次の境界

Linux、Node 24.22.1、Chromium 156.0.8078.79、SwiftShader。実機プロジェクタやドライバ障害の
網羅的な確認ではなく、ブラウザで再現できる状態・track・画素・停止条件の回帰検証。
通常の単体テスト、両 viewer / PoC ビルド、既存 CSS の64ケース画像比較、Worker dry-run も実行する。
CI に `test:projection-runtime` を追加し、既存の PoC 比較も継続する。

次は ADR 0009 に沿って、WindowController の stream snapshot / subscription と消費者登録を設け、
実出力と3Dの最後の消費者が終了したときだけ capture を停止する。今回の回帰テストを維持したまま、
作品ページとスライドショー双方へ出力窓なしの練習モードを接続する。#124 は継続中。
