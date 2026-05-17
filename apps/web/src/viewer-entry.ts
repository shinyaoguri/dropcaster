// apps/web の vite root (= apps/web/) 内に置いておく薄いブラウザ用エントリ。
//
// なぜこのファイルが必要か:
//   apps/web/index.html から `../../src/viewer/main.ts` を直接 <script src=...> しても、
//   dev mode (vite serve) ではブラウザが相対パスを URL として解決し、root 外のため
//   404 (SPA fallback で HTML が返る) になって module が実行されない。
//   ここを経由すれば、エントリ HTML から見える URL は apps/web 内に閉じ、JS 内の
//   import は vite の resolver が /@fs/ 経由で正しく解決してくれる。
//   build 時は rollup が両方とも普通に bundle するので同じく動く。
import '../../../src/viewer/main.ts';
