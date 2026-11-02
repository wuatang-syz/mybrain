import { setIcon } from 'obsidian';

export interface FooterOptions {
  zoomOut(): void;
  zoomIn(): void;
  fit(): void;
}

/**
 * The single footer strip every Brain mode shares: zoom out/in, the zoom readout and fit. Canvases only supply the actions.
 */
export class BrainFooterControls {
  readonly element: HTMLDivElement;
  private readonly zoomValue: HTMLSpanElement;

  constructor(parent: HTMLElement, options: FooterOptions) {
    const doc = parent.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'brain-zoom brain-footer-controls';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', '画布视图');
    const control = (label: string, icon: string, run: () => void, description?: string) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'brain-button';
      button.setAttribute('aria-label', label);
      if (description) button.setAttribute('aria-description', description);
      button.addEventListener('click', run);
      setIcon(button, icon);
      this.element.append(button);
      return button;
    };
    control('缩小', 'minus', () => options.zoomOut());
    this.zoomValue = doc.createElement('span');
    this.zoomValue.className = 'brain-zoom-value';
    this.zoomValue.textContent = '100%';
    this.element.append(this.zoomValue);
    control('放大', 'plus', () => options.zoomIn());
    control('适应画布', 'maximize', () => options.fit());
    parent.append(this.element);
  }

  setZoom(percent: number): void {
    if (Number.isFinite(percent)) this.zoomValue.textContent = `${Math.round(percent)}%`;
  }
  destroy(): void {
    this.element.remove();
  }
}
