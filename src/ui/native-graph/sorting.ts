import {type MindMapSettings} from '../../mind-map-settings';
import type {GraphNode, Neighborhood, Point} from '../../model/types';
import {siblingParent} from '../canvas/groups';
import {nodeSize} from '../canvas/node-size';

export function orderedSnapshot(snapshot: Neighborhood, order: string[]): Neighborhood {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return {...snapshot, nodes: [...snapshot.nodes].sort((a, b) => (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length))};
}
export function sameSortGroup(snapshot: Neighborhood, a: GraphNode, b: GraphNode): boolean {
  return a.zone !== 'focus' && a.zone !== 'outer' && a.zone === b.zone &&
    (a.zone !== 'sibling' || siblingParent(snapshot, a) === siblingParent(snapshot, b));
}
export function moveInOrder(order: string[], source: string, target: string): string[] {
  const from = order.indexOf(source), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const result = [...order]; result.splice(from, 1); result.splice(to, 0, source); return result;
}

interface DragHost {
  settings?(): MindMapSettings;
  element: HTMLCanvasElement;
  snapshot(): Neighborhood | undefined;
  nodes(): Map<string, GraphNode>;
  positions(): Record<string, Point>;
  world(event: PointerEvent): Point;
  enabled(): boolean;
  draw(): void;
  hint(text: string): void;
  finish(id: string, target: string): void;
  suppressClick(): void;
  click(id: string): void;
  focus(): void;
  /** Open up the pending slot inside the dragged node's group and mark where it lands. */
  preview(id?: string, target?: string): void;
  /** Show the grabbed node as lifted while it is out of the layout. */
  lift(id?: string): void;
}

/** Body dragging reorders a relation group; connectors retain their relation-editing gesture. */
export class StructuralDrag {
  private gesture?: {id: string; pointer: number; start: Point; offset: Point; original: Record<string, Point>; moved: boolean; target?: string};
  private cleanups: (() => void)[] = [];
  constructor(private host: DragHost) {
    const win = host.element.ownerDocument.defaultView!;
    const listen = (target: EventTarget, type: string, callback: EventListener, capture = true) => {
      target.addEventListener(type, callback, capture);
      this.cleanups.push(() => target.removeEventListener(type, callback, capture));
    };
    listen(host.element, 'pointerdown', event => this.start(event as PointerEvent));
    listen(win, 'pointermove', event => this.move(event as PointerEvent));
    listen(win, 'pointerup', event => this.end(event as PointerEvent));
    listen(win, 'pointercancel', event => {if ((event as PointerEvent).pointerId === this.gesture?.pointer) this.cancel();});
    // Element blur does not bubble; only cancel when the window itself loses focus.
    listen(win, 'blur', () => this.cancel(), false);
    listen(win, 'keydown', event => {if ((event as KeyboardEvent).key === 'Escape') this.cancel();});
  }
  private start(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture || !this.host.enabled()) return;
    const point = this.host.world(event);
    for (const node of this.host.nodes().values()) {
      if (node.zone === 'outer') continue;
      const p = this.host.positions()[node.id]; if (!p) continue;
      const size = nodeSize(node, this.host.settings?.()), x = point.x - p.x, y = point.y - p.y;
      if (Math.abs(x) > size.width / 2 || Math.abs(y) > size.height / 2) continue;
      // Leave the four connector hit areas to PIXI.
      if (Math.hypot(x, Math.abs(y) - size.height / 2) < 14 || Math.hypot(Math.abs(x) - size.width / 2, y) < 14) return;
      this.gesture = {id: node.id, pointer: event.pointerId, start: {x: event.clientX, y: event.clientY},
        offset: {x, y}, original: structuredClone(this.host.positions()), moved: false};
      this.host.focus();
      // Prevent native force-dragging and canvas panning from competing with this gesture.
      event.stopImmediatePropagation(); event.preventDefault();
      return;
    }
  }
  private move(event: PointerEvent): void {
    const g = this.gesture; if (!g || g.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!this.host.enabled() || !this.host.nodes().has(g.id)) {this.cancel(); return;}
    if (!g.moved && Math.hypot(event.clientX - g.start.x, event.clientY - g.start.y) < 6) return;
    g.moved = true; this.host.suppressClick();
    const source = this.host.nodes().get(g.id)!, snapshot = this.host.snapshot();
    if (!snapshot) {this.cancel(); return;}
    if (source.zone === 'focus') {this.host.hint('中心节点不参与排序'); return;}
    const point = this.host.world(event);
    g.target = undefined;
    let nearest = Infinity;
    for (const node of this.host.nodes().values()) {
      if (node.id === g.id || !sameSortGroup(snapshot, source, node)) continue;
      const p = g.original[node.id]; if (!p) continue;
      const size = nodeSize(node, this.host.settings?.()), dx = Math.abs(point.x - p.x), dy = Math.abs(point.y - p.y);
      if (dx > size.width / 2 + 32 || dy > size.height / 2 + 24) continue;
      const distance = Math.hypot(dx, dy);
      if (distance < nearest) {nearest = distance; g.target = node.id;}
    }
    this.host.lift(g.id);
    this.host.preview(g.id, g.target);
    this.host.positions()[g.id] = {x: point.x - g.offset.x, y: point.y - g.offset.y};
    this.host.hint(g.target ? `松手后移到「${this.host.nodes().get(g.target)!.title}」的位置 · Esc 取消` : '拖到同组节点的位置调整顺序 · Esc 取消');
    this.host.draw();
  }
  private end(event: PointerEvent): void {
    const g = this.gesture; if (!g || g.pointer !== event.pointerId) return;
    this.move(event);
    if (!this.gesture) return;
    this.restore();
    if (!g.moved) this.host.click(g.id);
    else if (g.target) this.host.finish(g.id, g.target);
  }
  private restore(): void {
    const g = this.gesture; if (!g) return;
    Object.assign(this.host.positions(), g.original); this.gesture = undefined;
    this.host.preview(); this.host.lift();
    this.host.hint(''); this.host.draw();
  }
  cancel(): void {if (this.gesture?.moved) this.host.suppressClick(); this.restore();}
  active(): boolean {return !!this.gesture;}
  savedPositions(): Record<string, Point> | undefined {return this.gesture?.original;}
  destroy(): void {this.cancel(); for (const cleanup of this.cleanups) cleanup();}
}
