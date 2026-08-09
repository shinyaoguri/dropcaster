# 0006: 公開 Gist を 2 つ目のスケッチソースとして扱う

- **状態**: 採用（2026-08-09）
- **文脈**: dropcaster が取り込めるのは OpenProcessing の作品だけで、作品の置き場が OP に縛られていた。[canvastage](https://github.com/shinyaoguri/canvastage)（ブラウザ上の p5.js ライブコーディングエディタ）は「Share to GitHub Gist」で作品を公開 Gist に書き出すので、これを読めれば canvastage で書いた作品をそのまま投影に回せる（[#57](https://github.com/shinyaoguri/dropcaster/issues/57)）。取り込み元を増やすのは初めてなので、OP 前提で書かれていた箇所をどこまで一般化するかを決める必要があった。
- **決定**:
  - **組み立てロジックは取り込み元から切り離す**。OP の html モード専用だったマルチファイル組み立て（index.html の探索・`<script src>` / `<link>` のインライン展開・fetch/XHR shim 注入）を `core/modules/html-doc-builder.js` に抽出し、OP と Gist の両方がこれに載る。取り込み元ごとの差分は「仮想ファイル表への詰め替え」と「`<base href>` を付けるか」だけに閉じる
  - **URL は取り込み元ごとに分ける**（`/op/<id>`・`/gist/<id>`、クエリ形は `?op=` / `?gist=`）。`/s/<source>/<id>` のような一般形は採らない。ソースが 2 つの段階では対称な 2 本のほうが読みやすく、3 つ目を足すときに改めて一般化すればよい
  - **入力欄は 1 つのまま**にする。OP の作品 ID は 10 進 7〜8 桁、Gist の ID は 16 進 20 桁以上で空間が重ならないので、`core/modules/sketch-ref.js` の `parseSketchRef()` が文字列から取り込み元を判定できる。判定は Gist を先に見る（全桁が数字の Gist ID を OP と誤認しないため。逆方向の誤認は桁数から起きない）
  - **canvastage 専用にはしない**。`index.html` を含む公開 Gist なら受ける。canvastage 由来かは同梱される `_<name>.md` の有無で分かるので、タイトル復元にだけ使う
  - **`<base href>` は付けない**。Gist にはアップロード済みアセットの置き場（OP でいう deckard CDN の `fileBase`）が無く、外部参照はすべて作者が書いた絶対 URL（CDN）だから。同じ理由でアセット proxy も不要で、`assetProxyBaseUrl` 未設定でも Gist は degraded にならない
  - **CORS shim は入れない**。OP の html モードと同じく作者のドキュメント構造を尊重する。p5 の `loadImage` は自前で `crossOrigin='anonymous'` を立てるため、実害は小さい
  - **Service Worker の戦略は OP メタと変える**。OP の作品が実質固定なのに対し、Gist は同じ ID のまま更新される（canvastage は同じ Gist を PATCH で上書きする）。OP メタの CacheFirst（24h）ではなく NetworkFirst + キャッシュ fallback にし、鮮度を優先してキャッシュはオフライン時の保険として持つ
  - 認証は付けない。未認証の GitHub API は 60 req/時・IP 単位で、投影用に作品を開く頻度なら足りる
- **影響**:
  - 3 つ目の取り込み元を足すときは `html-doc-builder` に載せ、`parseSketchRef` に判定を足し、ルートを 1 本増やすだけで済む。逆に、ID 空間が OP や Gist と重なるソースを足すときは「入力欄 1 つ」の前提が崩れるのでこの ADR を見直すこと
  - 同一オリジン・sandbox なし iframe で第三者コードを実行するリスク（[ADR 0001](0001-same-origin-sandboxless-iframe.md)）の母集団が Gist にも広がる。新しい種類のリスクではないが範囲は広がるので、隔離実行の検討（[#35](https://github.com/shinyaoguri/dropcaster/issues/35)）の優先度はその分上がる
  - GitHub API の制限は IP 単位なので、共有回線のイベント会場では枯渇しうる。枯渇時は `x-ratelimit-reset` から待ち時間を出して既存のレート制限画面に載せる。恒常的に足りなくなったら認証トークンの設定を足す（viewer の config に足す形になる）が、ホスト版でトークンを配ると誰でも使えてしまう点は別途考える必要がある
  - CLI（`dropcaster fetch`）は OP のみ対応のまま。ローカルギャラリーへ Gist を取り込む需要が出たら別 Issue で足す
