export class Error404View {
  static render(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    
    app.innerHTML = `
      <div class="container error-page">
        <h1 class="error-title">404</h1>
        <p class="error-message">スケッチが見つかりませんでした</p>
        <a href="/" class="error-link">ギャラリーに戻る</a>
      </div>
    `;
  }
}
