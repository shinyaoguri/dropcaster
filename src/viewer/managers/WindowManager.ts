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

    console.log(`${title}を開く処理を開始します`);

    // 既存のウィンドウが開いている場合はフォーカスを当てる
    if (this.openWindows.has(name)) {
      const existingWindow = this.openWindows.get(name);
      if (existingWindow && !existingWindow.closed) {
        existingWindow.focus();
        console.log(`既存の${title}にフォーカスしました`);
        return existingWindow;
      } else {
        // ウィンドウが閉じられている場合はMapから削除
        this.openWindows.delete(name);
      }
    }

    const featuresString = [`width=${width}`, `height=${height}`, `left=${left}`, `top=${top}`, ...features].join(',');
    
    console.log(`WindowManager: window.open()を実行`);
    console.log(`  パラメータ: name="${name}", features="${featuresString}"`);
    
    // window.openerが保持されるように、同じオリジンのURLを使用
    const newWindow = window.open('', name, featuresString);
    
    if (newWindow) {
      // ウィンドウの初期設定
      newWindow.document.title = title;
      newWindow.document.body.style.margin = '0';
      newWindow.document.body.style.padding = '0';
      
      this.openWindows.set(name, newWindow);
      
      // ウィンドウが閉じられた時の処理
      newWindow.addEventListener('beforeunload', () => {
        this.openWindows.delete(name);
        console.log(`${title}が閉じられました`);
      });
      
      // 実際のウィンドウ位置を確認（少し遅延を入れる）
      setTimeout(() => {
        console.log(`${title}の実際の位置: (${newWindow.screenX}, ${newWindow.screenY})`);
        console.log(`${title}の実際のサイズ: ${newWindow.outerWidth} x ${newWindow.outerHeight}`);
      }, 100);
      
      console.log(`✅ ${title}を開きました`);
      return newWindow;
    } else {
      console.error(`❌ ${title}の作成に失敗しました（ポップアップがブロックされた可能性があります）`);
      return null;
    }
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