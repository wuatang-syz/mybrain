export interface WorldActionThemeOption {id: string; name: string}
export interface WorldActionsOptions {
  renderIcon(element: HTMLElement, name: string): void;
  themes(): WorldActionThemeOption[];
  theme(): string;
  setTheme(id: string): void;
  settingsOpen(): boolean;
  toggleSettings(): void;
  motionOn(): boolean;
  toggleMotion(): void;
  /** Theme wording for the motion toggle, for example 暂停动效 / 开启动效. */
  motionLabels?(): {on: string; off: string};
}

/**
 * The world's own chrome: one vertical icon rail that hangs under the shared search icon, so
 * theme switching, world settings and the motion toggle never split the top bar, which stays the
 * same in every view. It is mounted inside the world canvas so each theme can skin the buttons.
 */
export class WorldActions {
  readonly element: HTMLDivElement;
  private readonly themeButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly motionButton: HTMLButtonElement;
  private readonly menu: HTMLDivElement;
  private readonly outside: (event: Event) => void;
  private open = false;
  private motionIcon = '';

  constructor(parent: HTMLElement, private readonly options: WorldActionsOptions) {
    const doc = parent.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'brain-world-actions';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-orientation', 'vertical');
    // No container label: Obsidian tooltips every aria-label, and 世界操作 kept surfacing between
    // the icons. Each button keeps its own label.
    this.themeButton = this.button('切换世界主题', 'repeat');
    this.menu = doc.createElement('div');
    this.menu.className = 'brain-world-themes';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.settingsButton = this.button('世界设置', 'settings');
    this.motionButton = this.button('暂停动效', 'pause');
    this.themeButton.setAttribute('aria-haspopup', 'menu');
    this.themeButton.addEventListener('click', () => {if (this.open) this.closeMenu(); else this.openMenu();});
    this.settingsButton.addEventListener('click', () => {
      this.closeMenu(); this.options.toggleSettings(); this.update();
    });
    this.motionButton.addEventListener('click', () => {
      this.closeMenu(); this.options.toggleMotion(); this.update();
    });
    this.element.append(this.themeButton, this.menu, this.settingsButton, this.motionButton);
    this.element.addEventListener('keydown', event => {
      if (this.open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = [...this.menu.querySelectorAll<HTMLButtonElement>('button')];
        const current = items.indexOf(doc.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[next]?.focus(); return;
      }
      if (event.key !== 'Escape' || !this.open) return;
      event.stopPropagation(); this.closeMenu(); this.themeButton.focus();
    });
    // A pointer anywhere else closes the theme list, matching the shared 更多操作 menu.
    this.outside = event => {
      if (this.open && !this.element.contains(event.target as Node | null)) this.closeMenu();
    };
    doc.addEventListener('pointerdown', this.outside, true);
    parent.append(this.element);
    this.update();
  }

  private button(label: string, icon: string): HTMLButtonElement {
    const doc = this.element.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'brain-world-action';
    button.setAttribute('aria-label', label);
    this.paint(button, icon);
    return button;
  }
  private paint(button: HTMLButtonElement, icon: string): void {
    button.replaceChildren();
    const glyph = button.ownerDocument.createElement('span');
    glyph.className = 'brain-world-action-glyph';
    this.options.renderIcon(glyph, icon);
    button.append(glyph);
  }
  /** Reflects the theme, the settings drawer and the motion state without rebuilding buttons. */
  update(): void {
    const themes = this.options.themes(), current = this.options.theme();
    const name = themes.find(option => option.id === current)?.name ?? current;
    this.themeButton.setAttribute('aria-label', `切换世界主题（当前：${name}）`);
    this.themeButton.setAttribute('aria-expanded', String(this.open));
    this.themeButton.setAttribute('aria-pressed', String(this.open));
    const settings = this.options.settingsOpen();
    this.settingsButton.setAttribute('aria-pressed', String(settings));
    this.settingsButton.setAttribute('aria-label', settings ? '关闭世界设置' : '世界设置');
    const motion = this.options.motionOn(), icon = motion ? 'pause' : 'play';
    const labels = this.options.motionLabels?.() ?? {on: '暂停动效', off: '开启动效'};
    this.motionButton.setAttribute('aria-pressed', String(motion));
    this.motionButton.setAttribute('aria-label', motion ? labels.on : labels.off);
    if (this.motionIcon !== icon) {this.motionIcon = icon; this.paint(this.motionButton, icon);}
    if (this.open) this.renderMenu(themes, current);
  }
  private renderMenu(themes: WorldActionThemeOption[], current: string): void {
    const doc = this.element.ownerDocument;
    this.menu.replaceChildren();
    for (const option of themes) {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'brain-world-theme-option';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(option.id === current));
      item.textContent = option.name;
      if (option.id === current) item.classList.add('is-current');
      item.addEventListener('click', () => {
        this.closeMenu(); this.options.setTheme(option.id);
        this.themeButton.focus(); this.update();
      });
      this.menu.append(item);
    }
  }
  private openMenu(): void {
    this.open = true; this.menu.hidden = false;
    this.update();
    this.menu.querySelector<HTMLButtonElement>('.is-current')?.focus();
  }
  private closeMenu(): void {
    if (!this.open) return;
    this.open = false; this.menu.hidden = true;
    this.menu.replaceChildren();
    this.update();
  }
  /** Mode switches and renames close the transient list; the rail itself is rebuilt with the canvas. */
  close(): void {this.closeMenu();}
  destroy(): void {
    this.element.ownerDocument.removeEventListener('pointerdown', this.outside, true);
    this.element.remove();
  }
}
