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
export const DEV_UNREGISTER_SCRIPT = `// dropcaster: dev サーバでは Service Worker を使わない。残っている登録を外す。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    if (registrations.length === 0) return;
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (navigator.serviceWorker.controller) location.reload();
  }).catch(() => {});
}`;

/**
 * dev サーバ用の Vite プラグイン。build には掛からない (`apply: 'serve'`) ので、本番ビルドの viewer は
 * 今までどおり SW を登録する。
 *
 * @returns {import('vite').Plugin}
 */
export function devServiceWorker() {
  return {
    name: 'dropcaster:dev-service-worker',
    apply: 'serve',
    config: () => ({
      define: { 'import.meta.env.DROPCASTER_DEV_SERVER': 'true' },
    }),
    // head の先頭に入れる: 後ろに置くと、外部のスタイルシート (フォントなど) の読み込みが終わるまで実行されない
    transformIndexHtml: () => [
      { tag: 'script', children: DEV_UNREGISTER_SCRIPT, injectTo: 'head-prepend' },
    ],
  };
}
