/**
 * Dropcaster Configuration File
 *
 * `npx dropcaster init` で生成されるプロジェクトには dropcaster.config.js が
 * 自動で作られます。手動でセットアップする場合はこのファイルを
 * `dropcaster.config.js` にリネームして使ってください。
 *
 * ここで設定するのは PWA manifest と <head> のメタ情報です。
 * 凝ったオフライン/キャッシュ設定（offline_mode / cache_strategy）は廃止しました —
 * Service Worker は「インストール可能にするだけ」の最小構成で、キャッシュはしません。
 */

export default {
  // ギャラリー名（ブラウザのタブ・PWA 名・manifest の name）
  title: 'My Sketch Gallery',

  // ギャラリーの説明（<meta name="description"> と manifest の description）
  description: 'A collection of creative coding sketches',

  // テーマカラー（<meta name="theme-color"> と manifest の theme_color）
  theme_color: '#000000',

  // 背景色（PWA 起動中のスプラッシュなどに使われる）
  background_color: '#ffffff',

  // 表示モード: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
  display: 'standalone',

  // PWA 起動時の URL
  start_url: '/',

  // デプロイ先のベース URL（GitHub Pages のサブパスなど。例: '/my-gallery/'）
  // dropcaster build --base <path> でも指定可。未指定なら '/'。
  // base: '/',

  // カスタムアイコン: public/icon.png（512x512）または public/icon.svg を置けば
  // 自動で manifest に組み込まれます。どちらも無ければデフォルトの SVG が生成されます。
};
