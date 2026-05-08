import './style.css';
import { App } from './App.js';
import { getBasePath, publicAssetPath } from './utils/paths.js';

// Service Workerの登録
if ('serviceWorker' in navigator && window.location.hostname !== 'localhost') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(publicAssetPath('sw.js'), {
      scope: getBasePath()
    })
      .then(registration => {
        console.log('ServiceWorker registration successful:', registration);
      })
      .catch(err => {
        console.error('ServiceWorker registration failed:', err);
      });
  });
}

// アプリケーションの初期化
const app = new App();
app.initialize();
