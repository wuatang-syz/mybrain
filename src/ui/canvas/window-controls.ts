import type {Point} from '../../model/types';
import {windowNames, type RelationWindow, type WindowLayout, type WindowZone} from './windows';

/** Only the scrollbar has a surface; the nodes and curves stay on the graph canvas. */
export class WindowControls {
  readonly element: HTMLDivElement;
  private controls = new Map<WindowZone, {label: HTMLElement; range: HTMLInputElement}>();
  private layout?: WindowLayout;
  private pending?: {zone: WindowZone; offset: number};
  private frame = 0;
  private win: Window;
  private readonly wheel: (event: WheelEvent) => void;
  constructor(host: HTMLElement, interaction: HTMLElement, private world: (event: MouseEvent) => Point,
    private change: (zone: WindowZone, offset: number) => void, private enabled: () => boolean) {
    const doc = host.ownerDocument;
    this.win = doc.defaultView!;
    this.element = doc.createElement('div'); this.element.className = 'brain-relation-windows'; host.append(this.element);
    for (const zone of ['parent', 'child', 'sibling', 'jump'] as WindowZone[]) {
      const label = doc.createElement('span'); label.className = 'brain-window-label'; label.dataset.zone = zone;
      const range = doc.createElement('input'); range.type = 'range'; range.min = '0'; range.step = '1';
      range.className = 'brain-window-scroll'; range.dataset.zone = zone;
      range.setAttribute('aria-label', `滚动${windowNames[zone]}节点`);
      range.addEventListener('input', () => {if (this.enabled()) this.queue(zone, Number(range.value));});
      range.addEventListener('pointerdown', event => event.stopPropagation());
      range.addEventListener('keydown', event => event.stopPropagation());
      this.element.append(label, range); this.controls.set(zone, {label, range});
    }
    this.wheel = event => {
      if (event.ctrlKey || event.metaKey) return;
      const point = this.world(event);
      const window = this.layout?.windows.find(w => w.max > 0 && point.x >= w.x - (w.zone === 'jump' ? 30 : 18) && point.x <= w.x + w.width + 28 &&
        point.y >= w.y - 24 && point.y <= w.y + w.height + 24);
      if (!window) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!this.enabled()) return;
      const amount = window.axis === 'x' && Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const factor = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? window.extent : 1;
      const previous = this.pending?.zone === window.zone ? this.pending.offset : window.offset;
      this.queue(window.zone, Math.max(0, Math.min(window.max, previous + amount * factor)));
    };
    interaction.addEventListener('wheel', this.wheel, {capture: true, passive: false});
    this.removeWheel = () => interaction.removeEventListener('wheel', this.wheel, true);
  }
  private removeWheel: () => void;
  private queue(zone: WindowZone, offset: number): void {
    this.pending = {zone, offset};
    if (!this.frame) this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0; const next = this.pending; this.pending = undefined;
      if (next && this.enabled()) this.change(next.zone, next.offset);
    });
  }
  update(layout: WindowLayout, project: (point: Point) => Point, scale: number, labels: boolean): void {
    this.layout = layout;
    for (const window of layout.windows) {
      const {range, label} = this.controls.get(window.zone)!;
      label.hidden = !labels || !window.max || !window.count || window.zone === 'parent';
      label.textContent = `${windowNames[window.zone]}  ${window.count}`;
      range.hidden = !window.max;
      range.max = String(window.max); range.value = String(window.offset);
      range.setAttribute('aria-valuetext', `${windowNames[window.zone]}共 ${window.count} 个，浏览位置 ${Math.round(window.offset / (window.max || 1) * 100)}%`);
      this.position(range, window, project, scale);
      const horizontal = window.axis === 'x';
      const center = project({x: horizontal ? window.x + window.width / 2 : window.zone === 'jump' ? window.x - 18 : window.x + window.width + 18,
        y: horizontal ? window.y + window.height : window.y + window.height / 2});
      Object.assign(label.style, {
        left: `${center.x + (horizontal ? 0 : window.zone === 'jump' ? -18 : 18)}px`,
        top: `${center.y + (horizontal ? 18 : 0)}px`,
        transform: horizontal ? 'translateX(-50%)' : window.zone === 'jump' ? 'translate(-100%, -50%)' : 'translateY(-50%)',
      });
    }
  }
  private position(range: HTMLInputElement, w: RelationWindow, project: (p: Point) => Point, scale: number): void {
    const horizontal = w.axis === 'x';
    const p = project({x: horizontal ? w.x : w.zone === 'jump' ? w.x - 18 : w.x + w.width + 18, y: horizontal ? w.y + w.height : w.y});
    range.classList.toggle('is-vertical', !horizontal);
    const length = w.extent * scale;
    Object.assign(range.style, {left: `${p.x - (horizontal ? 0 : 10)}px`, top: `${p.y - (horizontal ? 10 : 0)}px`,
      width: `${horizontal ? length : 20}px`, height: `${horizontal ? 20 : length}px`});
    range.style.setProperty('--brain-scroll-thumb', `${Math.max(24, length * w.extent / (w.max + w.extent))}px`);
  }
  cancel(): void {if (this.frame) this.win.cancelAnimationFrame(this.frame); this.frame = 0; this.pending = undefined;}
  destroy(): void {this.cancel(); this.removeWheel(); this.element.remove();}
}
