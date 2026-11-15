// 新しい版の通知 (#164) の文言。[英語, 日本語]。
const labels = {
  available: ['A new version is available.', '新しい版があります。'],
  apply: ['Reload to update', '再読み込みして更新'],
  applyHint: ['Reloading closes open output windows.', '再読み込みすると、開いている出力ウィンドウは閉じます。'],
  reloadRequired: ['A new version has been released. Please reload the page.', '新しい版が出ています。再読み込みしてください。'],
  reload: ['Reload', '再読み込み'],
  dismiss: ['Dismiss', '閉じる'],
} as const;
type Dictionary = { [K in keyof typeof labels as `pwa.${K}`]: string };
export const pwaEn = Object.fromEntries(Object.entries(labels).map(([key, values]) => [`pwa.${key}`, values[0]])) as Dictionary;
export const pwaJa = Object.fromEntries(Object.entries(labels).map(([key, values]) => [`pwa.${key}`, values[1]])) as Dictionary;
