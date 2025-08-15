export class UIElementController {
  private readonly elements = {
    fullscreenBtn: () => document.getElementById('fullscreen-btn') as HTMLButtonElement,
    windowSettingsBtn: () => document.getElementById('window-settings-btn') as HTMLButtonElement,
    overlayInfo: () => document.querySelector('.sketch-overlay-info') as HTMLDivElement
  };

  showElements(): void {
    console.log('UI要素を表示します');
    this.setElementsVisibility(true);
  }

  hideElements(): void {
    console.log('UI要素を非表示にします');
    this.setElementsVisibility(false);
  }

  toggleElements(isVisible: boolean): void {
    console.log(`UI要素を${isVisible ? '表示' : '非表示'}にします`);
    this.setElementsVisibility(isVisible);
  }

  private setElementsVisibility(isVisible: boolean): void {
    const opacity = isVisible ? '1' : '0';
    const pointerEvents = isVisible ? 'auto' : 'none';

    Object.values(this.elements).forEach(getElement => {
      const element = getElement();
      if (element) {
        element.style.opacity = opacity;
        element.style.pointerEvents = pointerEvents;
      }
    });
  }

  updateFullscreenButtonIcon(isFullscreen: boolean): void {
    const fullscreenBtn = this.elements.fullscreenBtn();
    if (fullscreenBtn) {
      const icon = fullscreenBtn.querySelector('.fullscreen-icon') as HTMLElement;
      if (icon) {
        icon.className = isFullscreen 
          ? 'fas fa-compress fullscreen-icon button-icon'
          : 'fas fa-expand fullscreen-icon button-icon';
        console.log(isFullscreen ? '🔴 フルスクリーン終了アイコンに変更' : '🟢 フルスクリーン開始アイコンに変更');
      }
    }
  }

  setFullscreenActiveState(isFullscreen: boolean): void {
    const fullscreenBtn = this.elements.fullscreenBtn();
    const windowSettingsBtn = this.elements.windowSettingsBtn();
    
    [fullscreenBtn, windowSettingsBtn].forEach(btn => {
      if (btn) {
        btn.classList.toggle('fullscreen-active', isFullscreen);
      }
    });
  }
}