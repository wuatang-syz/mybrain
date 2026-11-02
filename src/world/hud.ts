import type {ResolvedAppearance, WorldThemeDefinition} from './types';

/** World heading, view controls and interaction hint. */
export class WorldHud {
  readonly element: HTMLDivElement;
  private heading: HTMLElement;
  private hint: HTMLElement;
  constructor(parent: HTMLElement, actions: {fit(): void; back?(): void; layout?(): boolean}) {
    const doc = parent.ownerDocument;
    this.element = doc.createElement('div'); this.element.className = 'brain-world-hud';
    const intro = doc.createElement('div'); intro.className = 'brain-world-intro';
    this.heading = doc.createElement('h2'); intro.append(this.heading); this.element.append(intro);
    const quick = doc.createElement('div'); quick.className = 'brain-world-quick';
    const button = (text: string, run: () => void) => {
      const el = doc.createElement('button'); el.type = 'button'; el.textContent = text; el.onclick = run; quick.append(el); return el;
    };
    button('返回上层', () => actions.back?.()); button('全景', actions.fit);
    const layout = button('调整布局', () => {
      const enabled = actions.layout?.() ?? false;
      layout.setAttribute('aria-pressed', String(enabled)); layout.textContent = enabled ? '完成布局' : '调整布局';
    });
    layout.setAttribute('aria-pressed', 'false'); this.element.append(quick);
    this.hint = doc.createElement('div'); this.hint.className = 'brain-world-hint'; this.element.append(this.hint);
    parent.append(this.element);
  }
  setTheme(theme: WorldThemeDefinition, appearance: ResolvedAppearance): void {
    this.heading.textContent = theme.copy.heading; this.element.dataset.theme = theme.id;
    this.hint.textContent = '单击聚焦，有正文时打开 · 双击进入下一层 · 滚轮缩放';
    this.element.style.setProperty('--world-surface', `#${appearance.background.toString(16).padStart(6, '0')}`);
  }
  destroy(): void {this.element.remove();}
}
