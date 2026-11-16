dropcaster の版を毎週自動でリリースするようにし、変更点を [GitHub Release](https://github.com/shinyaoguri/dropcaster/releases) にまとめるようにした。

マッピング画面の下端と `dropcaster --version` に出る版は git のタグから求める (タグより先のコミットでは `v0.2.0+3` のように何コミット先かを添える)。GitHub から入れたギャラリーなどタグが分からない入れ方では、版番号の代わりにコミットだけを出す。
