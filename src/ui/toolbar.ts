export type BrainMode = 'mind' | 'graph' | 'map';
export type ToolbarAction = 'back' | 'next' | 'search' | 'create' | 'follow' | 'undo' | 'redo';
export interface ToolbarOptions {
  vault: string;
  switchMode?(graph: BrainMode): void;
  renderIcon(element: HTMLElement, name: string): void;
  run(action: ToolbarAction): void;
}

/** Shared native DOM chrome for the plugin and its interactive preview. */
export class BrainToolbar {
  readonly element: HTMLDivElement;
  readonly rootHost: HTMLDivElement;
  readonly menu: HTMLDivElement;
  readonly buttons = {} as Record<ToolbarAction, HTMLButtonElement>;

  setMode(graph: BrainMode): void {
    this.element.querySelectorAll<HTMLButtonElement>('.brain-modes button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.graph === String(graph))));
  }
  /** Returns the shared search control to its toolbar slot; the native graph borrows it. */
  restoreSearch(): void {
    const search = this.buttons.search, modes = this.element.querySelector('.brain-modes');
    if (modes) this.element.insertBefore(search, modes); else this.element.append(search);
    search.classList.remove('brain-graph-search');
  }

  constructor(parent: HTMLElement, options: ToolbarOptions) {
    const doc = parent.ownerDocument;
    this.element = doc.createElement('div'); this.element.className = 'brain-toolbar';
    this.rootHost = doc.createElement('div'); this.rootHost.className = 'brain-root-slot';
    this.element.append(this.rootHost);
    const more = doc.createElement('details'); more.className = 'brain-more';
    const button = (host: HTMLElement, action: ToolbarAction, label: string, icon: string) => {
      const el = doc.createElement('button'); el.type = 'button'; el.className = 'brain-button';
      el.setAttribute('aria-label', label);
      const glyph = doc.createElement('span'); options.renderIcon(glyph, icon);
      const text = doc.createElement('span'); text.textContent = label;
      el.append(glyph, text); host.append(el); this.buttons[action] = el;
      el.addEventListener('click', () => { more.open = false; options.run(action); }); return el;
    };
    button(this.element, 'search', '搜索笔记', 'search').classList.add('brain-search');
    if (options.switchMode) {
      const modes = doc.createElement('div'); modes.className = 'brain-modes';
      for (const [label, graph] of [['思维导图', 'mind'], ['关系图谱', 'graph'], ['知识世界', 'map']] as const) {
        const mode = doc.createElement('button'); mode.type = 'button'; mode.className = 'brain-button'; mode.textContent = label;
        mode.setAttribute('aria-pressed', String(graph === 'mind'));
        mode.onclick = () => options.switchMode?.(graph);
        mode.dataset.graph = String(graph); modes.append(mode);
      }
      this.element.append(modes);
    }
    const summary = doc.createElement('summary'); summary.className = 'brain-button';
    summary.setAttribute('aria-label', '更多操作'); options.renderIcon(summary, 'ellipsis');
    const menu = doc.createElement('div'); menu.className = 'brain-more-menu';
    this.menu = menu;
    button(menu, 'create', '新建笔记', 'plus');
    button(menu, 'back', '后退', 'arrow-left'); button(menu, 'next', '前进', 'arrow-right');
    button(menu, 'follow', '跟随当前笔记', 'crosshair');
    button(menu, 'undo', '撤销关系变更', 'undo-2'); button(menu, 'redo', '重做关系变更', 'redo-2');
    more.append(summary, menu); this.element.append(more); parent.append(this.element);
    more.addEventListener('keydown', event => { if (event.key === 'Escape') { more.open = false; summary.focus(); } });
    more.addEventListener('focusout', event => { if (!more.contains(event.relatedTarget as Node | null)) more.open = false; });
  }
}
