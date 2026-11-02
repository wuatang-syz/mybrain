import type {App, WorkspaceLeaf} from 'obsidian';
import {
  mapDrawable, mapLayout, type MapDrawable, type MapLayout, type MapSnapshot,
} from '../../graph/knowledge-map';
import type {GraphAccess, MapLayoutState, NoteId, Point} from '../../model/types';
import {assertNativeView, type NativeData, type NativeNode, type NativeRegistry, type NativeRenderer, type NativeView} from '../native-graph/types';
import {stabilizeResize} from '../native-graph/resize';
import {cardChrome, mapPaintIndex, paintNode, semanticLevel, takePaintError, toScreen, zoomRatio, type MapPaintHost} from './paint';

export interface MapCallbacks {
  select(id: string): void;
  edit(id: string): void;
  context(id: string, event: MouseEvent): void;
  /** Drill one level into the card topic. */
  enter(id: string): void;
  save(state: MapLayoutState): void;
  /** Expansion changed the drawn set, so hosts can refresh counts. */
  onExpanded?(): void;
  /** A painting failure, reported once instead of blanking the canvas silently. */
  error?(message: string): void;
  /** Current canvas zoom, consumed by the shared footer readout. */
  onZoom?(percent: number): void;
}
export interface MapCanvasOptions {budget?: number}

type Hit =
  | {kind: 'node'; id: NoteId}
  | {kind: 'enter'; id: NoteId}
  | {kind: 'expand'; id: NoteId}
  | {kind: 'card'; id: NoteId};
interface Drag {
  kind: 'node' | 'card' | 'enter' | 'expand';
  id: NoteId;
  pointer: number;
  start: Point;
  origin: Point;
  had: boolean;
  moved: boolean;
}

/**
 * The knowledge map canvas: one native PIXI surface draws card frames, chrome, edges and nodes,
 * and every gesture is resolved in screen space so hit targets stay usable at any zoom.
 */
export class KnowledgeMapCanvas {
  readonly element: HTMLElement;
  readonly renderer: NativeRenderer;
  snapshot?: MapSnapshot;
  drawable?: MapDrawable;
  layout?: MapLayout;
  selected?: string;
  readonly expanded = new Set<NoteId>();
  private readonly native: NativeView;
  private readonly host: MapPaintHost;
  private readonly cleanups: (() => void)[] = [];
  private readonly decorations = new Map<NativeNode, () => void>();
  private readonly setData: NativeRenderer['setData'];
  private base?: NativeData;
  private state: MapLayoutState = {version: 2, nodes: {}, cards: {}};
  private budget: number;
  private disposed = false;
  private frame = 0;
  private saveTimer = 0;
  private restored = false;
  private applied = '';
  private aspect = 0;
  private drag?: Drag;
  private lastClick = {id: '', time: 0};

