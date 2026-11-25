`dropcaster dev`（開発サーバー）が Service Worker を登録しなくなり、作品を更新したあと 1 回の再読み込みでいまの内容が出るようになった。これまでは Service Worker がローカル作品をキャッシュから先に返すため、同じ作品の 2 回目以降の更新では、1 回目の再読み込みに前の内容が出ていた。

同じアドレス（例: `http://localhost:5173`）に以前の版の `dropcaster dev` が登録した Service Worker が残っているブラウザでは、開いたときに登録を外して 1 度だけ自動で読み込み直す。`dropcaster dev` は `public/sw.js` を生成しなくなった（以前の版が残したファイルは消してよい。`dropcaster build` が出力先に生成する）。

オフライン起動や更新の通知など PWA の挙動は、`dropcaster build` のあと `dropcaster preview` で確かめる。
