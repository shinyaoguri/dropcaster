# 0001: スケッチは同一オリジン・sandbox なし iframe で実行する

- **状態**: 採用（2026-08-05 に記録。判断自体は初期実装から一貫）
- **文脈**: dropcaster の中核は「スケッチの canvas を `captureStream()` で取り出し、`<video>` に bind して CSS `matrix3d` でワープする」こと。`captureStream` は canvas が tainted（クロスオリジンのピクセルで汚染された状態）だと `SecurityError` で失敗する。iframe に `sandbox` 属性を付けると別オリジン扱いになり、親からは中の canvas に触れられない。つまり **隔離を強めると投影機能そのものが成立しない**という構造的なトレードオフがある。OpenProcessing のアセット（画像・フォント・音）も同様の理由で、CORS ヘッダを後付けする `/op-cdn/*` proxy 経由で同一オリジン化している。
- **決定**: スケッチは `sandbox` 属性なし・親と同一オリジンの `<iframe>` で実行する。この構成は**セキュリティ境界ではない**と明示し、代わりに「自分で内容を確認したスケッチを置いて使うツール」という信頼モデルを README 冒頭で宣言する。第三者作品を無検証で大量投入する用途は非対象とする。
  - スケッチの JS は親ページの DOM・`localStorage`・`window.opener`／出力ウィンドウ・他スケッチのキャプチャストリームに自由にアクセスできる
  - ホスト版の `/op-cdn/*` は `deckard.openprocessing.org` への中継で、CORS ヘッダを付けて同一オリジン化する役割を負う
- **影響**:
  - 隔離実行（別オリジン配信 + `sandbox` + 協調的な `postMessage` / `captureStream` 受け渡し）へ移行するには、ワープ経路の作り直しが要る。検討は [#35](https://github.com/shinyaoguri/dropcaster/issues/35) に集約されており、**この前提を変える変更は #35 の検討を経ること**
  - 信頼モデルの宣言は README 冒頭・アーキテクチャ節・[CLAUDE.md](../../CLAUDE.md)「壊してはいけない前提」の 3 箇所にあり、実装を変えるならすべて更新する
