/** A vault-wide anchor, deliberately separate from the current browsing center. */
export class BrainRootBar {
  readonly element: HTMLDivElement;
  private readonly home: HTMLButtonElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver;
  private frame?: number;
  readonly summary: HTMLSpanElement;
  constructor(parent: HTMLElement, menu: HTMLElement, actions: {choose(): void; home(): void; renderIcon?(element: HTMLElement, name: string): void}) {
    const doc = parent.ownerDocument;
    this.element = doc.createElement('div'); this.element.className = 'brain-root-bar';
    this.home = doc.createElement('button'); this.home.type = 'button'; this.home.className = 'brain-button brain-root-home';
    this.home.onclick = actions.home;
    void menu;
    this.summary = doc.createElement('span'); this.summary.className = 'brain-root-summary';
    this.element.append(this.home); parent.append(this.element);
    const controls = doc.createElement('div'); controls.className = 'brain-path-controls';
    const arrow = (label: string, glyph: string, direction: number) => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'brain-button brain-path-arrow';
      button.textContent = glyph; button.setAttribute('aria-label', label);
      button.onclick = () => { this.element.scrollLeft += direction * Math.max(80, this.element.clientWidth * .7); this.updateArrows(); };
      controls.append(button); return button;
    };
    this.previous = arrow('查看左侧路径', '◀', -1);
    this.next = arrow('查看右侧路径', '▶', 1);
    parent.append(controls);
    this.element.addEventListener('scroll', () => this.updateArrows());
    this.resizeObserver = new ResizeObserver(() => this.updateArrows());
    this.resizeObserver.observe(this.element);
    this.scheduleArrows();
  }
  private updateArrows(): void {
    const overflow = this.element.scrollWidth > this.element.clientWidth + 1;
    this.previous.parentElement!.hidden = !overflow;
    this.previous.disabled = this.element.scrollLeft <= 1;
    this.next.disabled = this.element.scrollLeft + this.element.clientWidth >= this.element.scrollWidth - 1;
  }
  private scheduleArrows(): void {
    const win = this.element.ownerDocument.defaultView!;
    if (this.frame !== undefined) win.cancelAnimationFrame(this.frame);
    this.frame = win.requestAnimationFrame(() => { this.frame = undefined; this.updateArrows(); });
  }
  destroy(): void {
    this.resizeObserver.disconnect();
    if (this.frame !== undefined) this.element.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
  }
  setPath(items: {id: string; title: string}[], current: string | null, navigate: (id: string) => void): void {
    this.scheduleArrows();
    this.element.querySelectorAll('.brain-path-part').forEach(element => element.remove());
    for (const item of items.slice(1)) {
      const separator = this.element.createSpan({text: '›', cls: 'brain-path-part'});
      separator.setAttribute('aria-hidden', 'true');
      const button = this.element.createEl('button', {text: item.title, cls: 'brain-button brain-path-part'});
      if (item.id === current) button.setAttribute('aria-current', 'page');
      button.onclick = () => navigate(item.id);
    }
  }
  update(root: {path: string | null; title?: string}): void {
    this.scheduleArrows();
    this.home.textContent = root.title ?? '知识库';
    this.home.disabled = !root.title;
    this.home.setAttribute('aria-label', root.title ? `返回根节点：${root.title}` : '尚未设置根节点');
    this.summary.textContent = root.title ? `知识库：${root.title}` : '正在读取知识库';
    this.summary.title = '父子层级与知识库文件夹一致。';
  }
}
