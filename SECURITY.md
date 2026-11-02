# セキュリティポリシー

## 脆弱性の報告

脆弱性を見つけた場合は、公開 Issue ではなく GitHub の
[Private vulnerability reporting](https://github.com/shinyaoguri/dropcaster/security/advisories/new)
から非公開で報告してください。

対象は `main` ブランチの最新版と、ホスト版 ([dropcaster.soui.dev](https://dropcaster.soui.dev))
です。

## 想定している信頼モデル（脆弱性として扱わないもの）

dropcaster は **自分で内容を確認したスケッチを置いて使うツール** です。スケッチは
同一オリジン・`sandbox` なしの `<iframe>` で実行されるため、スケッチの JS が親ページの DOM・
`localStorage`・出力ウィンドウ・他スケッチのキャプチャストリームに触れられるのは
**意図した設計** です（`captureStream` を tainted にしないため。
[README「信頼モデル」](README.md) と
[ADR 0001](docs/decisions/0001-same-origin-sandboxless-iframe.md) を参照）。

したがって「悪意あるスケッチを読み込むと親ページにアクセスできる」こと自体は脆弱性として
扱いません。第三者のスケッチを隔離して実行する構成は
[#35](https://github.com/shinyaoguri/dropcaster/issues/35) で検討しています。

一方、次のようなものは報告を歓迎します。

- スケッチを読み込んでいない状態で、外部から親ページへスクリプトを注入できる（XSS など）
- ホスト版の `/op-cdn/*` proxy が、OpenProcessing CDN の作品アセット以外を中継できる
  （オープンプロキシ化）
- CLI（`dropcaster fetch` など）が、取り込み先ディレクトリの外へファイルを書き出せる
