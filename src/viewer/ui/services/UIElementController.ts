export class UIElementController {
  private readonly elements = {
    fullscreenBtn: () => document.getElementById('fullscreen-btn') as HTMLButtonElement,
    openWindowsBtn: () => document.getElementById('open-windows-btn') as HTMLButtonElement,
    overlayInfo: () => document.querySelector('.sketch-overlay-info') as HTMLDivElement
  };

  showElements(): void {
    this.setElementsVisibility(true);
  }

  hideElements(): void {
    this.setElementsVisibility(false);
  }

  toggleElements(isVisible: boolean): void {
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
    const icon = fullscreenBtn?.querySelector('.fullscreen-icon') as HTMLElement | null;
    if (icon) {
      icon.className = isFullscreen
        ? 'fas fa-compress fullscreen-icon button-icon'
        : 'fas fa-expand fullscreen-icon button-icon';
    }
  }

  setFullscreenActiveState(isFullscreen: boolean): void {
    [this.elements.fullscreenBtn(), this.elements.openWindowsBtn()].forEach(btn => {
      btn?.classList.toggle('fullscreen-active', isFullscreen);
    });
  }
}
