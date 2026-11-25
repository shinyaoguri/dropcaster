OpenProcessing の html モードの作品と公開 Gist の作品で、`<script src="sketch.js?v=2">` や `<script src="my%20lib.js">` のように URL として書かれた参照のファイルが読み込まれるようにした。これまでは、クエリ・フラグメント・`%XX` を含む参照が Gist 内のファイルやタブと結び付かず、script や CSS が読み込まれなかった。参照と同じ名前のファイルがあるときは、従来どおりそのファイルを読む。

`dropcaster fetch` は、名前に `#` や `%` を含むタブ（`a#b.js`・`my%20lib.js`）を、その文字を `_` に置き換えた名前（`a_b.js`・`my_20lib.js`）で保存し、コード中の参照を新しい名前に揃える。これまでは名前をそのまま保存していたため、`<script src="a#b.js">` が別のファイルを探して読み込めなかった。すでに fetch 済みの作品は、取り込み直す（`dropcaster fetch <id> --overwrite`）と直る。
