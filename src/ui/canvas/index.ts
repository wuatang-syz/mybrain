import type { CanvasCallbacks, GraphNode, LayoutState, Neighborhood, Point, RelationKind, Viewport } from '../../model/types';
import { computeLayout, nodeSize, type GroupToggle } from './layout';
import { foldGroups } from './groups';
import { portKinds, portPoint, portRequest, readPort, type Port, type PortSide } from './ports';
import { Scene } from './scene';

interface Gesture { type: 'node' | 'connect' | 'pan'; id?: string; side?: PortSide; pointerId: number; start: Point; original: Point; active: boolean }
const pointOf = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });
const CREATE_DISTANCE = 64;

export function createPreview(sourceTitle: string, kind: RelationKind | 'sibling'): string {
  return {
    parent: `创建新笔记，设为「${sourceTitle}」的父级`,
    child: `创建新笔记，设为「${sourceTitle}」的子级`,
    jump: `创建新笔记，与「${sourceTitle}」建立跳转关联`,
    sibling: `创建新笔记，与「${sourceTitle}」归入同一父级`,
  }[kind];
}

const eventElement = (event: Event): Element | null => {
  const target = event.target as Node | null;
  return target?.nodeType === 1 ? target as Element : target?.parentElement ?? null;
};

/** Browser-only view. File mutations and dialogs belong to the Obsidian integration. */
export class GraphCanvas {
  readonly element: HTMLDivElement;
  private readonly scene: Scene;
  private readonly hint: HTMLDivElement;
  private readonly overflow: HTMLButtonElement;
  private readonly win: Window;
  private readonly cleanups: (() => void)[] = [];
  private snapshot?: Neighborhood;
  private nodes = new Map<string, GraphNode>();
  private positions: Record<string, Point> = {};
  private remembered: Record<string, Point> = {};
  private pinned = new Set<string>();
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private gesture?: Gesture;
  private keyboardSource?: string;
  private selectedId?: string;
  private expandedGroups = new Set<string>();
  private groupToggles: GroupToggle[] = [];
  private frame = 0;
  private ignoreClickUntil = 0;
  private observer?: ResizeObserver;
  private destroyed = false;
  private pending?: { snapshot: Neighborhood; state?: LayoutState };
  private pendingTimer = 0;
  private clickTimer = 0;
  private clickId?: string;
  private readonly zoomValue: HTMLButtonElement;

