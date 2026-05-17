import { t } from '../i18n/index.js';

export interface WindowConfig {
  name: string;
  title: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  features?: string[];
}

export class WindowManager {
  private openWindows = new Map<string, Window>();

  openWindow(config: WindowConfig): Window | null {
    const {
      name,
      title,
      width = 600,
      height = 400,
      left = 100,
      top = 100,
      features = ['scrollbars=yes', 'resizable=yes']
    } = config;

    // 既存のウィンドウが開いている場合はフォーカスを当てる
    const existingWindow = this.openWindows.get(name);
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
      return existingWindow;
    }
    this.openWindows.delete(name); // 閉じられていれば Map から除去

    const featuresString = [`width=${width}`, `height=${height}`, `left=${left}`, `top=${top}`, ...features].join(',');
    // 空 URL（about:blank）で開くと window.opener が保持される（同一オリジンで親 ↔ 子の DOM が触れる）
    const newWindow = window.open('', name, featuresString);
    if (!newWindow) {
      console.error(t('window.createFailed', { title }));
      return null;
    }

    newWindow.document.title = title;
    newWindow.document.body.style.margin = '0';
    newWindow.document.body.style.padding = '0';
    this.openWindows.set(name, newWindow);
    newWindow.addEventListener('beforeunload', () => this.openWindows.delete(name));
    return newWindow;
  }

  getWindow(name: string): Window | null {
    const window = this.openWindows.get(name);
    if (window && window.closed) {
      this.openWindows.delete(name);
      return null;
    }
    return window || null;
  }

  closeWindow(name: string): void {
    const window = this.openWindows.get(name);
    if (window && !window.closed) {
      window.close();
    }
    this.openWindows.delete(name);
  }

  closeAllWindows(): void {
    for (const [, window] of this.openWindows) {
      if (!window.closed) {
        window.close();
      }
    }
    this.openWindows.clear();
  }

}