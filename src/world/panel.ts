import {levelChoices, levelName, toHex} from './theme';
import {defaultThemeConfig, parseColor} from './theme';
import type {WorldMappingConfig, WorldObjectOverride, WorldShapeChoice, WorldShapeId, WorldThemeConfig, WorldThemeDefinition} from './types';

export interface WorldPanelTarget {id: string; title: string; kind: 'group' | 'note'}
export interface WorldPanelOptions {
  mount: HTMLElement;
  theme: WorldThemeDefinition;
  config: WorldThemeConfig;
  targets: WorldPanelTarget[];
  /** Name of the level whose layout is being edited, for example 星系. */
  levelName: string;
  /** Instant preview on every edit; nothing is persisted before 应用. */
  onChange(config: WorldThemeConfig): void;
  onApply(config: WorldThemeConfig): void;
  onCancel(): void;
  onRestoreDefaults(): void;
  onResetLayout(): void;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const FOLLOW = 'level';

/**
 * World settings drawer. It lives inside the canvas, edits a draft copy of the theme
 * configuration and reports every change so the world previews instantly.
 */
export class WorldSettingsPanel {
  readonly element: HTMLDivElement;
  private theme: WorldThemeDefinition;
  private config: WorldThemeConfig;
  private targets: WorldPanelTarget[];
  private level: string;
  private draft: WorldThemeConfig;
  private targetId = '';
  private opened = false;
  private tab = '外观';
  private returnFocus?: HTMLElement;
  private body!: HTMLElement;
  constructor(private options: WorldPanelOptions) {
    this.theme = options.theme;
    this.config = clone(options.config);
    this.draft = clone(options.config);
    this.targets = options.targets;
    this.level = options.levelName;
    const doc = options.mount.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'brain-world-settings';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', `${this.theme.name}世界设置`);
    options.mount.append(this.element);
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.stopPropagation(); event.preventDefault(); this.options.onCancel();}
    });
    this.render();
  }
  get isOpen(): boolean {return this.opened;}
  open(): void {this.returnFocus = this.element.ownerDocument.activeElement as HTMLElement; this.opened = true; this.element.hidden = false; this.element.classList.add('is-open'); this.element.querySelector<HTMLButtonElement>('.brain-world-close')?.focus();}
  close(): void {
    this.opened = false; this.element.hidden = true; this.element.classList.remove('is-open');
    this.element.remove(); this.returnFocus?.focus();
  }
  setTheme(theme: WorldThemeDefinition, config: WorldThemeConfig, targets: WorldPanelTarget[], level: string): void {
    this.theme = theme; this.config = clone(config); this.draft = clone(config);
    this.targets = targets; this.level = level;
    this.element.setAttribute('aria-label', `${theme.name}世界设置`);
    this.render();
  }
  private emit(): void {this.options.onChange(clone(this.draft));}
  private field<K extends 'appearance' | 'layout'>(key: K): WorldThemeConfig[K] {return this.draft[key];}
  private section(title: string): HTMLElement {
    const doc = this.element.ownerDocument;
    const section = doc.createElement('section'); section.className = 'brain-world-section';
    const heading = doc.createElement('h3'); heading.textContent = title; section.append(heading);
    section.hidden = title !== this.tab; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-label', title);
    this.body.append(section);
    return section;
  }
  private row(parent: HTMLElement, label: string, control: HTMLElement): HTMLElement {
    const doc = this.element.ownerDocument;
    const row = doc.createElement('label'); row.className = 'brain-world-row';
    const name = doc.createElement('span'); name.className = 'brain-world-row-label'; name.textContent = label;
    row.append(name, control); parent.append(row);
    return row;
  }
  private colorInput(parent: HTMLElement, label: string, value: string, set: (next: string) => void): void {
    const doc = this.element.ownerDocument;
    const input = doc.createElement('input');
    input.type = 'color'; input.className = 'brain-world-color'; input.value = value;
    input.setAttribute('aria-label', label);
    input.oninput = () => {set(input.value); this.emit();};
    this.row(parent, label, input);
  }
  private range(parent: HTMLElement, label: string, value: number, min: number, max: number, step: number,
    set: (next: number) => void): void {
    const doc = this.element.ownerDocument;
    const wrap = doc.createElement('span'); wrap.className = 'brain-world-range';
    const input = doc.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value); input.setAttribute('aria-label', label);
    const readout = doc.createElement('span'); readout.className = 'brain-world-readout'; readout.textContent = String(value);
    input.oninput = () => {
      const next = Number(input.value); readout.textContent = String(next); set(next); this.emit();
    };
    wrap.append(input, readout); this.row(parent, label, wrap);
  }
  private toggle(parent: HTMLElement, label: string, value: boolean, set: (next: boolean) => void): void {
    const input = this.element.ownerDocument.createElement('input');
    input.type = 'checkbox'; input.checked = value; input.setAttribute('aria-label', label);
    input.onchange = () => {set(input.checked); this.emit();};
    this.row(parent, label, input);
  }
  /** Level options key off the ladder index so duplicated shapes such as 点 stay selectable. */
  private shapeSelect(value: WorldShapeChoice | '', allowFollow: boolean, set: (next: WorldShapeChoice | '') => void): HTMLSelectElement {
    const doc = this.element.ownerDocument;
    const select = doc.createElement('select'); select.className = 'brain-world-shape';
    const add = (optionValue: string, text: string) => {
      const option = doc.createElement('option'); option.value = optionValue; option.textContent = text; select.append(option);
    };
    if (allowFollow) add(FOLLOW, '跟随层级（自动）');
    else add('', '跟随角色默认');
    for (const choice of levelChoices(this.theme)) add(`level:${choice.level}`, choice.name);
    select.value = value === '' ? '' : value === FOLLOW ? FOLLOW
      : `level:${Math.max(0, this.theme.levels.findIndex(level => level.shape === value))}`;
    select.onchange = () => {
      const raw = select.value;
      if (raw === '' ) set('');
      else if (raw === FOLLOW) set(FOLLOW);
      else set(this.theme.levels[Number(raw.slice('level:'.length))]?.shape ?? FOLLOW);
      this.emit();
    };
    return select;
  }
  private render(): void {
    const doc = this.element.ownerDocument;
    this.element.replaceChildren();
    const header = doc.createElement('div'); header.className = 'brain-world-settings-header';
    const title = doc.createElement('strong'); title.textContent = `${this.theme.name} · 世界设置`;
    const close = doc.createElement('button'); close.type = 'button'; close.className = 'brain-world-close'; close.textContent = '关闭'; close.setAttribute('aria-label', '关闭世界设置'); close.onclick = () => this.options.onCancel();
    header.append(title, close); this.element.append(header);
    const tabs = doc.createElement('div'); tabs.className = 'brain-world-tabs'; tabs.setAttribute('role', 'tablist');
    const names = ['外观', '布局', '对象'];
    names.forEach(name => {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = name; button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(name === this.tab)); button.tabIndex = name === this.tab ? 0 : -1;
      button.onclick = () => {this.tab = name; this.render(); this.element.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();};
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); this.tab = names[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (names.indexOf(name) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]!;
        this.render(); this.element.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      }; tabs.append(button);
    }); this.element.append(tabs);
    this.body = doc.createElement('div'); this.body.className = 'brain-world-settings-body'; this.element.append(this.body);
    this.renderAppearance();
    this.renderLayout();
    this.renderMapping();
    const footer = doc.createElement('div'); footer.className = 'brain-world-settings-footer';
    const apply = doc.createElement('button'); apply.type = 'button'; apply.className = 'mod-cta'; apply.textContent = '应用';
    apply.onclick = () => this.options.onApply(clone(this.draft));
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
    cancel.onclick = () => this.options.onCancel();
    const restore = doc.createElement('button'); restore.type = 'button'; restore.textContent = '恢复主题默认';
    restore.onclick = () => {const layout = this.draft.layout; this.draft = {...defaultThemeConfig(this.theme), layout}; this.options.onRestoreDefaults(); this.emit(); this.render();};
    footer.append(apply, cancel, restore); this.element.append(footer);
  }
  private renderAppearance(): void {
    const appearance = this.field('appearance');
    const section = this.section('外观');
    this.colorInput(section, '背景色', appearance.background ?? this.theme.visuals.background,
      next => {appearance.background = next;});
    const palette = appearance.palette ?? [...this.theme.visuals.palette];
    const paletteRow = this.element.ownerDocument.createElement('div'); paletteRow.className = 'brain-world-palette'; section.append(paletteRow);
    palette.forEach((color, index) => {
      const doc = this.element.ownerDocument;
      const wrap = doc.createElement('span'); wrap.className = 'brain-world-palette-entry';
      const input = doc.createElement('input');
      input.type = 'color'; input.value = color; input.className = 'brain-world-color';
      input.setAttribute('aria-label', `领域色板 ${index + 1}`);
      input.oninput = () => {palette[index] = input.value; appearance.palette = palette; this.emit();};
      const remove = doc.createElement('button');
      remove.type = 'button'; remove.className = 'brain-world-remove'; remove.textContent = '移除';
      remove.setAttribute('aria-label', `移除领域色板 ${index + 1}`);
      remove.onclick = () => {palette.splice(index, 1); appearance.palette = palette; this.emit(); this.render();};
      wrap.append(input, remove);
      paletteRow.append(wrap);
    });
    if (palette.length < 8) {
      const add = this.element.ownerDocument.createElement('button');
      add.type = 'button'; add.className = 'brain-world-add'; add.textContent = '添加颜色';
      add.onclick = () => {palette.push('#888888'); appearance.palette = palette; this.emit(); this.render();};
      section.append(add);
    }
    this.range(section, '标签大小', appearance.labelSize ?? this.theme.visuals.labelSize, .5, 2, .05,
      next => {appearance.labelSize = next;});
    this.range(section, '模型大小', appearance.modelScale ?? this.theme.visuals.modelScale, .4, 2.5, .05,
      next => {appearance.modelScale = next;});
    this.toggle(section, '动效', appearance.motion ?? this.theme.visuals.motion, next => {appearance.motion = next;});
    this.range(section, '辉光', appearance.glow ?? this.theme.visuals.glow, 0, 1.5, .05, next => {appearance.glow = next;});
    if (this.theme.id === 'city') {
      this.range(section, '窗灯亮度', appearance.windowLight ?? this.theme.visuals.windowLight ?? 1, 0, 2, .05, next => {appearance.windowLight = next;});
      this.colorInput(section, '地面', appearance.ground ?? this.theme.visuals.ground, next => {appearance.ground = next;});
      this.colorInput(section, '建筑配色', appearance.building ?? this.theme.visuals.building, next => {appearance.building = next;});
    }
  }
  private renderLayout(): void {
    const layout = this.field('layout');
    const section = this.section('布局');
    this.range(section, '领域间距', layout.groupGap ?? this.theme.layout.groupGap, 4, 40, .5,
      next => {layout.groupGap = next;});
    this.range(section, '成员间距', layout.memberGap ?? this.theme.layout.memberGap, 1, 12, .1,
      next => {layout.memberGap = next;});
    const reset = this.element.ownerDocument.createElement('button');
    reset.type = 'button'; reset.className = 'brain-world-reset-layout';
    reset.textContent = `重置「${this.level}」布局`;
    reset.onclick = () => this.options.onResetLayout();
    this.row(section, '位置记录', reset);
  }
  private renderMapping(): void {
    const mapping = this.draft.mapping;
    const section = this.section('对象');
    const selects: [string, 'center' | 'group' | 'member'][] = [['中心', 'center'], ['领域', 'group'], ['笔记', 'member']];
    for (const [label, key] of selects) {
      const doc = this.element.ownerDocument;
      const select = this.shapeSelect(mapping[key], true, next => {
        if (next) mapping[key] = next;
      });
      select.setAttribute('aria-label', `${label}造型`);
      const wrap = this.row(section, label, select);
      const hint = doc.createElement('span'); hint.className = 'brain-world-hint-text';
      hint.textContent = key === 'member' ? '笔记按当前深度取对应层级造型' : '选择该角色使用的内置造型';
      wrap.append(hint);
    }
    this.renderOverride(section, mapping);
  }
  private renderOverride(section: HTMLElement, mapping: WorldMappingConfig): void {
    const doc = this.element.ownerDocument;
    const picker = doc.createElement('select'); picker.className = 'brain-world-target';
    picker.setAttribute('aria-label', '覆盖对象');
    const blank = doc.createElement('option'); blank.value = ''; blank.textContent = '选择要覆盖的领域或笔记'; picker.append(blank);
    for (const kind of ['group', 'note'] as const) {
      for (const target of this.targets.filter(entry => entry.kind === kind)) {
        const option = doc.createElement('option'); option.value = `${kind}:${target.id}`;
        option.textContent = `${kind === 'group' ? '领域' : '笔记'} · ${target.title}`;
        picker.append(option);
      }
    }
    const key = this.targetId.startsWith('group:') ? 'groups' : 'notes';
    const selectedId = this.targetId.slice(this.targetId.indexOf(':') + 1);
    const existing = this.targets.some(target => target.id === selectedId && `${target.kind === 'group' ? 'group' : 'note'}:${target.id}` === this.targetId)
      ? selectedId : '';
    picker.value = existing ? this.targetId : '';
    picker.onchange = () => {this.targetId = picker.value; this.render();};
    this.row(section, '单个对象', picker);
    if (!existing) return;
    const overrides = mapping[key];
    const current: WorldObjectOverride = overrides[existing] ?? {};
    this.colorInput(section, '覆盖颜色', current.color ?? toHex(this.theme.visuals.palette[0] ? parseColor(this.theme.visuals.palette[0], 0x888888) : 0x888888),
      next => {overrides[existing] = {...overrides[existing], color: next};});
    const doc2 = this.element.ownerDocument;
    const icon = doc2.createElement('input');
    icon.type = 'text'; icon.value = current.icon ?? ''; icon.placeholder = '例如 brain-circuit';
    icon.setAttribute('aria-label', '覆盖图标');
    icon.oninput = () => {overrides[existing] = {...overrides[existing] ?? {}, icon: icon.value}; this.emit();};
    this.row(section, '覆盖图标', icon);
    const shape = this.shapeSelect(current.shape ?? '', false, next => {
      const patch = {...overrides[existing] ?? {}};
      if (next && next !== 'level') patch.shape = next as WorldShapeId;
      else delete patch.shape;
      overrides[existing] = patch;
    });
    shape.setAttribute('aria-label', '覆盖造型');
    this.row(section, '覆盖造型', shape);
    const clear = doc2.createElement('button');
    clear.type = 'button'; clear.className = 'brain-world-clear'; clear.textContent = '清除该对象覆盖';
    clear.onclick = () => {delete overrides[existing]; this.emit(); this.render();};
    section.append(clear);
  }
}
export {levelName};