  constructor(
    private readonly container: HTMLElement,
    app: App,
    leaf: WorkspaceLeaf,
    private readonly callbacks: MapCallbacks,
    private readonly graph: GraphAccess,
    options: MapCanvasOptions = {},
  ) {
    this.budget = options.budget ?? 200;
    const factory = (app as App & NativeRegistry).viewRegistry?.viewByType?.graph;
    if (!factory) throw new Error('请启用 Obsidian 的关系图谱核心插件。');
    this.native = factory(leaf);
    try {assertNativeView(this.native);} catch (error) {this.native.unload(); throw error;}
    const r = this.renderer = this.native.renderer;
    this.element = this.native.containerEl; this.element.addClass('brain-native-graph', 'brain-map-native');
    this.native.contentEl.addClass('graph-view', 'brain-native-content'); this.native.headerEl.hide();
    container.append(this.element); container.addClass('brain-map-stage');
    this.host = {renderer: r, nodes: new Map(), cards: new Map(), incoming: new Map(), jumps: new Map()};
    this.setData = r.setData;
    const changed = r.changed, context = r.onNodeRightClick, click = r.onNodeClick;
    r.setData = data => {this.base = data; this.refresh();};
    r.changed = () => {changed.call(r); this.schedule(); this.callbacks.onZoom?.(this.zoomPercent());};
    // Clicks are resolved from our own pointer pipeline so drag and click never race.
    r.onNodeClick = () => {};
    r.onNodeRightClick = (event, id) => callbacks.context(id, event);
    this.cleanups.push(() => {r.setData = this.setData; r.changed = changed; r.onNodeClick = click; r.onNodeRightClick = context;});
    this.cleanups.push(stabilizeResize(r));
    const listen = (target: EventTarget, name: string, fn: EventListener, capture = false) => {
      target.addEventListener(name, fn, capture); this.cleanups.push(() => target.removeEventListener(name, fn, capture));
    };
    listen(r.interactiveEl, 'pointerdown', e => this.start(e as PointerEvent), true);
    listen(r.interactiveEl, 'pointerleave', () => this.clearHover());
    listen(container.win, 'pointermove', e => this.move(e as PointerEvent), true);
    listen(container.win, 'pointerup', e => this.end(e as PointerEvent), true);
    listen(container.win, 'pointercancel', () => this.cancel(), true);
    listen(container.win, 'blur', () => this.cancel());
    listen(container.win, 'keydown', e => {if ((e as KeyboardEvent).key === 'Escape') this.cancel();});
    const observer = new ResizeObserver(() => {
      r.onResize();
      if (!this.snapshot || r.width <= 0 || r.height <= 0) return;
      const aspect = r.width / Math.max(1, r.height);
      // Layout follows the new canvas shape, but the viewport is left where the user put it.
      if (Math.abs(aspect - this.aspect) > .02) {this.aspect = aspect; this.refresh();}
      else this.schedule();
    });
    observer.observe(container); this.cleanups.push(() => observer.disconnect());
    try {this.native.load(); r.onResize();} catch (error) {this.destroy(); throw error;}
  }
  render(snapshot: MapSnapshot, selected: string | undefined, state?: MapLayoutState): void {
    if (this.disposed) return;
    // Card offsets and node positions are owned by this canvas between saves, so an incoming copy
    // is merged instead of replacing newer in-memory drag results.
    if (state) {
      const incoming = structuredClone(state);
      this.state = {
        version: 2,
        nodes: {...incoming.nodes, ...this.state.nodes},
        cards: {...incoming.cards, ...this.state.cards},
        ...(incoming.viewport ?? this.state.viewport ? {viewport: incoming.viewport ?? this.state.viewport} : {}),
      };
    }
    // A new level starts collapsed; the previous level's expansion must not leak into it.
    if (this.snapshot && this.snapshot.attention !== snapshot.attention) this.expanded.clear();
    this.snapshot = snapshot; this.selected = selected;
    this.refresh();
    if (!this.restored && this.renderer.width > 0 && this.layerSize()) {
      this.restored = true;
      const viewport = this.state.viewport, r = this.renderer, dpr = this.dpr();
      if (viewport) {
        r.setScale(viewport.scale * dpr); r.zoomTo(viewport.scale * dpr);
        r.setPan((r.width / 2 + viewport.x) * dpr, (r.height / 2 + viewport.y) * dpr);
      } else this.fit(true);
      this.schedule();
    }
  }
  private layerSize(): number {return this.renderer.nodes.length;}
  private refresh(): void {
    if (this.disposed || !this.snapshot || !this.base) return;
    this.drawable = mapDrawable(this.snapshot, {expanded: this.expanded, budget: this.budget, selected: this.selected});
    this.layout = mapLayout(this.snapshot, this.drawable, this.state, this.aspectRatio());
    this.host.snapshot = this.snapshot; this.host.drawable = this.drawable; this.host.layout = this.layout;
    this.host.nodes = new Map(this.layout.nodes.map(node => [node.id, node]));
    this.host.cards = new Map(this.layout.cards.map(card => [card.id, card]));
    const index = mapPaintIndex(this.snapshot, this.host.nodes);
    this.host.incoming = index.incoming; this.host.jumps = index.jumps;
    this.host.selected = this.selected ?? null;
    this.pushData();
    this.schedule();
  }
  private aspectRatio(): number {return this.renderer.width / Math.max(1, this.renderer.height);}
  private pushData(): void {
    if (!this.base || !this.snapshot || this.disposed) return;
    const key = this.drawable?.drawn.join('|') ?? '';
    if (key !== this.applied) {
      this.applied = key;
      const nodes: NativeData['nodes'] = {};
      for (const id of this.drawable?.drawn ?? []) {
        const source = this.base.nodes[id];
        if (source) nodes[id] = {...source, links: {}};
      }
      // The native search result stays an upper bound; curves come from our card layout.
      this.setData.call(this.renderer, {...this.base, nodes});
      const live = new Set(this.renderer.nodes);
      for (const [node, cleanup] of this.decorations) if (!live.has(node)) {cleanup(); this.decorations.delete(node);}
      for (const node of live) if (!this.decorations.has(node)) this.decorations.set(node, paintNode(this.host, node));
    }
    this.pin();
    this.renderer.changed();
  }
  private pin(): void {
    for (const node of this.renderer.nodes) {
      const box = this.host.nodes.get(node.id); if (!box) continue;
      node.x = node.fx = box.x; node.y = node.fy = box.y;
      this.renderer.worker.postMessage({forceNode: {id: node.id, x: box.x, y: box.y}});
    }
  }
  private dpr(): number {return this.container.win.devicePixelRatio || 1;}
  private screen(e: PointerEvent): Point {
    const rect = this.renderer.interactiveEl.getBoundingClientRect();
    return {x: e.clientX - rect.left, y: e.clientY - rect.top};
  }
  /** Screen-space hit test: Card chrome keeps a constant pixel size, so targets never shrink. */
  private hitTest(point: Point): Hit | null {
    const {renderer: r, layout} = this;
    if (!layout) return null;
    const scale = zoomRatio(r);
    const nearest = (value: number) => value * scale;
    const level = semanticLevel(r);
    for (const node of [...layout.nodes].reverse()) {
      const at = toScreen(r, node);
      if (node.role === 'deep') {
        if (Math.hypot(point.x - at.x, point.y - at.y) <= 13) return {kind: 'node', id: node.id};
        continue;
      }
      const halfW = Math.max(node.width / 2 * scale, 16), halfH = Math.max(node.height / 2 * scale, 12);
      if (Math.abs(point.x - at.x) <= halfW && Math.abs(point.y - at.y) <= halfH) return {kind: 'node', id: node.id};
    }
    for (const card of layout.cards) {
      const chrome = cardChrome(r, card, level !== 'far');
      if (chrome.enter) {
        const at = toScreen(r, {x: chrome.enter.x, y: chrome.enter.y});
        if (Math.hypot(point.x - at.x, point.y - at.y) <= nearest(chrome.enter.r) + 3) return {kind: 'enter', id: card.id};
      }
      if (chrome.expand) {
        const at = toScreen(r, {x: chrome.expand.x, y: chrome.expand.y});
        if (Math.abs(point.x - at.x) <= nearest(chrome.expand.r) + 3 && Math.abs(point.y - at.y) <= 12) {
          return {kind: 'expand', id: card.id};
        }
      }
    }
    for (const card of layout.cards) {
      const topLeft = toScreen(r, card), bottomRight = toScreen(r, {x: card.x + card.width, y: card.y + card.height});
      if (point.x >= topLeft.x && point.x <= bottomRight.x && point.y >= topLeft.y && point.y <= bottomRight.y) return {kind: 'card', id: card.id};
    }
    return null;
  }
  private start(e: PointerEvent): void {
    if (e.button !== 0 || this.drag) return;
    const point = this.screen(e), hit = this.hitTest(point);
    if (!hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this.renderer.dragNode = null;
    const node = this.host.nodes.get(hit.id);
    const origin = hit.kind === 'card' || hit.kind === 'enter' || hit.kind === 'expand'
      ? this.state.cards[hit.id] ?? {x: 0, y: 0}
      : this.state.nodes[hit.id] ?? {x: node?.x ?? 0, y: node?.y ?? 0};
    const had = hit.kind === 'card' ? hit.id in this.state.cards : hit.id in this.state.nodes;
    this.drag = {kind: hit.kind === 'card' || hit.kind === 'enter' || hit.kind === 'expand' ? (hit.kind === 'card' ? 'card' : hit.kind) : 'node',
      id: hit.id, pointer: e.pointerId, start: point, origin, had, moved: false};
  }
  private move(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== e.pointerId) {
      if (!drag) this.hover(this.screen(e));
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const point = this.screen(e);
    if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) drag.moved = true;
    if (!drag.moved || drag.kind === 'enter' || drag.kind === 'expand') return;
    const scale = zoomRatio(this.renderer);
    const next = {x: drag.origin.x + (point.x - drag.start.x) / scale, y: drag.origin.y + (point.y - drag.start.y) / scale};
    if (drag.kind === 'node') this.state.nodes[drag.id] = next; else this.state.cards[drag.id] = next;
    this.relayout();
  }
  private end(e: PointerEvent): void {
    const drag = this.drag; if (!drag || drag.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopImmediatePropagation(); this.drag = undefined;
    if (drag.moved) {
      if (drag.kind === 'node' || drag.kind === 'card') this.callbacks.save(this.getLayout());
      return;
    }
    if (drag.kind === 'enter') {this.callbacks.enter(drag.id); return;}
    if (drag.kind === 'expand') {this.toggleExpanded(drag.id); return;}
    this.clickNode(drag.id);
  }
  private cancel(): void {
    const drag = this.drag; if (!drag) return;
    this.drag = undefined;
    if (drag.kind === 'node' || drag.kind === 'card') {
      const store = drag.kind === 'node' ? this.state.nodes : this.state.cards;
      if (drag.had) store[drag.id] = drag.origin; else delete store[drag.id];
      this.relayout();
    }
  }
  private clickNode(id: NoteId): void {
    const now = Date.now();
    const double = this.lastClick.id === id && now - this.lastClick.time < 350;
    this.lastClick = double ? {id: '', time: 0} : {id, time: now};
    if (double) this.callbacks.edit(id); else this.callbacks.select(id);
  }
  private toggleExpanded(card: NoteId): void {
    if (this.expanded.has(card)) this.expanded.delete(card); else this.expanded.add(card);
    this.refresh();
    this.callbacks.onExpanded?.();
  }
  private relayout(): void {
    if (!this.snapshot || !this.drawable || !this.layout) return;
    this.layout = mapLayout(this.snapshot, this.drawable, this.state, this.aspectRatio());
    this.host.layout = this.layout;
    this.host.nodes = new Map(this.layout.nodes.map(node => [node.id, node]));
    this.host.cards = new Map(this.layout.cards.map(card => [card.id, card]));
    const index = mapPaintIndex(this.snapshot, this.host.nodes);
    this.host.incoming = index.incoming; this.host.jumps = index.jumps;
    this.pushData();
    this.schedule();
  }
  private hover(point: Point): void {
    const hit = this.hitTest(point);
    const hovered = hit?.kind === 'node' ? hit.id : null;
    const card = hit && hit.kind !== 'node' ? hit.id : null;
    const zone = hit && (hit.kind === 'enter' || hit.kind === 'expand') ? hit.kind : null;
    if (this.host.hovered === hovered && this.host.hoverCard === card && this.host.hoverZone === zone) return;
    this.host.hovered = hovered; this.host.hoverCard = card; this.host.hoverZone = zone;
    const surface = this.renderer.interactiveEl;
    surface.style.cursor = hit ? (hit.kind === 'card' ? 'grab' : 'pointer') : '';
    surface.title = this.hoverHint(hit, hovered);
    this.schedule();
  }
  /** Node names stay readable on hover even when their label is hidden or truncated. */
  private hoverHint(hit: Hit | null, hovered: NoteId | null): string {
    if (!hit) return '';
    if (hovered) return this.host.nodes.get(hovered)?.title ?? '';
    const card = this.host.cards.get(hit.id);
    if (!card) return '';
    if (hit.kind === 'enter') return `进入「${card.title}」`;
    if (hit.kind === 'expand') return card.collapsed ? `展开「${card.title}」的 ${card.hidden} 篇` : `收起「${card.title}」`;
    return card.collapsed && card.hidden > 0 ? `${card.title} · 另有 ${card.hidden} 篇可展开` : card.title;
  }
  private clearHover(): void {
    if (!this.host.hovered && !this.host.hoverCard) return;
    this.host.hovered = null; this.host.hoverCard = null; this.host.hoverZone = null;
    this.renderer.interactiveEl.style.cursor = ''; this.renderer.interactiveEl.title = '';
    this.schedule();
  }
  private schedule(): void {
    if (this.disposed || this.frame) return;
    this.frame = this.container.win.requestAnimationFrame(() => {
      this.frame = 0; if (this.disposed) return;
      this.host.selected = this.selected ?? null;
      this.renderer.px?.render?.();
      const failure = takePaintError();
      if (failure) this.callbacks.error?.(failure);
      this.container.win.clearTimeout(this.saveTimer);
      this.saveTimer = this.container.win.setTimeout(() => {if (!this.drag) this.callbacks.save(this.getLayout());}, 250);
    });
  }
  getLayout(): MapLayoutState {
    const r = this.renderer;
    return {
      version: 2,
      nodes: {...this.state.nodes}, cards: {...this.state.cards},
      viewport: {x: r.panX / this.dpr() - r.width / 2, y: r.panY / this.dpr() - r.height / 2, scale: r.targetScale / this.dpr()},
    };
  }
  setBudget(budget: number): void {this.budget = budget;}
  /** World coordinates of a card's header actions, shared with keyboard and runtime checks. */
  cardActions(id: NoteId): {enter: Point | null; expand: Point | null} {
    const card = this.host.cards.get(id);
    if (!card) return {enter: null, expand: null};
    const chrome = cardChrome(this.renderer, card, semanticLevel(this.renderer) !== 'far');
    return {
      enter: chrome.enter ? {x: chrome.enter.x, y: chrome.enter.y} : null,
      expand: chrome.expand ? {x: chrome.expand.x, y: chrome.expand.y} : null,
    };
  }
  locate(id: string): boolean {
    const box = this.host.nodes.get(id); if (!box) return false;
    const r = this.renderer, scale = Math.max(.8 * this.dpr(), r.targetScale);
    r.setScale(scale); r.zoomTo(scale);
    r.setPan(r.width * this.dpr() / 2 - box.x * scale, r.height * this.dpr() / 2 - box.y * scale);
    r.changed();
    return true;
  }
  zoomPercent(): number {return Math.round(this.renderer.targetScale / this.dpr() * 100);}
  zoom(direction: 1 | -1): void {
    this.renderer.zoomTo(Math.max(.05 * this.dpr(), Math.min(3 * this.dpr(), this.renderer.targetScale * Math.pow(1.2, direction))));
    this.renderer.changed();
  }
  /** `comfortable` keeps the first view readable instead of shrinking a large map to nothing. */
  fit(comfortable = false): void {
    const layout = this.layout; if (!layout || !layout.cards.length) return;
    const {minX, minY, maxX, maxY} = layout.bounds, r = this.renderer;
    const target = Math.min((r.width - 40) / Math.max(1, maxX - minX), (r.height - 40) / Math.max(1, maxY - minY));
    const scale = Math.max(comfortable ? .5 : .05, Math.min(1.15, target)) * this.dpr();
    r.setScale(scale); r.zoomTo(scale);
    r.setPan(r.width * this.dpr() / 2 - (maxX + minX) / 2 * scale, r.height * this.dpr() / 2 - (maxY + minY) / 2 * scale);
    r.changed();
  }
  destroy(): void {
    if (this.disposed) return;
    this.cancel(); this.callbacks.save(this.getLayout()); this.disposed = true;
    this.container.win.cancelAnimationFrame(this.frame);
    this.container.win.clearTimeout(this.saveTimer);
    for (const cleanup of this.decorations.values()) cleanup();
    this.decorations.clear();
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.native.dataEngine.queue?.cancel();
    this.native.unload(); void (this.native as unknown as {onClose(): Promise<void>}).onClose();
    this.element.remove(); this.container.removeClass('brain-map-stage');
  }
}
