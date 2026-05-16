import './style.css';
import { App } from './App.js';
import { registerServiceWorker } from './pwa/register.js';

// Service Worker (config.enablePwa を尊重し localhost でも secure context として登録)
registerServiceWorker();

// アプリケーションの初期化
const app = new App();
app.initialize();
