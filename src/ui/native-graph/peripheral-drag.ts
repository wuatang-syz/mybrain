import {type MindMapSettings} from '../../mind-map-settings';
import type {GraphNode, Point} from '../../model/types';
import {nodeSize} from '../canvas/node-size';
import {newGraphics, type Graphics, type NativeNode, type NativeRenderer} from './types';

interface DragHost {
  settings?(): MindMapSettings;
  renderer: NativeRenderer;
  core(): Map<string, GraphNode>;
  isNote(id: string): boolean;
  world(event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point;
  enabled(): boolean;
  hint(text: string): void;
  focus(): void;
  suppressClick(): void;
  click(id: string): void;
  moved(id: string): void;
  connect(source: string, target: string): void;
}
interface Gesture {
  node: NativeNode; pointer: number; start: Point; offset: Point;
  original: {x: number; y: number; fx: number | null; fy: number | null};
  moved: boolean; client: Point; target?: string; ready: boolean;
}

/** Drag an outer note normally, or dwell over another note to connect it. */
export class PeripheralDrag {
  private gesture?: Gesture;
  private timer = 0;
  private preview?: Graphics;
  private cleanups: (() => void)[] = [];
  private readonly win: Window;
  constructor(private readonly host: DragHost) {
    this.win = host.renderer.interactiveEl.ownerDocument.defaultView!;
    const listen = (target: EventTarget, type: string, callback: EventListener) => {
      target.addEventListener(type, callback, true);
      this.cleanups.push(() => target.removeEventListener(type, callback, true));
    };
    listen(host.renderer.interactiveEl, 'pointerdown', event => this.start(event as PointerEvent));
    listen(this.win, 'pointermove', event => this.move(event as PointerEvent));
    listen(this.win, 'pointerup', event => this.end(event as PointerEvent));
    listen(this.win, 'pointercancel', event => {if ((event as PointerEvent).pointerId === this.gesture?.pointer) this.cancel();});
    listen(this.win, 'blur', () => this.cancel());
    listen(this.win, 'keydown', event => {if ((event as KeyboardEvent).key === 'Escape') this.cancel();});
  }
  private hit(point: Point, node: NativeNode, padding = 0): boolean {
    if (node.circle?.visible === false || !this.host.isNote(node.id)) return false;
    const core = this.host.core().get(node.id);
    if (core) {
      const size = nodeSize(core, this.host.settings?.());
      return Math.abs(point.x - node.x) <= size.width / 2 + padding && Math.abs(point.y - node.y) <= size.height / 2 + padding;
    }
    return Math.hypot(point.x - node.x, point.y - node.y) <= node.getSize() * this.host.renderer.nodeScale + padding;
  }
  private start(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture || !this.host.enabled()) return;
    const point = this.host.world(event);
    // Let structural bodies keep their ordering gesture and leave the external ports alone.
    if ([...this.host.core().keys()].some(id => {
      const node = this.host.renderer.nodeLookup[id]; return node && this.hit(point, node);
    })) return;
    const node = this.host.renderer.nodes.find(node => !this.host.core().has(node.id) && this.hit(point, node));
    if (!node) return;
    this.gesture = {node, pointer: event.pointerId, start: {x: event.clientX, y: event.clientY},
      client: {x: event.clientX, y: event.clientY}, offset: {x: point.x - node.x, y: point.y - node.y},
      original: {x: node.x, y: node.y, fx: node.fx, fy: node.fy}, moved: false, ready: false};
    event.preventDefault(); event.stopImmediatePropagation(); this.host.focus();
  }
  private target(client: Point): NativeNode | undefined {
    const rect = this.host.renderer.interactiveEl.getBoundingClientRect();
    if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) return;
    const point = this.host.world({clientX: client.x, clientY: client.y});
    const padding = 8 * (this.win.devicePixelRatio || 1) / this.host.renderer.scale;
    return this.host.renderer.nodes.filter(node => node !== this.gesture?.node && this.hit(point, node, padding))
      .sort((a, b) => Math.hypot(point.x - a.x, point.y - a.y) - Math.hypot(point.x - b.x, point.y - b.y))[0];
  }
  private move(event: PointerEvent): void {
    const g = this.gesture; if (!g || event.pointerId !== g.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!g.moved && Math.hypot(event.clientX - g.start.x, event.clientY - g.start.y) < 6) return;
    g.moved = true; this.host.suppressClick();
    g.client = {x: event.clientX, y: event.clientY};
    const point = this.host.world(event);
    g.node.x = g.node.fx = point.x - g.offset.x; g.node.y = g.node.fy = point.y - g.offset.y;
    this.force(g.node);
    this.updateTarget();
    this.draw();
  }
  private updateTarget(): void {
    const g = this.gesture; if (!g) return;
    const target = this.target(g.client);
    if (g.target === target?.id) return;
    this.win.clearTimeout(this.timer); this.timer = 0;
    g.target = target?.id; g.ready = false; this.clearPreview();
    if (target) this.timer = this.win.setTimeout(() => {
      this.timer = 0;
      if (this.gesture !== g || this.target(g.client)?.id !== g.target || !this.host.enabled()) return;
      g.ready = true; this.draw();
    }, 300);
  }
  private draw(): void {
    const g = this.gesture; if (!g) return;
    this.host.hint(g.ready ? '松开连接 · Esc 取消' : g.target ? '停留片刻后松开连接 · Esc 取消' : '拖到节点上停留即可连接 · 拖到空白处移动');
    const target = g.target ? this.host.renderer.nodeLookup[g.target] : undefined;
    if (g.ready && target && g.node.circle && this.host.renderer.hanger) {
      if (!this.preview) {
        this.preview = newGraphics(g.node.circle); this.preview.eventMode = 'none'; this.preview.zIndex = 6;
        this.host.renderer.hanger.addChild(this.preview);
      }
      const line = this.preview.clear().lineStyle(2 / this.host.renderer.scale, 0x7560dd);
      line.moveTo(g.original.x, g.original.y).lineTo(target.x, target.y);
      const core = this.host.core().get(target.id);
      if (core) {
        const size = nodeSize(core, this.host.settings?.());
        line.drawRoundedRect(target.x - size.width / 2 - 4, target.y - size.height / 2 - 4, size.width + 8, size.height + 8, 9);
      } else line.drawCircle(target.x, target.y, target.getSize() * this.host.renderer.nodeScale + 6);
    }
    this.host.renderer.changed();
  }
  private end(event: PointerEvent): void {
    const g = this.gesture; if (!g || event.pointerId !== g.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!this.host.enabled()) {this.cancel(); return;}
    if (g.moved) this.move(event);
    g.client = {x: event.clientX, y: event.clientY};
    this.updateTarget();
    const target = g.ready ? g.target : undefined;
    this.reset();
    if (!g.moved) {this.host.click(g.node.id); return;}
    this.host.suppressClick();
    if (target) {
      Object.assign(g.node, g.original); this.force(g.node);
      this.host.connect(g.node.id, target);
    } else this.host.moved(g.node.id);
  }
  private force(node: NativeNode): void {
    this.host.renderer.worker.postMessage({forceNode: {id: node.id, x: node.fx, y: node.fy}, alpha: .3, run: true});
    this.host.renderer.changed();
  }
  private clearPreview(): void {
    this.preview?.parent?.removeChild(this.preview); this.preview?.destroy(); this.preview = undefined;
  }
  private reset(): void {
    this.win.clearTimeout(this.timer); this.timer = 0; this.gesture = undefined;
    this.clearPreview(); this.host.hint(''); this.host.renderer.changed();
  }
  cancel(): void {
    const g = this.gesture; if (!g) return;
    this.reset();
    if (g.moved) {Object.assign(g.node, g.original); this.force(g.node); this.host.suppressClick();}
  }
  destroy(): void {this.cancel(); for (const cleanup of this.cleanups) cleanup();}
}
