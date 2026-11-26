// dev サーバでは Service Worker を使わない (#180)。
//
// SW はローカル作品を StaleWhileRevalidate で返すので、dev で登録すると、作品を書き換えても
// 1 回目の再読み込みには古い版が出る。dev サーバ (利用者の `dropcaster dev`、このリポジトリの
// `npm run dev` / `npm run dev:web`) はこのプラグインを入れ、次の 2 つをそろえて行う:
//   - viewer に dev サーバで動いていることを伝える (import.meta.env.DROPCASTER_DEV_SERVER)。
//     viewer (src/viewer/pwa/register.ts) はこのとき SW を登録しない
//   - 配信する index.html の先頭に、同じオリジンに残っている登録 (以前の版の dev や、同じポートで
//     動かした preview のもの) を外すスクリプトを入れる
// PWA の挙動 (オフライン起動・更新の通知) は本番ビルドで確かめる (`dropcaster build` + `dropcaster preview`)。

/**
 * 残っている登録を外し、ページが SW に制御されていたら 1 度だけ読み込み直す。
 *
 * index.html に直接入れるのは、残っている SW が viewer のモジュールを古い版のままキャッシュから返すため。
 * viewer の側に書いても、最初の読み込みでは動かない。HTML は SW がネットワークから取るので必ず届く。
 * 制御されていたページは古い SW のキャッシュから組み立てられている (viewer も作品も古い版でありうる)。
 * 登録を外した後の読み込みには SW が付かないので、読み込み直せばいまのファイルになり、それ以上は繰り返さない。
 * 片付け用の sw.js を配信して更新で置き換える方法は採らない: 新しい SW の有効化は、古い SW が処理中の
 * 要求を抱えている間は待たされる。以前の版の dropcaster dev が残した SW で試すと、片付け用の SW は待機のまま、
 * 30 秒たっても古い SW がページを制御していた (実測、#180)。
 * キャッシュは消さない。SW が無ければ参照されない。
 */
/**
 * @param {string} base dev サーバの base (`/` や `/sub/`)
 * @returns {string} index.html に入れるスクリプト
 */
export function devUnregisterScript(base) {
  return `// dropcaster: dev サーバでは Service Worker を使わない。残っている登録を外す。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    // 外すのは、このページを制御しうる登録 (scope が base かその上) だけ。作品が自分の階層に登録した SW は残す
    const base = new URL(${JSON.stringify(base)}, location.href).href;
    await Promise.all(registrations.filter((registration) => base.startsWith(registration.scope)).map((registration) => registration.unregister()));
    // 登録が空でも、制御は残っていることがある (別のタブが先に登録を外した)。制御されている限り読み込み直す
    if (!navigator.serviceWorker.controller) return;
    // 登録を外しても制御が消えない環境で繰り返さないよう、タブごとに 10 秒に 1 回までにする
    const key = 'dropcaster-dev-sw-reload';
    if (Date.now() - Number(sessionStorage.getItem(key) || 0) < 10000) return;
    sessionStorage.setItem(key, String(Date.now()));
    location.reload();
  }).catch(() => {});
}`;
}

/**
 * dev サーバ用の Vite プラグイン。build には掛からない (`apply: 'serve'`) ので、本番ビルドの viewer は
 * 今までどおり SW を登録する。
 *
 * @returns {import('vite').Plugin}
 */
export function devServiceWorker() {
  let base = '/';
  return {
    name: 'dropcaster:dev-service-worker',
    apply: 'serve',
    config: () => ({
      define: { 'import.meta.env.DROPCASTER_DEV_SERVER': 'true' },
    }),
    configResolved(config) { base = config.base; },
    // head の先頭に入れる: 後ろに置くと、外部のスタイルシート (フォントなど) の読み込みが終わるまで実行されない
    transformIndexHtml: () => [
      { tag: 'script', children: devUnregisterScript(base), injectTo: 'head-prepend' },
    ],
  };
}