  constructor(container: HTMLElement, private readonly callbacks: CanvasCallbacks) {
    const doc = container.ownerDocument;
    this.win = doc.defaultView ?? window;
    this.element = doc.createElement('div');
    this.element.className = 'brain-canvas';
    this.element.tabIndex = 0;
    this.element.setAttribute('aria-description', '知识关系画布。拖动或依次选择两个圆圈建立连接，单击外围圆点打开笔记，单击体系节点切换中心。');
    this.scene = new Scene(this.element);
    this.hint = doc.createElement('div');
    this.hint.className = 'brain-canvas-hint';
    this.hint.setAttribute('role', 'status');
    this.hint.setAttribute('aria-live', 'polite');
    this.overflow = doc.createElement('button');
    this.overflow.type = 'button';
    this.overflow.className = 'brain-overflow brain-button';
    this.overflow.hidden = true;
    this.element.append(this.hint, this.overflow);
    const zoom = doc.createElement('div');
    zoom.className = 'brain-zoom';
    zoom.setAttribute('aria-label', '画布缩放');
    const control = (label: string, icon: string | undefined, run: () => void) => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'brain-button';
      button.title = label; button.setAttribute('aria-label', label);
      if (icon) this.callbacks.renderIcon?.(button, icon); else button.textContent = label;
      this.listen(button, 'click', run); zoom.append(button); return button;
    };
    control('缩小', 'minus', () => this.zoomBy(1 / 1.2));
    this.zoomValue = control('100%', undefined, () => this.setZoom(1));
    this.zoomValue.setAttribute('aria-label', '重置为 100%');
    control('放大', 'plus', () => this.zoomBy(1.2));
    control('适应画布', undefined, () => this.fit());
    this.element.append(zoom);
    container.append(this.element);
    this.listen(this.element, 'pointerdown', event => this.pointerDown(event as PointerEvent));
    this.listen(this.win, 'pointermove', event => this.pointerMove(event as PointerEvent));
    this.listen(this.win, 'pointerup', event => this.pointerUp(event as PointerEvent));
    this.listen(this.win, 'pointercancel', () => this.cancel());
    this.listen(this.win, 'blur', () => this.cancel());
    this.listen(this.element, 'click', event => this.click(event as MouseEvent));
    this.listen(this.element, 'dblclick', event => this.doubleClick(event as MouseEvent));
    this.listen(this.element, 'contextmenu', event => this.context(event as MouseEvent));
    this.listen(this.win, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (this.element.contains(eventElement(event)) || (key.key === 'Escape' && (this.gesture || this.keyboardSource))) this.keydown(key);
    });
    this.listen(this.element, 'wheel', event => this.wheel(event as WheelEvent), { passive: false });
    this.listen(this.element, 'pointerover', event => {
      if (!this.gesture) this.scene.highlight(eventElement(event)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId);
    });
    this.listen(this.element, 'pointerleave', () => { if (!this.gesture) this.scene.highlight(); });
    this.listen(this.overflow, 'click', () => this.callbacks.onOverflow(this.snapshot?.overflow ?? []));
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.transform());
      this.observer.observe(this.element);
    }
  }

  render(snapshot: Neighborhood, state?: LayoutState): void {
    if (this.destroyed) return;
    // Metadata events can arrive while the pointer is down. Keep the exact DOM and
    // coordinates the user grabbed, then apply the most recent snapshot on release.
    if (this.gesture || this.keyboardSource || this.clickId) { this.pending = { snapshot, state }; return; }
    this.pending = undefined;
    this.stopAnimation();
    const initial = !this.snapshot;
    const changed = this.snapshot?.focus !== snapshot.focus;
    const rootChanged = !initial && this.snapshot?.root !== snapshot.root;
    if (rootChanged) { this.remembered = {}; this.pinned.clear(); }
    if (changed) { this.remembered = {}; this.pinned.clear(); this.selectedId = undefined; this.expandedGroups.clear(); }
    if (state) {
      this.remembered = { ...this.remembered, ...state.positions };
      this.pinned = new Set(state.pinned);
      if (state.viewport) this.viewport = { ...state.viewport };
    } else if (changed) {
      this.pinned.clear();
    }
    const previous = { ...this.positions };
    this.snapshot = snapshot;
    this.element.classList.toggle('has-global-root', Boolean(snapshot.root));
    const folded = foldGroups(snapshot, this.expandedGroups);
    this.nodes = new Map(folded.snapshot.nodes.map(node => [node.id, node]));
    const layout = computeLayout(folded.snapshot, { positions: this.remembered, pinned: [...this.pinned] }, folded.groups);
    this.groupToggles = layout.toggles;
    this.positions = layout.positions;
    this.remembered = { ...this.remembered, ...layout.positions };
    this.scene.render(folded.snapshot, layout.labels, layout.toggles);
    this.select(this.selectedId, false);
    this.overflow.hidden = !snapshot.overflow.length;
    this.overflow.textContent = `查看其余 ${snapshot.overflow.length} 个节点`;
    if (rootChanged || (changed && !state?.viewport)) this.fit(false, snapshot.root ? 'all' : 'core');
    else this.transform();
    const reduced = this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!initial && !reduced) this.animate(previous, layout.positions);
    else this.scene.position(this.positions);
    this.emitLayout();
  }

  getLayout(): LayoutState {
    return { positions: structuredClone({ ...this.remembered, ...this.positions }), pinned: [...this.pinned], viewport: { ...this.viewport } };
  }

  getFocus(): string | undefined { return this.snapshot?.focus; }

  select(id?: string, reveal = true): void {
    this.selectedId = id;
    for (const [nodeId, element] of this.scene.nodes) element.classList.toggle('is-selected', nodeId === id);
    if (!reveal || !id || !this.positions[id]) return;
    this.stopAnimation();
    this.scene.position(this.positions);
    const {width, height} = this.element.getBoundingClientRect();
    const point = this.positions[id]!;
    const x = point.x * this.viewport.scale + width / 2 + this.viewport.x;
    const y = point.y * this.viewport.scale + height / 2 + this.viewport.y;
    this.viewport.x += Math.max(80, Math.min(width - 80, x)) - x;
    this.viewport.y += Math.max(80, Math.min(height - 80, y)) - y;
    this.transform();
    this.emitLayout();
  }

  fit(persist = true, scope: 'core' | 'all' = 'all'): void {
    const bounds = [...this.nodes.values()].filter(node => scope === 'all' || node.zone !== 'outer').map(node => ({ ...this.positions[node.id]!, ...nodeSize(node) }));
    bounds.push(...this.groupToggles.map(toggle => ({...toggle, width: 188, height: 36})));
    if (!bounds.length) return;
    const minX = Math.min(...bounds.map(point => point.x - point.width / 2)) - 72;
    const maxX = Math.max(...bounds.map(point => point.x + point.width / 2)) + 72;
    const minY = Math.min(-250, ...bounds.map(point => point.y - point.height / 2)) - 72;
    const maxY = Math.max(250, ...bounds.map(point => point.y + point.height / 2)) + 100;
    const { width, height } = this.size();
    const scale = Math.max(scope === 'core' ? .75 : .15, Math.min(1, width / (maxX - minX), height / (maxY - minY)));
    this.viewport = scope === 'core' ? { x: 0, y: 0, scale } : { x: -(minX + maxX) / 2 * scale, y: -(minY + maxY) / 2 * scale, scale };
    this.transform();
    if (persist) this.emitLayout();
  }

  destroy(): void {
    this.destroyed = true;
    this.pending = undefined;
    this.win.clearTimeout(this.pendingTimer);
    this.clearClick();
    this.cancel();
    this.stopAnimation();
    this.observer?.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    this.element.remove();
  }

  private listen(target: EventTarget, type: string, callback: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, callback, options);
    this.cleanups.push(() => target.removeEventListener(type, callback, options));
  }
  private size(): { width: number; height: number } {
    const rect = this.element.getBoundingClientRect();
    return { width: rect.width || this.element.clientWidth || 1000, height: rect.height || this.element.clientHeight || 700 };
  }
  private worldPoint(point: Point): Point {
    const rect = this.element.getBoundingClientRect();
    const { width, height } = this.size();
    return { x: (point.x - rect.left - width / 2 - this.viewport.x) / this.viewport.scale, y: (point.y - rect.top - height / 2 - this.viewport.y) / this.viewport.scale };
  }
  private transform(): void {
    const { width, height } = this.size();
    this.scene.world.style.transform = `translate(${width / 2 + this.viewport.x}px, ${height / 2 + this.viewport.y}px) scale(${this.viewport.scale})`;
    this.zoomValue.textContent = `${Math.round(this.viewport.scale * 100)}%`;
    this.element.style.setProperty('--brain-readable-scale', String(Math.min(1.7, 1 / this.viewport.scale)));
  }
  zoomBy(factor: number): void { this.setZoom(this.viewport.scale * factor); }
  setZoom(scale: number, anchor: Point = { x: -this.viewport.x / this.viewport.scale, y: -this.viewport.y / this.viewport.scale }): void {
    if (this.gesture || !Number.isFinite(scale)) return;
    this.stopAnimation();
    const previous = this.viewport.scale;
    this.viewport.scale = Math.max(.15, Math.min(3, scale));
    this.viewport.x += anchor.x * (previous - this.viewport.scale);
    this.viewport.y += anchor.y * (previous - this.viewport.scale);
    this.transform(); this.emitLayout();
  }
  private emitLayout(): void { if (!this.destroyed) this.callbacks.onLayout(this.getLayout()); }
  private stopAnimation(): void { if (this.frame) this.win.cancelAnimationFrame(this.frame); this.frame = 0; }
  private animate(previous: Record<string, Point>, next: Record<string, Point>): void {
    const start = this.win.performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 320);
      const eased = 1 - Math.pow(1 - progress, 3);
      const intermediate: Record<string, Point> = {};
      for (const [id, target] of Object.entries(next)) {
        const from = previous[id] ?? target;
        intermediate[id] = { x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased };
      }
      this.positions = intermediate;
      this.scene.position(intermediate);
      if (progress < 1) this.frame = this.win.requestAnimationFrame(tick);
      else { this.frame = 0; this.positions = next; }
    };
    // New DOM needs its start positions before the first animation frame.
    this.positions = Object.fromEntries(Object.entries(next).map(([id, point]) => [id, previous[id] ?? point]));
    this.scene.position(this.positions);
    this.frame = this.win.requestAnimationFrame(tick);
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.snapshot || this.gesture) return;
    const element = eventElement(event);
    if (element?.closest('.brain-overflow, .brain-zoom, .brain-group-toggle')) return;
    const node = element?.closest<HTMLElement>('[data-node-id]');
    const id = node?.dataset.nodeId;
    const action = element?.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'open') return;
    if (id && this.positions[id]) {
      if (this.keyboardSource) return;
      const type = action === 'connect' ? 'connect' : 'node';
      this.gesture = { type, id, side: readPort(element ?? null)?.side ?? (action === 'connect' ? 'right' : undefined), pointerId: event.pointerId, start: pointOf(event), original: { ...this.positions[id] }, active: false };
    } else {
      this.gesture = { type: 'pan', pointerId: event.pointerId, start: pointOf(event), original: { x: this.viewport.x, y: this.viewport.y }, active: false };
    }
    this.stopAnimation();
  }

  private pointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId || !this.snapshot) return;
    const delta = { x: event.clientX - gesture.start.x, y: event.clientY - gesture.start.y };
    if (!gesture.active && Math.hypot(delta.x, delta.y) < 6) return;
    if (!gesture.active) {
      this.clearClick();
      gesture.active = true;
      this.stopAnimation();
      this.element.classList.add('is-dragging');
      this.element.classList.toggle('is-dragging-outer', gesture.type === 'node' && this.nodes.get(gesture.id!)?.zone === 'outer');
      if (gesture.id) this.scene.nodes.get(gesture.id)?.classList.add(gesture.type === 'connect' ? 'is-connection-source' : 'is-dragged');
      this.element.classList.toggle('is-connecting', gesture.type === 'connect');
    }
    event.preventDefault();
    if (gesture.type === 'pan') {
      this.viewport.x = gesture.original.x + delta.x;
      this.viewport.y = gesture.original.y + delta.y;
      this.transform();
      return;
    }
    const point = this.worldPoint(pointOf(event));
    if (gesture.type === 'connect') {
      const target = this.portAt(event);
      const request = portRequest(gesture.id!, target, this.nodes);
      for (const gate of this.element.querySelectorAll('.is-port-target')) gate.classList.remove('is-port-target');
      if (request && target) this.scene.nodes.get(target.id)?.querySelector(`[data-port="${target.side}"]`)?.classList.add('is-port-target');
      this.scene.connect(this.connectionPoint({id: gesture.id!, side: gesture.side!}),
        request && target ? this.connectionPoint(target) : point,
        gesture.side, request ? target?.side : undefined);
      this.hint.textContent = request ? `「${this.nodes.get(request.target)?.title}」 → 「${this.nodes.get(request.focus)?.title}」 · ${{parent: '父级', child: '子级', jump: '跳转关联', sibling: '同级'}[request.kind]}` : '';
      const create = this.portCreation(gesture, event);
      if (!request && create) this.hint.textContent = createPreview(this.nodes.get(create.source)!.title, create.kind);
      return;
    }
    this.positions[gesture.id!] = { x: gesture.original.x + delta.x / this.viewport.scale, y: gesture.original.y + delta.y / this.viewport.scale };
    this.scene.position(this.positions);
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active) {
      this.gesture = undefined;
      // Preserve the click target until the browser dispatches its following click.
      this.pendingTimer = this.win.setTimeout(() => { if (!this.gesture && !this.keyboardSource && !this.clickId) this.flushPending(); }, 0);
      return;
    }
    this.ignoreClickUntil = Date.now() + 120;
    this.pointerMove(event);
    const request = gesture.type === 'connect' ? portRequest(gesture.id!, this.portAt(event), this.nodes) : undefined;
    if (gesture.type === 'node' && gesture.id) {
      if (this.nodes.get(gesture.id)?.zone !== 'outer') this.positions[gesture.id] = gesture.original;
      else {this.pinned.add(gesture.id); this.remembered[gesture.id] = {...this.positions[gesture.id]!};}
      this.scene.position(this.positions);
    }
    const create = request ? undefined : this.portCreation(gesture, event);
    this.finishGesture();
    if (create) this.callbacks.onCreate(create.source, create.kind, create.point);
    if (request) this.callbacks.onDrop(request);
    this.emitLayout();
    this.flushPending();
  }

  private finishGesture(): void {
    this.gesture = undefined;
    this.keyboardSource = undefined;
    this.element.classList.remove('is-dragging', 'is-dragging-outer', 'is-connecting');
    for (const element of this.scene.nodes.values()) element.classList.remove('is-dragged', 'is-connection-source');
    this.scene.connect();
    for (const gate of this.element.querySelectorAll('.is-port-target')) gate.classList.remove('is-port-target');
    this.hint.textContent = '';
  }
  private portAt(event: MouseEvent) {
    const doc = this.element.ownerDocument;
    const element = doc.elementFromPoint ? doc.elementFromPoint(event.clientX, event.clientY) : eventElement(event);
    return element && this.element.contains(element) ? readPort(element) : undefined;
  }
  private portCreation(gesture: Gesture, event: MouseEvent): { source: string; kind: RelationKind | 'sibling'; point: Point } | undefined {
    if (gesture.type !== 'connect' || !gesture.id || !gesture.side || this.nodes.get(gesture.id)?.zone === 'outer') return;
    const doc = this.element.ownerDocument;
    const target = doc.elementFromPoint ? doc.elementFromPoint(event.clientX, event.clientY) : eventElement(event);
    if (!target || !this.element.contains(target) || target.closest('[data-node-id], .brain-zoom, .brain-overflow, .brain-group-toggle')) return;
    const distance = Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) / this.viewport.scale;
    if (distance < CREATE_DISTANCE) return;
    return { source: gesture.id, kind: portKinds[gesture.side], point: pointOf(event) };
  }
  private connectionPoint(port: Port): Point {
    // DOM coordinates include the paused floating offset and the canvas zoom.
    const rect = this.scene.nodes.get(port.id)?.querySelector(`[data-port="${port.side}"]`)?.getBoundingClientRect();
    if (rect?.width) return this.worldPoint({x: rect.left + rect.width / 2, y: rect.top + rect.height / 2});
    return portPoint(this.nodes.get(port.id)!, this.positions[port.id]!, port.side);
  }
  private cancel(): void {
    this.clearClick();
    if (this.gesture?.active) {
      if (this.gesture.type === 'node' && this.gesture.id) this.positions[this.gesture.id] = this.gesture.original;
      if (this.gesture.type === 'pan') { this.viewport.x = this.gesture.original.x; this.viewport.y = this.gesture.original.y; this.transform(); }
      this.scene.position(this.positions);
      this.ignoreClickUntil = Date.now() + 120;
    }
    this.finishGesture();
    this.flushPending();
  }

  private flushPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending && !this.destroyed) {
      // A same-focus refresh captured while dragging must not overwrite the final
      // pin/pan state with its in-progress copy.
      const state = pending.snapshot.focus === this.snapshot?.focus ? this.getLayout() : pending.state;
      this.render(pending.snapshot, state);
    }
  }

  private click(event: MouseEvent): void {
    if (Date.now() < this.ignoreClickUntil) { event.preventDefault(); return; }
    const target = eventElement(event);
    const toggle = target?.closest<HTMLElement>('[data-group-key]');
    if (toggle && this.snapshot && !this.gesture && !this.keyboardSource) {
      const key = toggle.dataset.groupKey!;
      if (this.expandedGroups.has(key)) this.expandedGroups.delete(key);
      else this.expandedGroups.add(key);
      this.clearClick();
      this.render(this.snapshot, this.getLayout());
      this.scene.world.querySelectorAll<HTMLButtonElement>('[data-group-key]').forEach(button => {
        if (button.dataset.groupKey === key) button.focus({preventScroll: true});
      });
      return;
    }
    const id = target?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    const action = target?.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!id) return;
    if (this.keyboardSource) {
      const request = portRequest(this.keyboardSource, readPort(target), this.nodes);
      if (!request) return;
      this.finishGesture();
      this.callbacks.onDrop(request);
      this.flushPending();
    } else if (action === 'open' || action === 'open-note') {
      this.clearClick();
      if (event.detail < 2) this.callbacks.onOpen(id);
      this.flushPending();
    }
    else if (action === 'connect') {
      this.clearClick();
      this.stopAnimation();
      this.keyboardSource = id;
      this.element.classList.add('is-connecting');
      this.scene.nodes.get(id)?.classList.add('is-connection-source');
      this.hint.textContent = `连接起点：${this.nodes.get(id)?.title}`;
    } else if (action === 'focus') {
      this.clearClick();
      if (event.detail === 0) { this.callbacks.onFocus(id); this.flushPending(); }
      else {
        this.clickId = id;
        this.clickTimer = this.win.setTimeout(() => {
          this.clearClick(); this.flushPending();
          if (!this.destroyed && this.nodes.has(id)) this.callbacks.onFocus(id);
        }, 250);
      }
    }
  }

  private clearClick(): void { this.win.clearTimeout(this.clickTimer); this.clickTimer = 0; this.clickId = undefined; }
  private doubleClick(event: MouseEvent): void {
    if (Date.now() < this.ignoreClickUntil || this.gesture || this.keyboardSource) return;
    const target = eventElement(event);
    if (target && !target.closest('[data-node-id], .brain-zoom, .brain-overflow, button, input, .brain-edge')) {
      event.preventDefault();
      this.clearClick(); this.flushPending();
      this.callbacks.onNewNote();
      return;
    }
    if (target?.closest<HTMLElement>('[data-action]')?.dataset.action !== 'focus') return;
    const id = this.clickId ?? target?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    this.clearClick(); this.flushPending();
    if (id && this.nodes.has(id)) { event.preventDefault(); (this.callbacks.onEdit ?? this.callbacks.onOpen)(id); }
  }

  private context(event: MouseEvent): void {
    this.clearClick();
    const target = eventElement(event);
    const edge = target?.closest<SVGElement>('.brain-edge');
    if (edge?.dataset.source && edge.dataset.target) {
      const record = this.snapshot?.edges.find(item => item.source === edge.dataset.source && item.target === edge.dataset.target && item.kind === edge.dataset.kind);
      if (record) { event.preventDefault(); this.callbacks.onEdgeContext?.(record, event); }
      return;
    }
    const id = target?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    if (id) { event.preventDefault(); this.callbacks.onContext(id, event); }
  }
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.cancel(); event.preventDefault(); return; }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const node = eventElement(event)?.closest<HTMLElement>('[data-node-id]');
      if (node?.dataset.nodeId) {
        event.preventDefault();
        const rect = node.getBoundingClientRect();
        const context = this.element.ownerDocument.createEvent('MouseEvent');
        context.initMouseEvent('contextmenu', true, true, this.win, 0, 0, 0, rect.left + rect.width / 2, rect.bottom, false, false, false, false, 2, null);
        this.callbacks.onContext(node.dataset.nodeId, context);
      }
    }
    if (event.target === this.element && event.key.toLowerCase() === 'f') this.fit();
  }
  private wheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.gesture) return;
    const point = this.worldPoint(pointOf(event));
    this.setZoom(this.viewport.scale * Math.exp(-event.deltaY * .0015), point);
  }
}
