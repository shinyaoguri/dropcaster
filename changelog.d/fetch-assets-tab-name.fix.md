`dropcaster fetch` が、`assets` という名前のタブを持つ OpenProcessing の html モード作品を、アセットごと取り込めるようにした。これまではアセットの同梱先 `assets/` と同じ名前のファイルを書こうとして失敗していた。

タブは `assets_2` のような別名で保存し、`<script src="assets">` や `loadStrings('assets')` のように URL を書く位置にある参照を新しい名前に揃える。`--no-assets` のとき、同梱するアセットが無いとき、p5js モードの作品の結果は変わらない。
