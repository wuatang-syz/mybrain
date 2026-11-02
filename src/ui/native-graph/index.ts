import {DEFAULT_MIND_MAP, loadMindMapSettings, type MindMapSettings} from '../../mind-map-settings';
import type {App, WorkspaceLeaf} from 'obsidian';
import type { CanvasCallbacks, GraphNode, LayoutState, Neighborhood, Point } from '../../model/types';
import { allowsPort, portKinds, portRequest, type PortSide } from '../canvas/ports';
import { createPreview } from '../canvas';
import { foldGroups } from '../canvas/groups';
import { nodeSize } from '../canvas/node-size';
import type { GroupLabel, GroupToggle } from '../canvas/layout';
import { assertNativeView, newGraphics, type Graphics, type NativeData, type NativeNode, type NativeRegistry, type NativeRenderer, type NativeView, type PixiEvent } from './types';
import { hiddenNativeNodes, filteredGraphData, structuralLayout, structuralNodes } from './data';
import { decorateNode, nodePort } from './nodes';
import { decorateEdge, decorateStructure } from './edges';
import {edgeKey, planEdgeRoutes, routedEdgePaths, type EdgeRoute} from './edge-routing';
import { stabilizeResize } from './resize';
import {moveInOrder, orderedSnapshot, StructuralDrag} from './sorting';
import {PeripheralDrag} from './peripheral-drag';
import {isolateStructuralDrag} from './drag-ownership';
import {relationWindowLayout, windowSource, type WindowLayout, type WindowOffsets, type WindowZone} from '../canvas/windows';
import {WindowControls} from '../canvas/window-controls';

/** One native graph, including its worker, PIXI stage, search and controls. No second canvas. */
export class NativeGraphCanvas {
  readonly element: HTMLElement;
  readonly renderer: NativeRenderer;
  core = new Map<string, GraphNode>();
  positions: Record<string, Point> = {};
  selected?: string;
  private readonly native: NativeView;
  private readonly cleanups: (() => void)[] = [];
  private decorations: (() => void)[] = [];
  private edgeRoutes = new Map<string, EdgeRoute>();
  private nodeDecorations = new Map<NativeNode, () => void>();
  private snapshot?: Neighborhood;
  private base?: NativeData;
  private pinned = new Set<string>();
  private port?: {id: string; side: PortSide; start: Point; pointerId: number};
  private portHoverId?: string;
  settings: MindMapSettings = {...DEFAULT_MIND_MAP};
  private preview?: Graphics;
  private destroyed = false;
  private readonly hint: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly overflow: HTMLButtonElement;
  private readonly originalSetData: NativeRenderer['setData'];
  private readonly originalChanged: NativeRenderer['changed'];
  private expandedGroups = new Set<string>();
  private hidden = new Set<string>();
  private groupToggles: GroupToggle[] = [];
  private groupLabels: GroupLabel[] = [];
  private overlayFrame = 0;
  private lastNodeClick = {id: '', time: 0};
  private editUntil = 0;
  private clickTimer = 0;
  private restoredPositions: Record<string, Point> = {};
  private order: string[] = [];
  private structuralDrag?: StructuralDrag;
  private peripheralDrag?: PeripheralDrag;
  private sortMarker?: HTMLElement;
  private sortPreviewKey = '';
  private liftId?: string;
  private reorderFrame = 0;
  private ignoreClickUntil = 0;
  private windowControls?: WindowControls;
  private windowLayout?: WindowLayout;
  private windowOffsets: WindowOffsets = {};
  private displaySnapshot?: Neighborhood;
  private windowHistory = new Map<string, WindowOffsets>();

