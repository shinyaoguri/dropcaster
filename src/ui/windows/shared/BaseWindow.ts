export abstract class BaseWindow {
  protected window: Window | null = null;
  protected windowName: string;
  protected windowTitle: string;

  constructor(windowName: string, windowTitle: string) {
    this.windowName = windowName;
    this.windowTitle = windowTitle;
  }

  setWindow(window: Window): void {
    this.window = window;
    this.initialize();
  }

  protected abstract initialize(): void;
  protected abstract getContent(): string;

  render(): void {
    if (!this.window) {
      console.error(`${this.windowTitle}: ウィンドウが設定されていません`);
      return;
    }

    this.window.document.body.innerHTML = this.getContent();
    this.setupEventListeners();
    this.setupStyles();
  }

  protected setupStyles(): void {
    if (!this.window) return;

    const style = this.window.document.createElement('style');
    style.textContent = this.getStyles();
    this.window.document.head.appendChild(style);
  }

  protected getStyles(): string {
    return `
      body {
        margin: 0;
        padding: 20px;
        font-family: 'M PLUS 1 Code', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        background-color: #f8fafc;
        color: #334155;
        line-height: 1.6;
      }
      
      h1 {
        font-size: 1.5rem;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 1rem;
        border-bottom: 2px solid #e2e8f0;
        padding-bottom: 0.5rem;
      }
      
      .window-container {
        max-width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
      }
      
      .window-header {
        flex-shrink: 0;
        background: white;
        padding: 1rem;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        margin-bottom: 1rem;
      }
      
      .window-content {
        flex: 1;
        background: white;
        padding: 1rem;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        overflow: auto;
      }
      
      button {
        background: #3b82f6;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.875rem;
        transition: background-color 0.2s;
      }
      
      button:hover {
        background: #2563eb;
      }
      
      button:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }
    `;
  }

  protected setupEventListeners(): void {
    // 子クラスでオーバーライド
  }

  protected addEventListenerToElement(selector: string, event: string, handler: (e: Event) => void): void {
    if (!this.window) return;
    
    const element = this.window.document.querySelector(selector);
    if (element) {
      element.addEventListener(event, handler);
    }
  }

  isOpen(): boolean {
    return this.window ? !this.window.closed : false;
  }

  focus(): void {
    if (this.window && !this.window.closed) {
      this.window.focus();
    }
  }

  close(): void {
    if (this.window && !this.window.closed) {
      this.window.close();
    }
  }

  getWindow(): Window | null {
    return this.window;
  }
}