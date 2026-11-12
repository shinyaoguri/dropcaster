---
name: visual-evidence
description: dropcaster の見た目・動き・ウィンドウ操作の変更を、画像や動画の before/after と環境・未確認範囲で検証する。表示・操作の Issue、描画や動作を変える PR、比較証跡の依頼に使う。
---

# 見た目と動きの証跡

1. 同じ入力・作品・会場・出力設定で、変更前と変更後を比較する。
   対象コミット、OS、ブラウザ、gallery / hosted、viewport・出力解像度と操作を記録する。
   動き・ちらつき・切替・ドラッグは動画かアニメーションで示す。静止画だけで動きを検証済みにしない。
2. 実際のアプリ UI と出力を確認する。数式や比較ページによる検証は補助として範囲を明記する。
   popup を iframe で代用した場合や仮想画面では、実 popup・外部ディスプレイの検証済みと扱わない。
3. 対象に合ったブラウザテストと起動方法を [DEVELOPMENT.md](../../../DEVELOPMENT.md) で確認する。
   Chromium / Playwright が使えれば実際に試す。環境が足りないときは具体的な失敗と未確認項目を記録する。
   外部作品に依存しない、決定的な最小 fixture を優先する。
4. 証跡は `/tmp` など git 管理外に保存する。既存テストには次の保存先指定がある。

   ```bash
   MAPPING_ARTIFACT_DIR=/tmp/mapping-images node tests/browser/mapping-css-regression.mjs
   PRACTICE_ARTIFACT_DIR=/tmp/practice-images npm run test:practice
   VENUE_ARTIFACT_DIR=/tmp/venue-images npm run test:venue
   ```

5. Issue / PR の証跡欄へ画像・動画を添付し URL で参照する。ブラウザの添付や利用可能な
   アップロード機能を使う。トークン・私的な画面・作品の秘密を写さない。バイナリを証跡のためにコミットしない。
   公開 URL にできなければローカルの保存先・対象版・再現手順と「未添付」を残す。
6. 起票時は現在の症状、PR では before/after を置き、実測と想定を区別する。
   撮れない場合は「証跡なし: <具体的な理由>」と検証できていない事項を明示する。
   証跡を完了条件にした PR は、証跡が揃うまで Draft にする。

記録例:

| 条件 | 変更前 | 変更後 | 証跡・未確認範囲 |
| --- | --- | --- | --- |
| 左端の出力を削除 | 空きが残る | 残る出力を詰めて相対位置を保つ | 動画 URL。Chromium / hosted。外部ディスプレイ未確認 |

見た目が変わらない変更は、その理由を PR の証跡欄に書く。免除ラベルや自動アップロードは追加しない。