  constructor(container: HTMLElement, private readonly app: App, leaf: WorkspaceLeaf, private readonly callbacks: CanvasCallbacks) {
    const factory = (app as App & NativeRegistry).viewRegistry?.viewByType?.graph;
    if (typeof factory !== 'function') throw new Error('请先启用 Obsidian 的「关系图谱」核心插件，再打开 Brain。');
    this.native = factory(leaf);
    try { assertNativeView(this.native); }
    catch (error) {this.native.renderer?.destroy?.(); this.native.unload(); throw error;}
    this.renderer = this.native.renderer;
    this.element = this.native.containerEl;
    this.element.classList.add('brain-native-graph');
    this.element.dataset.engine = 'obsidian-native';
    this.element.tabIndex = 0;
    this.element.setAttribute('aria-description', '知识关系画布。快捷键可在 Brain 设置中查看和修改。');
    this.native.contentEl.classList.add('graph-view', 'brain-native-content');
    this.native.headerEl.hide();
    container.append(this.element);
    this.hint = container.createDiv({cls: 'brain-canvas-hint', attr: {role: 'status'}});
    this.overlay = container.createDiv({cls: 'brain-native-overlay'});
    this.overflow = container.createEl('button', {cls: 'brain-overflow brain-button', type: 'button'});
    this.overflow.hidden = true;
    this.overflow.onclick = () => this.callbacks.onOverflow(this.displaySnapshot?.overflow ?? this.snapshot?.overflow ?? []);
    const renderer = this.renderer;
    this.originalSetData = renderer.setData;
    this.originalChanged = renderer.changed;
    renderer.setData = data => {this.base = data; this.updateData();};
    renderer.changed = () => {this.originalChanged.call(renderer); this.scheduleOverlay(); this.callbacks.onZoom?.(this.zoomPercent());};
    const click = renderer.onNodeClick, context = renderer.onNodeRightClick;
    renderer.onNodeClick = (event, id, type) => {
      if (this.port || Date.now() < this.ignoreClickUntil) return;
      const now = Date.now(), elapsed = now - this.lastNodeClick.time;
      const double = event.detail >= 2 || (this.lastNodeClick.id === id && elapsed >= 40 && elapsed < 450);
      if (!double && this.lastNodeClick.id === id && elapsed < 40) return;
      this.lastNodeClick = {id, time: now};
      if (this.core.has(id)) {
        this.clearClick();
        if (double) this.editNode(id);
        else {
          this.clickTimer = this.element.win.setTimeout(() => {
            this.clickTimer = 0;
            if (!this.destroyed && this.core.has(id)) this.activateNode(id);
          }, 400);
        }
      }
      else if (app.vault.getFileByPath(id)?.extension === 'md') {
        this.clearClick();
        if (double) this.editNode(id);
        else this.clickTimer = this.element.win.setTimeout(() => {this.clickTimer = 0; this.callbacks.onOpen(id);}, 400);
      }
      else click?.(event, id, type);
    };
    renderer.onNodeRightClick = (event, id, type) => {
      if (this.core.has(id) || app.vault.getFileByPath(id)?.extension === 'md') this.callbacks.onContext(id, event);
      else context?.(event, id, type);
    };
    const listen = (target: EventTarget, name: string, callback: EventListener, capture = false) => {
      target.addEventListener(name, callback, capture); this.cleanups.push(() => target.removeEventListener(name, callback, capture));
    };
    const win = container.ownerDocument.defaultView!;
    let lastSortClick = {id: '', time: 0};
    this.structuralDrag = new StructuralDrag({
      settings: () => this.settings,
      element: renderer.interactiveEl, nodes: () => this.core, snapshot: () => this.snapshot,
      positions: () => this.positions, world: event => this.world(event), enabled: () => !this.port && !this.destroyed,
      draw: () => {renderer.dragNode = null; this.syncStructuralPositions();}, hint: text => {this.hint.textContent = text;},
      focus: () => {renderer.dragNode = null; this.element.focus({preventScroll: true});},
      suppressClick: () => {this.ignoreClickUntil = Date.now() + 300; this.clearClick();},
      click: id => {
        const now = Date.now(), detail = lastSortClick.id === id && now - lastSortClick.time < 400 ? 2 : 1;
        lastSortClick = {id, time: now};
        renderer.onNodeClick?.(new MouseEvent('click', {detail}), id, '');
      },
      finish: (id, target) => this.reorder(id, target),
      preview: (id, target) => this.previewStructuralDrop(id, target),
      lift: id => this.liftStructural(id),
    });
    this.cleanups.push(() => this.structuralDrag?.destroy());
    this.peripheralDrag = new PeripheralDrag({
      settings: () => this.settings,
      renderer, core: () => this.core,
      isNote: id => app.vault.getFileByPath(id)?.extension === 'md',
      world: event => this.world(event), enabled: () => !this.port && !this.destroyed,
      hint: text => {this.hint.textContent = text;}, focus: () => this.element.focus({preventScroll: true}),
      suppressClick: () => {this.ignoreClickUntil = Date.now() + 300; this.clearClick();},
      click: id => renderer.onNodeClick?.(new MouseEvent('click'), id, ''),
      moved: id => {
        const node = renderer.nodeLookup[id]; if (!node) return;
        this.pinned.add(id); this.restoredPositions[id] = {x: node.x, y: node.y};
        this.callbacks.onLayout(this.getLayout());
      },
      connect: (source, target) => this.callbacks.onConnect(source, target),
    });
    this.cleanups.push(() => this.peripheralDrag?.destroy());
    listen(win, 'pointermove', event => {this.movePort(event as PointerEvent);}, true);
    listen(win, 'pointerup', event => {this.endPort(event as PointerEvent);}, true);
    listen(win, 'pointercancel', () => {this.cancelPort();});
    listen(win, 'blur', () => {this.cancelPort();});
    listen(win, 'keydown', event => {if ((event as KeyboardEvent).key === 'Escape') {this.cancelPort();}});
    listen(renderer.interactiveEl, 'pointerdown', () => {
      this.element.focus({preventScroll: true});
    }, true);
    listen(renderer.interactiveEl, 'dblclick', event => {
      if (this.port) return;
      this.clearClick();
      const point = this.world(event as MouseEvent);
      const target = [...this.core.values()].find(node => {
        const position = this.positions[node.id]; if (!position) return false;
        const size = nodeSize(node, this.settings); return Math.abs(point.x - position.x) <= size.width / 2 && Math.abs(point.y - position.y) <= size.height / 2;
      })?.id ?? renderer.highlightNode?.id;
      if (target) { event.preventDefault(); event.stopImmediatePropagation(); this.editNode(target); }
      else this.callbacks.onNewNote();
    }, true);
    listen(renderer.interactiveEl, 'pointerup', () => {
      win.requestAnimationFrame(() => {
        if (this.destroyed) return;
        for (const node of this.snapshot?.nodes ?? []) {
          if (node.zone !== 'outer') continue;
          const nativeNode = renderer.nodeLookup[node.id];
          if (!nativeNode) continue;
          if (nativeNode?.fx !== null && nativeNode?.fx !== undefined && nativeNode.fy !== null && nativeNode.fy !== undefined) {
            this.pinned.add(node.id); this.restoredPositions[node.id] = {x: nativeNode.x, y: nativeNode.y};
          } else this.pinned.delete(node.id);
        }
        for (const [id, point] of Object.entries(this.positions)) if (renderer.nodeLookup[id]) renderer.worker.postMessage({forceNode: {id, x: point.x, y: point.y}});
        if (!this.port) this.callbacks.onLayout(this.getLayout());
      });
    });
    this.cleanups.push(stabilizeResize(renderer));
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (this.destroyed || resizeFrame) return;
      resizeFrame = win.requestAnimationFrame(() => {
        resizeFrame = 0;
        if (!this.destroyed) {
          renderer.onResize();
          if (this.snapshot && this.windowControls) {this.render(this.snapshot, this.getLayout()); this.fit(false);}
        }
      });
    });
    observer.observe(container); this.cleanups.push(() => observer.disconnect());
    this.cleanups.push(() => {if (resizeFrame) win.cancelAnimationFrame(resizeFrame);});
    try {this.native.load(); renderer.onResize();}
    catch (error) {this.destroy(); throw error;}
    this.cleanups.push(isolateStructuralDrag(renderer, id => this.core.has(id)));
    renderer.setForces?.({centerStrength: .2, repelStrength: 400, linkDistance: 160});
    this.cleanups.push(() => {renderer.setData = this.originalSetData; renderer.changed = this.originalChanged;
      renderer.onNodeClick = click; renderer.onNodeRightClick = context;});
    this.windowControls = new WindowControls(container, this.element, event => this.world(event),
      (zone, offset) => this.scrollWindow(zone, offset), () => !this.destroyed && !this.port && !this.structuralDrag?.active());
  }
  private scrollWindow(zone: WindowZone, offset: number): void {
    if (!this.snapshot) return;
    this.windowOffsets[zone] = offset;
    this.render(this.snapshot);
    this.callbacks.onLayout(this.getLayout());
  }
  nodeOpacity(id: string): number {return this.windowLayout?.opacity[id] ?? 1;}
  private layoutWindows(snapshot: Neighborhood, order = this.order ?? []): WindowLayout {
    return relationWindowLayout(orderedSnapshot(windowSource(snapshot), order),
      {width: this.renderer.width, height: this.renderer.height}, this.windowOffsets, this.settings);
  }
  private editNode(id: string): void {
    this.clearClick();
    if (Date.now() < this.editUntil) return;
    this.editUntil = Date.now() + 500;
    this.ignoreClickUntil = this.editUntil;
    (this.callbacks.onEdit ?? this.callbacks.onOpen)(id);
  }
  private activateNode(id: string): void {
    this.callbacks.onFocus(id);
    this.callbacks.onOpen(id);
  }
  zoomPercent(): number {
    return Math.round(this.renderer.targetScale / (this.element.win.devicePixelRatio || 1) * 100);
  }
  applySettings(raw: MindMapSettings): void {
    const next = loadMindMapSettings(raw), previous = this.settings ?? DEFAULT_MIND_MAP;
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    const layout = this.getLayout();
    this.settings = next;
    const rebuild = previous.fontSize !== next.fontSize ||
      previous.showIcons !== next.showIcons || previous.spacing !== next.spacing || previous.lineLength !== next.lineLength || previous.foldLimit !== next.foldLimit;
    if (rebuild && this.snapshot) this.render(this.snapshot, layout);
    else {this.renderOverlay(); this.renderer.changed();}
  }
  zoom(direction: 1 | -1): void {
    const dpr = this.element.win.devicePixelRatio || 1;
    this.renderer.zoomTo(Math.max(.15 * dpr, Math.min(3 * dpr, this.renderer.targetScale * Math.pow(1.2, direction))));
    this.renderer.changed();
  }
  createRelative(side: PortSide): void {
    const source = this.snapshot?.focus;
    const node = source ? this.renderer.nodeLookup[source] : undefined;
    if (!source || !node || this.port || this.renderer.dragNode || !allowsPort(this.core.get(source), side)) return;
    const point = nodePort(this, node, side);
    const rect = this.renderer.interactiveEl.getBoundingClientRect();
    const dpr = this.element.win.devicePixelRatio || 1;
    this.callbacks.onCreate(source, portKinds[side], {
      x: rect.left + (point.x * this.renderer.scale + this.renderer.panX) / dpr,
      y: rect.top + (point.y * this.renderer.scale + this.renderer.panY) / dpr,
    });
  }
  getFocus(): string | undefined {return this.snapshot?.focus;}
  private reorder(id: string, target: string): void {
    if (!this.snapshot) return;
    const from = structuredClone(this.positions);
    const ids = orderedSnapshot(this.windowControls ? windowSource(this.snapshot) : this.snapshot, this.order).nodes.filter(node => node.zone !== 'outer' && node.zone !== 'focus').map(node => node.id);
    this.order = moveInOrder(ids, id, target);
    this.render(this.snapshot);
    this.settleReorder(from);
    this.callbacks.onLayout(this.getLayout());
  }
  /** Reflow the dragged node's group so its pending slot opens up, then mark where it lands. */
  private previewStructuralDrop(id?: string, target?: string): void {
    if (this.destroyed) return;
    if (!id) {this.clearStructuralPreview(); return;}
    const key = target ?? '';
    if (this.sortPreviewKey === key) return;
    this.sortPreviewKey = key;
    const node = this.core.get(id);
    if (!node) {this.clearStructuralMarker(); return;}
    if (!target || !this.snapshot) {
      const original = this.structuralDrag?.savedPositions();
      for (const [other, point] of Object.entries(original ?? {})) if (other !== id && this.positions[other]) this.positions[other] = {...point};
      this.clearStructuralMarker();
      return;
    }
    const order = orderedSnapshot(this.windowControls ? windowSource(this.snapshot) : this.snapshot, this.order).nodes.filter(item => item.zone !== 'outer' && item.zone !== 'focus').map(item => item.id);
    const folded = foldGroups(orderedSnapshot(this.snapshot, moveInOrder(order, id, target)), this.expandedGroups, this.settings?.foldLimit);
    const layout = this.windowControls ? this.layoutWindows(this.snapshot, moveInOrder(order, id, target))
      : structuralLayout(folded.snapshot, folded.groups, undefined, this.settings);
    for (const [other, point] of Object.entries(layout.positions)) if (other !== id && this.positions[other]) this.positions[other] = {...point};
    const slot = layout.positions[id];
    if (slot) this.drawStructuralMarker({...slot, ...nodeSize(node, this.settings)});
  }
  private drawStructuralMarker(slot: {x: number; y: number; width: number; height: number}): void {
    if (!this.sortMarker) {
      this.sortMarker = this.overlay.createDiv({cls: 'brain-drop-marker'});
    }
    this.sortMarker.dataset.worldX = String(slot.x); this.sortMarker.dataset.worldY = String(slot.y);
    this.sortMarker.dataset.worldWidth = String(slot.width); this.sortMarker.dataset.worldHeight = String(slot.height);
    this.syncOverlay();
  }
  private clearStructuralMarker(): void {
    this.sortMarker?.remove(); this.sortMarker = undefined;
  }
  private clearStructuralPreview(): void {
    this.sortPreviewKey = '';
    this.clearStructuralMarker();
    this.liftStructural();
  }
  /** Fade the grabbed node while it is out of the layout so the open slot reads as its new home. */
  private liftStructural(id?: string): void {
    if (this.liftId === id) return;
    for (const [nodeId, alpha] of [[this.liftId, 1], [id, .5]] as const) {
      const node = nodeId ? this.renderer.nodeLookup[nodeId] : undefined;
      if (!node) continue;
      if (node.circle) node.circle.alpha = alpha;
      if (node.text) node.text.alpha = alpha;
    }
    this.liftId = id;
    if (!this.destroyed) this.renderer.changed();
  }
  /** A short settle keeps the reorder legible instead of teleporting the row. */
  private settleReorder(from: Record<string, Point>): void {
    this.cancelSettle();
    const win = this.element.win;
    if (this.destroyed || typeof win?.requestAnimationFrame !== 'function' || typeof win.performance?.now !== 'function') return;
    const items: {id: string; node: NativeNode; from: Point; to: Point}[] = [];
    for (const [id, to] of Object.entries(this.positions)) {
      const node = this.renderer.nodeLookup[id], start = from[id];
      if (!node || !start || (Math.abs(start.x - to.x) < .5 && Math.abs(start.y - to.y) < .5)) continue;
      items.push({id, node, from: {...start}, to: {...to}});
    }
    if (!items.length) return;
    const started = win.performance.now(), duration = 170;
    const step = () => {
      this.reorderFrame = 0;
      if (this.destroyed) return;
      const progress = Math.min(1, (win.performance.now() - started) / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      for (const item of items) {
        const x = item.from.x + (item.to.x - item.from.x) * ease, y = item.from.y + (item.to.y - item.from.y) * ease;
        item.node.x = item.node.fx = x; item.node.y = item.node.fy = y;
        this.renderer.worker.postMessage({forceNode: {id: item.id, x, y}, alpha: .3, run: true});
      }
      this.renderer.changed();
      if (progress < 1) this.reorderFrame = win.requestAnimationFrame(step);
    };
    step();
  }
  private cancelSettle(): void {
    if (this.reorderFrame) this.element.win.cancelAnimationFrame(this.reorderFrame);
    this.reorderFrame = 0;
  }
  getLayout(): LayoutState {
    const r = this.renderer, dpr = this.element.win.devicePixelRatio || 1;
    const ids = new Set([...(this.snapshot?.nodes.map(node => node.id) ?? []), ...this.pinned]);
    const positions = Object.fromEntries(r.nodes.filter(node => ids.has(node.id) && !this.hidden.has(node.id)).map(node => [node.id, {x: node.x, y: node.y}]));
    Object.assign(positions, this.positions, this.structuralDrag?.savedPositions());
    for (const id of this.pinned) if (!positions[id] && this.restoredPositions[id]) positions[id] = {...this.restoredPositions[id]!};
    return {positions, pinned: [...this.pinned], ...(this.order.length ? {order: [...this.order]} : {}),
      ...(this.windowControls ? {windows: {...this.windowOffsets}, windowVersion: 3 as const} : {}),
      viewport: {x: r.panX / dpr - r.width / 2, y: r.panY / dpr - r.height / 2, scale: r.targetScale / dpr}};
  }
  render(snapshot: Neighborhood, state?: LayoutState): void {
    if (this.destroyed) return;
    const changed = this.snapshot?.focus !== snapshot.focus;
    if (this.windowControls) {
      if (changed) {
        this.windowControls.cancel();
        if (this.snapshot) this.windowHistory.set(this.snapshot.focus, {...this.windowOffsets});
        if (this.windowHistory.size > 30) this.windowHistory.delete(this.windowHistory.keys().next().value!);
        this.windowOffsets = {...(state?.windows ?? this.windowHistory.get(snapshot.focus) ?? {})};
      } else if (state?.windows) this.windowOffsets = {...state.windows};
    }
    this.cancelSettle();
    this.structuralDrag?.cancel();
    this.peripheralDrag?.cancel();
    if (state) this.order = [...(state.order ?? [])];
    else if (changed) this.order = [];
    const rootChanged = this.snapshot?.root !== snapshot.root;
    if (state) {
      this.pinned = new Set(state.pinned);
      this.restoredPositions = structuredClone(state.positions);
    } else if (changed || rootChanged) {
      this.pinned.clear(); this.restoredPositions = {};
    }
    if (changed || rootChanged) this.expandedGroups.clear();
    this.cancelPort();
    const previous = new Set(this.core.keys());
    const folded = foldGroups(orderedSnapshot(snapshot, this.order ?? []), this.expandedGroups, this.settings?.foldLimit);
    const visible = new Set(folded.snapshot.nodes.map(node => node.id));
    const layout = structuralLayout(folded.snapshot, folded.groups, undefined, this.settings);
    this.snapshot = snapshot;
    this.hidden = hiddenNativeNodes(snapshot, visible);
    this.core = structuralNodes(folded.snapshot); this.positions = layout.positions;
    // Retire free-position pins, including folded structure, while retaining outer pins.
    for (const node of [...snapshot.nodes, ...snapshot.overflow]) if (node.zone !== 'outer') this.pinned.delete(node.id);
    this.groupToggles = layout.toggles; this.groupLabels = layout.labels;
    if (this.windowControls) {
      this.windowLayout = this.layoutWindows(snapshot);
      this.windowOffsets = this.windowLayout.offsets;
      this.displaySnapshot = this.windowLayout.snapshot;
      this.core = structuralNodes(this.displaySnapshot); this.positions = this.windowLayout.positions;
      this.hidden = hiddenNativeNodes(windowSource(snapshot), new Set(this.displaySnapshot.nodes.map(node => node.id)));
      this.groupToggles = []; this.groupLabels = [];
    }
    for (const id of previous) if (!this.core.has(id)) {
      const node = this.renderer.nodeLookup[id];
      if (node) {node.fx = null; node.fy = null;}
      this.renderer.worker.postMessage({forceNode: {id, x: null, y: null}, alpha: .3, run: true});
    }
    this.updateData();
    this.renderOverlay();
    const overflow = this.displaySnapshot?.overflow ?? snapshot.overflow;
    this.overflow.hidden = !overflow.length;
    this.overflow.textContent = `查看其余 ${overflow.length} 个节点`;
    if (changed || rootChanged) {
      const dpr = this.element.win.devicePixelRatio || 1;
      if (state?.viewport && (!this.windowControls || state.windows)) {
        const v = state.viewport;
        this.renderer.setPan((this.renderer.width / 2 + (changed ? 0 : v.x)) * dpr, (this.renderer.height / 2 + (changed ? 0 : v.y)) * dpr);
        const scale = Math.min(v.scale * dpr, this.fitScale(true));
        this.renderer.setScale(scale); this.renderer.zoomTo(scale);
      } else this.fit();
    }
    this.renderer.changed();
  }
  private updateData(): void {
    if (!this.base || this.destroyed) return;
    for (const cleanup of this.decorations.reverse()) cleanup(); this.decorations = [];
    const snapshot = this.displaySnapshot ?? this.snapshot;
    this.edgeRoutes = planEdgeRoutes(this.core, this.positions, snapshot?.edges ?? []);
    const base: NativeData = {...this.base, nodes: {}};
    for (const node of snapshot?.nodes ?? []) {
      base.nodes[node.id] = {type: '', links: {}};
    }
    const pathToId = new Map((snapshot?.nodes ?? []).map(node => [node.notePath ?? node.id, node.id]));
    for (const [path, node] of Object.entries(this.base.nodes)) {
      const id = pathToId.get(path) ?? path;
      if (!base.nodes[id]) continue;
      for (const target of Object.keys(node.links)) {const to = pathToId.get(target) ?? target; if (to !== id && base.nodes[to]) base.nodes[id]!.links[to] = true;}
    }
    const directory = snapshot?.nodes.some(node => !!node.kind);
    if (directory) for (const node of snapshot!.nodes) {
      base.nodes[node.id]!.links = Object.fromEntries((node.links ?? []).filter(id => !!base.nodes[id] && id !== node.id).map(id => [id, true]));
    }
    this.originalSetData.call(this.renderer, filteredGraphData(base,
      this.hidden));
    const live = new Set(this.renderer.nodes);
    for (const [node, cleanup] of this.nodeDecorations) if (!live.has(node)) {
      cleanup(); this.nodeDecorations.delete(node);
    }
    for (const node of live) if (!this.nodeDecorations.has(node)) this.nodeDecorations.set(node, decorateNode(this, node));
    const linkPairs = new Set<string>();
    for (const link of this.renderer.links) {
      const key = JSON.stringify([link.source.id, link.target.id].sort());
      const duplicate = linkPairs.has(key); linkPairs.add(key);
      this.decorations.push(decorateEdge(this.renderer, link, this.core, [], this.callbacks, {
        settings: () => this.settings,
        duplicate: duplicate || (snapshot?.edges.some(edge => edge.kind === 'jump' && [edge.source, edge.target].sort().join('\0') === [link.source.id, link.target.id].sort().join('\0')) ?? false),
        opacity: id => this.nodeOpacity(id),
        selected: () => this.portHoverId ?? this.selected,
      }));
    }
    for (const edge of snapshot?.edges ?? []) {
      this.decorations.push(decorateStructure(this.renderer, edge, this.core, this.callbacks, () => this.settings,
        id => this.nodeOpacity(id), id => this.windowLayout?.childRoutes[id], {
          routing: this.edgeRoutes.get(edgeKey(edge)), selected: () => this.portHoverId ?? this.selected,
        }));
    }
    this.syncStructuralPositions();
    for (const id of this.pinned) {
      const point = this.restoredPositions[id], node = this.renderer.nodeLookup[id];
      if (point && node) {
        node.x = node.fx = point.x; node.y = node.fy = point.y;
        this.renderer.worker.postMessage({forceNode: {id, x: point.x, y: point.y}, alpha: .3, run: true});
      }
    }
    this.renderer.changed();
  }
  private syncStructuralPositions(): void {
    for (const [id, point] of Object.entries(this.positions)) {
      const node = this.renderer.nodeLookup[id];
      if (!node) continue;
      node.x = node.fx = point.x; node.y = node.fy = point.y;
      this.renderer.worker.postMessage({forceNode: {id, x: point.x, y: point.y}, alpha: .3, run: true});
    }
    this.renderer.changed();
  }
  select(id?: string, pan = true): void {
    this.selected = id;
    const node = id ? this.renderer.nodeLookup[id] : undefined;
    if (node && pan) {
      const r = this.renderer, dpr = this.element.win.devicePixelRatio || 1;
      r.setPan(r.width * dpr / 2 - node.x * r.scale, r.height * dpr / 2 - node.y * r.scale);
    }
    this.renderer.changed();
  }
  private fitScale(includeOuter: boolean): number {
    const r = this.renderer;
    if (this.windowLayout) {
      let width = this.windowLayout.width, height = this.windowLayout.height;
      for (const edge of (this.displaySnapshot ?? this.snapshot)?.edges ?? []) {
        const routed = routedEdgePaths(r, edge, this.core, this.settings, this.edgeRoutes?.get(edgeKey(edge)));
        for (const path of routed?.paths ?? []) for (const p of path) {
          width = Math.max(width, Math.abs(p.x) * 2 + 64);
          height = Math.max(height, Math.abs(p.y) * 2 + 64);
        }
      }
      let scale = Math.min(1, r.width / width, r.height / height);
      if (this.settings.showGroupLabels) for (const w of this.windowLayout.windows ?? []) {
        if (!w.max || w.zone === 'parent') continue;
        if (w.axis === 'y') {
          const x = w.zone === 'jump' ? w.x - 18 : w.x + w.width + 18;
          const padding = 18 + 24 + String(w.count).length * 8 + 12;
          scale = Math.min(scale, Math.max(1, r.width / 2 - padding) / Math.max(1, Math.abs(x)));
        } else scale = Math.min(scale, Math.max(1, r.height / 2 - 48) / Math.max(1, Math.abs(w.y + w.height)));
      }
      return scale * (this.element.win.devicePixelRatio || 1);
    }
    const bounds = Object.entries(this.positions).map(([id, p]) => ({...p, ...(this.core.has(id) ? nodeSize(this.core.get(id)!, this.settings) : {width: 168, height: 48})}));
    bounds.push(...this.groupToggles.map(toggle => ({...toggle, width: 188, height: 36})));
    if (includeOuter) for (const node of r.nodes ?? []) {
      if (this.core.has(node.id) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const title = node.id.split('/').pop()?.replace(/\.md$/, '') ?? node.id;
      const size = nodeSize({id: node.id, title, zone: 'child', groupParents: [], issues: []});
      bounds.push({x: node.x, y: node.y, width: size.width, height: 100});
    }
    const width = Math.max(1, ...bounds.map(p => Math.abs(p.x) * 2 + p.width));
    const height = Math.max(1, ...bounds.map(p => Math.abs(p.y) * 2 + p.height));
    const dpr = this.element.win.devicePixelRatio || 1;
    return Math.max(.01, Math.min(1, Math.max(1, r.width - 72) / width, Math.max(1, r.height - 128) / height)) * dpr;
  }
  fit(includeOuter = true): void {
    const r = this.renderer;
    if (!Object.keys(this.positions).length) return;
    const dpr = this.element.win.devicePixelRatio || 1;
    const scale = this.fitScale(includeOuter);
    r.setScale(scale); r.zoomTo(scale); r.setPan(r.width * dpr / 2, r.height * dpr / 2); r.changed();
  }
  connecting(): boolean {return !!this.port;}
  connectionSource(): string | undefined {return this.port?.id;}
  hoveredPort(): string | undefined {return this.portHoverId;}
  hoverPort(id?: string, _side?: PortSide): void {this.portHoverId = id; this.renderer.changed();}
  startPort(id: string, side: PortSide, event: PixiEvent): void {
    if (event.button !== 0 || this.port || this.structuralDrag?.active() || (this.core.has(id) && !allowsPort(this.core.get(id), side))) return;
    event.stopPropagation();
    const native = event.nativeEvent;
    this.port = {id, side, start: {x: native.clientX, y: native.clientY}, pointerId: event.pointerId};
    this.renderer.dragNode = null; this.renderer.changed();
  }
  private world(event: Pick<MouseEvent, 'clientX' | 'clientY'>): Point {
    const r = this.renderer, rect = r.interactiveEl.getBoundingClientRect(), dpr = this.element.win.devicePixelRatio || 1;
    return {x: ((event.clientX - rect.left) * dpr - r.panX) / r.scale, y: ((event.clientY - rect.top) * dpr - r.panY) / r.scale};
  }
  private movePort(event: PointerEvent): void {
    if (!this.port || event.pointerId !== this.port.pointerId) return;
    const source = this.renderer.nodeLookup[this.port.id];
    if (!source?.circle || !this.renderer.hanger) return;
    if (!this.preview) {this.preview = newGraphics(source.circle); this.preview.eventMode = 'none'; this.preview.zIndex = 4; this.renderer.hanger.addChild(this.preview);}
    const start = nodePort(this, source, this.port.side), end = this.world(event);
    const dx = end.x - start.x, dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const bend = Math.min(160, distance * .4);
    const side = this.port.side;
    const a = {
      x: start.x + (side === 'left' ? -bend : side === 'right' ? bend : 0),
      y: start.y + (side === 'top' ? -bend : side === 'bottom' ? bend : 0),
    };
    // A slight perpendicular offset keeps the preview curved even on an exact horizontal/vertical drag.
    const arc = Math.min(48, distance * .15), length = distance || 1;
    const b = {x: end.x - dx * .25 - dy / length * arc, y: end.y - dy * .25 + dx / length * arc};
    this.preview.clear().lineStyle(2 / this.renderer.scale, 0x7560dd).moveTo(start.x, start.y)
      .bezierCurveTo(a.x, a.y, b.x, b.y, end.x, end.y);
    this.hint.textContent = createPreview(this.core.get(source.id)?.title ?? source.id, portKinds[this.port.side]);
    this.renderer.changed();
  }
  private endPort(event: PointerEvent): void {
    const port = this.port;
    if (!port || event.pointerId !== port.pointerId) return;
    const distance = Math.hypot(event.clientX - port.start.x, event.clientY - port.start.y);
    const candidates = new Map(this.core);
    if (!candidates.has(port.id) && this.renderer.nodeLookup[port.id]) candidates.set(port.id, {id: port.id, title: port.id, zone: 'outer', issues: [], groupParents: []});
    const point = this.world(event);
    const radius = 14 * (this.element.win.devicePixelRatio || 1) / this.renderer.scale;
    let target: {id: string; side: PortSide} | undefined;
    for (const id of this.core.keys()) {
      const node = this.renderer.nodeLookup[id];
      if (!node || id === port.id) continue;
      for (const side of ['top', 'bottom', 'left', 'right'] as PortSide[]) {
        if (!allowsPort(this.core.get(id), side)) continue;
        const p = nodePort(this, node, side);
        if (Math.hypot(point.x - p.x, point.y - p.y) <= radius) target = {id, side};
      }
    }
    const request = portRequest(port.id, target, candidates);
    const rect = this.renderer.interactiveEl.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom &&
      event.target === this.renderer.interactiveEl;
    this.cancelPort();
    if (distance < 6) return;
    if (request) this.callbacks.onDrop(request);
    else if (inside && this.core.has(port.id) && distance >= 64 && !this.renderer.highlightNode) this.callbacks.onCreate(port.id, portKinds[port.side], {x: event.clientX, y: event.clientY});
  }
  private cancelPort(): void {
    this.port = undefined;
    this.portHoverId = undefined;
    if (this.preview) {this.preview.parent?.removeChild(this.preview); this.preview.destroy(); this.preview = undefined;}
    this.hint.textContent = '';
  }
  private clearClick(): void {
    this.element.win.clearTimeout(this.clickTimer); this.clickTimer = 0;
  }
  private renderOverlay(): void {
    this.overlay.empty();
    this.sortMarker = undefined;
    for (const label of (this.settings?.showGroupLabels === false ? [] : this.groupLabels)) {
      const element = this.overlay.createDiv({cls: `brain-zone-label brain-zone-label-${label.kind}`, text: label.text});
      element.dataset.worldX = String(label.x); element.dataset.worldY = String(label.y);
    }
    for (const toggle of this.groupToggles) {
      const button = this.overlay.createEl('button', {cls: 'brain-group-toggle', type: 'button',
        text: toggle.expanded ? '收起' : `展开另外 ${toggle.hidden} 个`});
      button.dataset.groupKey = toggle.key; button.dataset.worldX = String(toggle.x); button.dataset.worldY = String(toggle.y);
      button.setAttribute('aria-expanded', String(toggle.expanded));
      button.onclick = event => {
        event.stopPropagation();
        if (this.expandedGroups.has(toggle.key)) this.expandedGroups.delete(toggle.key); else this.expandedGroups.add(toggle.key);
        if (this.snapshot) {this.render(this.snapshot); this.fit(false);}
      };
    }
    this.syncOverlay();
  }
  private scheduleOverlay(): void {
    if (this.overlayFrame || this.destroyed) return;
    this.overlayFrame = this.element.win.requestAnimationFrame(() => {this.overlayFrame = 0; this.syncOverlay();});
  }
  private syncOverlay(): void {
    const r = this.renderer, dpr = this.element.win.devicePixelRatio || 1;
    const hovered = r.highlightNode ? this.core.get(r.highlightNode.id) : undefined;
    r.interactiveEl.title = hovered?.title ?? '';
    const canvas = r.interactiveEl.getBoundingClientRect(), host = this.overlay.parentElement?.getBoundingClientRect();
    if (!host) return;
    if (this.windowLayout) this.windowControls?.update(this.windowLayout, p => ({
      x: canvas.left - host.left + (p.x * r.scale + r.panX) / dpr,
      y: canvas.top - host.top + (p.y * r.scale + r.panY) / dpr,
    }), r.scale / dpr, this.settings.showGroupLabels);
    for (const element of this.overlay.querySelectorAll<HTMLElement>('[data-world-x]')) {
      const x = Number(element.dataset.worldX), y = Number(element.dataset.worldY);
      element.style.left = `${canvas.left - host.left + (x * r.scale + r.panX) / dpr}px`;
      element.style.top = `${canvas.top - host.top + (y * r.scale + r.panY) / dpr}px`;
      const width = Number(element.dataset.worldWidth), height = Number(element.dataset.worldHeight);
      if (width && height) {
        element.style.width = `${width * r.scale / dpr}px`;
        element.style.height = `${height * r.scale / dpr}px`;
      }
    }
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.cancelPort(); this.clearClick(); this.cancelSettle(); this.clearStructuralPreview();
    this.windowControls?.destroy();
    if (this.overlayFrame) this.element.win.cancelAnimationFrame(this.overlayFrame);
    for (const cleanup of this.decorations.reverse()) cleanup(); this.decorations = [];
    for (const cleanup of this.nodeDecorations.values()) cleanup(); this.nodeDecorations.clear();
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.native.dataEngine.progression = 0; this.native.dataEngine.queue?.cancel();
    this.native.unload(); void (this.native as unknown as {onClose(): Promise<void>}).onClose();
    this.element.remove(); this.hint.remove(); this.overlay.remove(); this.overflow.remove();
  }
}
