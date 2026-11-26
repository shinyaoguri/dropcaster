import './style.css';
import { App } from './App.js';
import { registerServiceWorker, watchLazyLoadFailures } from './pwa/register.js';

// Service Worker (config.enablePwa を尊重する。dev サーバでは登録しない。本番ビルドは localhost でも登録する)
registerServiceWorker();
// デプロイで旧版の遅延チャンクが消えていたら、再読み込みを案内する (#164)
watchLazyLoadFailures();

// アプリケーションの初期化
const app = new App();
app.initialize();
