// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {GraphIndex} from '../src/graph';
import {BrainView} from '../src/ui/view';
import {defaultShortcuts} from '../src/shortcuts';
import {DEFAULT_MIND_MAP} from '../src/mind-map-settings';
import {edgeGeometry} from '../src/ui/native-graph/edges';
import {edgeKey, planEdgeRoutes, routedEdgePaths} from '../src/ui/native-graph/edge-routing';
import type {GraphNode, LayoutState, NoteRecord} from '../src/model/types';
import {loadBrainData} from '../src/settings';
import {directoryGraphData, hiddenNativeNodes, filteredGraphData, structuralNodes, structuralPositions} from '../src/ui/native-graph/data';
import {NativeGraphCanvas} from '../src/ui/native-graph';
import {decorateNode, showPorts, type NodeHost} from '../src/ui/native-graph/nodes';
import type {NativeData, NativeNode, NativeRenderer} from '../src/ui/native-graph/types';

const note = (id: string, parents: string[] = []): NoteRecord => ({id, title: id, parents, links: [], issues: []});
it('persists reordering through refresh, folding and navigation, and retires structural free-position pins', () => {
  const graph = new GraphIndex([note('Root'), ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => note(id, ['Root']))]);
  const snapshot = graph.neighborhood('Root');
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const nodes = graph.all().map(n => ({id: n.id, x: 999, y: 999}));
  const expandedGroups = new Set<string>();
  const onLayout = vi.fn();
  Object.assign(canvas, {snapshot, core: new Map(), expandedGroups, hidden: new Set(), pinned: new Set(), callbacks: {onLayout},
    renderer: {nodes, width: 800, height: 600, panX: 400, panY: 300, targetScale: 1,
      nodeLookup: Object.fromEntries(nodes.map(n => [n.id, n])), worker: {postMessage: vi.fn()}, changed: vi.fn(),
      setPan: vi.fn(), setScale: vi.fn(), zoomTo: vi.fn()},
    element: {win: {devicePixelRatio: 1}}, cancelPort: vi.fn(), updateData: vi.fn(), renderOverlay: vi.fn(), overflow: {}});
  const saved: LayoutState = {positions: {Root: {x: -140, y: 90}, A: {x: 420, y: -320}, G: {x: -610, y: 220}, B: {x: 999, y: 999}}, pinned: ['Root', 'A', 'G']};
  canvas.render(snapshot, saved);
  expect(canvas.positions.Root).toEqual({x: 0, y: 0}); expect(canvas.positions.A).not.toEqual(saved.positions.A);
  expect(canvas.positions.B).not.toEqual(saved.positions.B);
  expect(canvas.positions.G).toBeUndefined();
  expect(canvas.getLayout().pinned).toEqual([]);
  const original = structuredClone(canvas.positions);
  (canvas as unknown as {reorder(id: string, target: string): void}).reorder('A', 'C');
  expect(canvas.positions.A).toEqual(original.C); expect(canvas.positions.B).toEqual(original.A);
  expect(onLayout).toHaveBeenCalledOnce();
  const reloaded = loadBrainData(JSON.parse(JSON.stringify({version: 4, layouts: {Root: canvas.getLayout()}}))).layouts.Root!;
  expect(reloaded.order).toEqual(['B', 'C', 'A', 'D', 'E', 'F', 'G']);
  expandedGroups.add('child:Root'); canvas.render(snapshot);
  expect(canvas.positions.G).toBeDefined(); expect(canvas.positions.A).toEqual(original.C);
  expandedGroups.clear(); canvas.render(snapshot, canvas.getLayout());
  expect(canvas.positions.G).toBeUndefined();
  canvas.render(graph.neighborhood('A'));
  expect(canvas.positions.A).toEqual({x: 0, y: 0});
  canvas.render(snapshot, reloaded); expandedGroups.add('child:Root'); canvas.render(snapshot);
  expect(canvas.positions.Root).toEqual({x: 0, y: 0}); expect(canvas.positions.A).toEqual(original.C);
  (canvas as unknown as {syncStructuralPositions(): void}).syncStructuralPositions();
  expect(canvas.renderer.nodeLookup.A).toMatchObject({...original.C, fx: original.C!.x, fy: original.C!.y});
  expect(canvas.renderer.worker.postMessage).toHaveBeenCalledWith({forceNode: {id: 'A', ...original.C}, alpha: .3, run: true});
});
it('fits peripheral dots and expanded controls within a narrow pane without moving the center', () => {
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const setPan = vi.fn(), setScale = vi.fn(), zoomTo = vi.fn();
  Object.assign(canvas, {core: new Map([['Root', {id: 'Root', title: 'Root', zone: 'focus', groupParents: [], issues: []}]]),
    positions: {Root: {x: 0, y: 0}}, groupToggles: [{x: 0, y: 600}], element: {win: {devicePixelRatio: 2}},
    renderer: {width: 400, height: 500, nodes: [{id: 'Peripheral.md', x: 1000, y: -200}], changed: vi.fn(), setPan, setScale, zoomTo}});
  canvas.fit();
  const scale = setScale.mock.calls[0]![0] as number;
  expect(1000 * scale / 2).toBeLessThan(400 / 2 - 36);
  expect((600 + 18) * scale / 2).toBeLessThanOrEqual(500 / 2 - 64);
  expect(setPan).toHaveBeenCalledWith(400, 500); expect(zoomTo).toHaveBeenCalledWith(scale);
});
it.each([1, 2])('recenters on navigation while keeping saved zoom and order at pixel density %s', dpr => {
  const graph = new GraphIndex([note('Root'), note('Child', ['Root'])]);
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const setPan = vi.fn(), setScale = vi.fn(), zoomTo = vi.fn();
  Object.assign(canvas, {snapshot: graph.neighborhood('Root'), core: new Map(), expandedGroups: new Set(), hidden: new Set(), pinned: new Set(),
    renderer: {width: 800, height: 600, nodeLookup: {}, worker: {postMessage: vi.fn()}, changed: vi.fn(), setPan, setScale, zoomTo},
    element: {win: {devicePixelRatio: dpr}}, cancelPort: vi.fn(), updateData: vi.fn(), renderOverlay: vi.fn(), overflow: {}});
  const state = {positions: {}, pinned: [], order: ['Root'], viewport: {x: 250, y: -190, scale: .8}};
  canvas.render(graph.neighborhood('Child'), state);
  expect(setPan).toHaveBeenCalledExactlyOnceWith(400 * dpr, 300 * dpr);
  expect(setScale).toHaveBeenCalledWith(.8 * dpr); expect(zoomTo).toHaveBeenCalledWith(.8 * dpr);
  expect(canvas.positions.Child).toEqual({x: 0, y: 0});
  setPan.mockClear(); canvas.render(graph.neighborhood('Child'), state);
  expect(setPan).not.toHaveBeenCalled();
});
it('draws left jump relations as curves even when nodes share the same horizontal line', () => {
  const core = new Map<string, GraphNode>([['A', {id: 'A', title: 'A', zone: 'focus', groupParents: [], issues: []}],
    ['B', {id: 'B', title: 'B', zone: 'jump', groupParents: [], issues: []}]]);
  const renderer = {nodeLookup: {A: {id: 'A', x: 0, y: 0}, B: {id: 'B', x: -376, y: 0}}} as unknown as NativeRenderer;
  const geometry = edgeGeometry(renderer, {source: 'A', target: 'B', kind: 'jump'}, core)!;
  expect(geometry.from).toEqual({x: -40, y: 0}); expect(geometry.to).toEqual({x: -344, y: 0});
  expect(geometry.controls).toHaveLength(2);
  expect(geometry.controls![0].y).toBeGreaterThan(0); expect(geometry.controls![1].y).toBeGreaterThan(0);
});
it.each([1, 2])('fits outer routing gutters within a narrow pane at pixel density %s', dpr => {
  const nodes:GraphNode[]=[{id:'Focus',title:'Focus',zone:'focus',groupParents:[],issues:[]},
    {id:'Left',title:'Left',zone:'jump',groupParents:[],issues:[]},
    {id:'Right',title:'Right',zone:'sibling',groupParents:[],issues:[]}];
  const core=new Map(nodes.map(n=>[n.id,n]));
  const positions={Focus:{x:0,y:0},Left:{x:-280,y:70},Right:{x:280,y:-160}};
  const edge={source:'Left',target:'Right',kind:'jump' as const};
  const routes=planEdgeRoutes(core,positions,[edge]);
  const renderer={width:360,height:500,nodeLookup:Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{id,...p}])),
    setScale:vi.fn(),zoomTo:vi.fn(),setPan:vi.fn(),changed:vi.fn()} as unknown as NativeRenderer;
  const canvas=Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  Object.assign(canvas,{renderer,core,positions,settings:{...DEFAULT_MIND_MAP},edgeRoutes:routes,
    windowLayout:{width:680,height:500},displaySnapshot:{edges:[edge]},element:{win:{devicePixelRatio:dpr}}});
  canvas.fit();
  const scale=vi.mocked(renderer.setScale).mock.calls[0]![0]/dpr;
  const paths=routedEdgePaths(renderer,edge,core,DEFAULT_MIND_MAP,routes.get(edgeKey(edge)))!;
  for(const path of paths.paths)for(const point of path){
    expect(Math.abs(point.x)*scale).toBeLessThan(180);
    expect(Math.abs(point.y)*scale).toBeLessThan(250);
  }
  expect(renderer.setPan).toHaveBeenCalledWith(180*dpr,250*dpr);
});
it('opens the note as well as focusing a structural node, including the current center', () => {
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const callbacks = {onFocus: vi.fn(), onOpen: vi.fn()};
  Object.assign(canvas, {callbacks});
  (canvas as unknown as {activateNode(id: string): void}).activateNode('Root');
  expect(callbacks.onFocus).toHaveBeenCalledExactlyOnceWith('Root');
  expect(callbacks.onOpen).toHaveBeenCalledExactlyOnceWith('Root');
});

it('keeps existing native node graphics across growth data updates and releases removed nodes', () => {
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const clearGraphics = vi.fn();
  const node = {id: 'Outer', render: vi.fn(), clearGraphics, getSize: () => 10} as unknown as NativeNode;
  const renderer = {nodes: [node], links: [], nodeLookup: {Outer: node}, changed: vi.fn(),
    containerEl: document.createElement('div')} as unknown as NativeRenderer;
  Object.assign(canvas, {renderer, core: new Map(), positions: {}, pinned: new Set(), hidden: new Set(),
    base: {nodes: {Outer: {type: '', links: {}}}}, decorations: [], nodeDecorations: new Map(),
    app: {vault: {getFileByPath: () => null}}, originalSetData: vi.fn()});
  const update = () => (canvas as unknown as {updateData(): void}).updateData();
  update(); const render = node.render;
  update(); update();
  expect(node.render).toBe(render);
  expect(clearGraphics).not.toHaveBeenCalled();
  renderer.nodes = []; update();
  expect(clearGraphics).toHaveBeenCalledOnce();
});

it('restores the structural rectangle when native rendering redraws the same graphic', () => {
  class Graphic {
    shape = '';
    scale = {set: vi.fn()}; pivot = {set: vi.fn()};
    clear() {this.shape = ''; return this;}
    lineStyle() {return this;} beginFill() {return this;} endFill() {return this;}
    drawRoundedRect() {this.shape = 'rectangle'; return this;}
    drawCircle() {this.shape = 'circle'; return this;}
    on() {return this;} destroy() {}
  }
  const circle = new Graphic();
  const core = new Map<string, GraphNode>([['Root', {id: 'Root', title: 'Root', zone: 'focus', issues: [], groupParents: []}]]);
  const node = {id: 'Root', circle, text: {scale: {set: vi.fn()}}, getSize: () => 10,
    render: () => circle.drawCircle(), clearGraphics: vi.fn()} as unknown as NativeNode;
  const host = {core, positions: {Root: {x: 0, y: 0}}, renderer: {containerEl: document.createElement('div'),
    hanger: {addChild: vi.fn()}, scale: 1}, hoveredPort: () => undefined, connecting: () => false,
    connectionSource: () => undefined} as unknown as NodeHost;
  const cleanup = decorateNode(host, node);
  for (let frame = 0; frame < 3; frame++) {node.render(); expect(circle.shape).toBe('rectangle');}
  cleanup();
});
describe('native graph integration', () => {
 it('uses the shared directory links while keeping same-name notes distinct', () => {
  const graph = new GraphIndex([
   {...note('/'), kind: 'root', path: ''}, {...note('Topic', ['/']), kind: 'folder', path: 'Topic'},
   {...note('Topic/Topic.md',['Topic']), kind: 'note', notePath: 'Topic/Topic.md', links: ['Ref.md']},
   {...note('Ref.md',['/']), kind: 'note', notePath: 'Ref.md'},
  ]);
  const data = directoryGraphData(graph);
  expect(Object.keys(data.nodes)).toHaveLength(4);
  expect(data.nodes['Topic/Topic.md']!.links).toEqual({Topic: true, 'Ref.md': true});
  const local = graph.neighborhood('Topic/Topic.md',200,undefined,'/');
  expect(local.nodes.find(n=>n.id==='Ref.md')?.zone).toBe('jump');
 });
 it('excludes folded and capped nodes without mutating the input graph', () => {
  const graph = new GraphIndex([note('Root'),note('A',['Root']),note('B',['Root'])]);
  const snapshot = graph.neighborhood('Root',2,undefined,'Root');
  const hidden=hiddenNativeNodes(snapshot,new Set(['Root']));
  expect(hidden).toEqual(new Set(['A','B']));
  const base: NativeData={nodes:{Root:{type:'',links:{A:true,B:true}},A:{type:'',links:{}},B:{type:'',links:{}}}};
  expect(filteredGraphData(base,hidden).nodes).toEqual({Root:{type:'',links:{}}});
  expect(Object.keys(base.nodes)).toHaveLength(3);
 });
 it('builds local structure positions independently of unrelated notes', () => {
  const graph=new GraphIndex([note('Root'),note('Child',['Root']),note('Isolated')]);
  const snapshot=graph.neighborhood('Root');
  expect([...structuralNodes(snapshot).keys()]).toEqual(['Root','Child']);
  expect(structuralPositions(snapshot)).toEqual({Root:{x:0,y:0},Child:{x:0,y:120}});
 });
});

function portFixture(source = 'Outer') {
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const target = document.createElement('canvas');
  target.getBoundingClientRect = () => ({left: -1000, right: 1000, top: -1000, bottom: 1000}) as DOMRect;
  const core = new Map<string, GraphNode>([['Core', {id: 'Core', title: 'Core', zone: 'focus', issues: [], groupParents: []}]]);
  const callbacks = {onDrop: vi.fn(), onCreate: vi.fn()};
  Object.assign(canvas, {core, renderer: {interactiveEl: target, scale: 1, nodeLookup: {Core: {id: 'Core', x: 0, y: 0}, Outer: {id: 'Outer', x: -300, y: 0}}, highlightNode: null},
    element: {win: {devicePixelRatio: 1}}, hint: document.createElement('div'), callbacks,
    port: {id: source, side: 'bottom', start: {x: -300, y: 0}, pointerId: 1}, world: (event: MouseEvent) => ({x: event.clientX, y: event.clientY})});
  const end = (x: number, y: number) => {
    const event = new MouseEvent('pointerup', {clientX: x, clientY: y});
    Object.defineProperties(event, {pointerId: {value: 1}, target: {value: target}});
    (canvas as unknown as {endPort(event: PointerEvent): void}).endPort(event as PointerEvent);
  };
  return {canvas, callbacks, end};
}
describe('native port gestures', () => {
  it('connects an outer native dot to the bottom structural port', () => {
    const {callbacks, end} = portFixture(); end(0, 30);
    expect(callbacks.onDrop).toHaveBeenCalledExactlyOnceWith({focus: 'Core', target: 'Outer', kind: 'child'});
    expect(callbacks.onCreate).not.toHaveBeenCalled();
  });
  it('does not create notes by dragging outer connectors onto empty space', () => {
    const {callbacks, end} = portFixture(); end(400, 400);
    expect(callbacks.onDrop).not.toHaveBeenCalled(); expect(callbacks.onCreate).not.toHaveBeenCalled();
  });
  it('creates from a core port dropped onto blank canvas', () => {
    const {callbacks, end} = portFixture('Core'); end(400, 400);
    expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith('Core', 'child', {x: 400, y: 400});
  });
  it('Escape cancellation prevents a later pointerup from creating', () => {
    const {canvas, callbacks, end} = portFixture('Core');
    (canvas as unknown as {cancelPort(): void}).cancelPort(); end(400, 400);
    expect(callbacks.onCreate).not.toHaveBeenCalled();
  });
});

describe('center note keyboard creation', () => {
  function fixture() {
    const {canvas, callbacks} = portFixture('Core');
    Object.assign(canvas, {port: undefined, snapshot: {focus: 'Core'}, selected: 'Outer'});
    Object.assign(canvas.renderer, {panX: 400, panY: 300, scale: 2});
    Object.assign(canvas.element.win, {devicePixelRatio: 2});
    const view = Object.create(BrainView.prototype) as BrainView;
    Object.assign(view, {canvas, brain: {data: {settings: {shortcuts: defaultShortcuts()}}}});
    const press = (options: KeyboardEventInit, target: HTMLElement = document.createElement('canvas')) => {
      const event = new KeyboardEvent('keydown', {key: 'ArrowDown', ctrlKey: true, cancelable: true, ...options});
      Object.defineProperty(event, 'target', {value: target});
      view.handleShortcut(event);
      return event;
    };
    return {canvas, callbacks, press};
  }
  it.each([
    ['ArrowUp', 'parent', {x: -800, y: -880}],
    ['ArrowDown', 'child', {x: -800, y: -820}],
    ['ArrowLeft', 'jump', {x: -844, y: -850}],
    ['ArrowRight', 'sibling', {x: -756, y: -850}],
  ])('creates %s relative to the center at the visible port', (key, kind, point) => {
    const {callbacks, press} = fixture();
    expect(press({key: key as string}).defaultPrevented).toBe(true);
    expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith('Core', kind, point);
  });
  it('ignores typing, other modifiers, composition, repeats and active gestures', () => {
    const {canvas, callbacks, press} = fixture();
    for (const tag of ['input', 'textarea', 'select']) press({}, document.createElement(tag));
    const editable = document.createElement('div'); editable.contentEditable = 'true'; editable.setAttribute('contenteditable', 'true');
    const child = editable.appendChild(document.createElement('span')); press({}, child);
    for (const options of [{ctrlKey: false}, {altKey: true}, {shiftKey: true}, {metaKey: true}, {isComposing: true}, {repeat: true}]) press(options);
    Object.assign(canvas, {port: {id: 'Core'}}); press({});
    expect(callbacks.onCreate).not.toHaveBeenCalled();
  });
  it('removes folded nodes and every native link pointing to them', () => {
    const data: NativeData = {nodes: {A: {type: '', links: {Hidden: true}}, Hidden: {type: '', links: {A: true}}}};
    const filtered = filteredGraphData(data, new Set(['Hidden']));
    expect(filtered.nodes).toEqual({A: {type: '', links: {}}});
    expect(data.nodes.Hidden).toBeDefined();
  });
});

describe('native connector visibility', () => {
  it('shows connector circles on hover and while choosing a connection target', () => {
    expect(showPorts(true, false, false, false)).toBe(false);
    expect(showPorts(false, false, false, false)).toBe(false);
    expect(showPorts(true, true, false, false)).toBe(true);
    expect(showPorts(false, true, false, false)).toBe(true);
    expect(showPorts(true, false, true, false)).toBe(false);
    expect(showPorts(true, true, true, false)).toBe(true);
    expect(showPorts(false, true, true, false)).toBe(false);
    expect(showPorts(false, false, true, true)).toBe(true);
    expect(showPorts(false, false, true, false)).toBe(false);
  });
});

 it('releases both renderer and worker pins when a structural node becomes a native dot', () => {
  const graph = new GraphIndex([note('Root'), note('Middle', ['Root']), note('Leaf', ['Middle'])]);
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const root = {fx: -376, fy: 50}, postMessage = vi.fn();
  Object.assign(canvas, {core: structuralNodes(graph.neighborhood('Root')), snapshot: graph.neighborhood('Root'),
    expandedGroups: new Set(), hidden: new Set(), pinned: new Set(), restoredPositions: {}, groupToggles: [], groupLabels: [],
    renderer: {nodeLookup: {Root: root}, worker: {postMessage}, changed: vi.fn()},
    element: {win: {devicePixelRatio: 1}}, cancelPort: vi.fn(), updateData: vi.fn(), renderOverlay: vi.fn(),
    overflow: {hidden: true, textContent: ''}, fit: vi.fn()});
  canvas.render(graph.neighborhood('Leaf'));
  expect(root).toEqual({fx: null, fy: null});
  expect(postMessage).toHaveBeenCalledWith({forceNode: {id: 'Root', x: null, y: null}, alpha: .3, run: true});
 });

it('folds structural child groups to six nodes before rendering the native graph', () => {
  const records = [note('Root'), ...Array.from({length: 8}, (_, index) => note(`Child-${index}`, ['Root']))];
  const graph = new GraphIndex(records), snapshot = graph.neighborhood('Root');
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  Object.assign(canvas, {core: new Map(), expandedGroups: new Set(), hidden: new Set(), pinned: new Set(), restoredPositions: {}, groupToggles: [], groupLabels: [],
    renderer: {nodeLookup: {}, worker: {postMessage: vi.fn()}, changed: vi.fn()}, element: {win: {devicePixelRatio: 1}},
    cancelPort: vi.fn(), updateData: vi.fn(), renderOverlay: vi.fn(), overflow: {hidden: true, textContent: ''}, fit: vi.fn()});
  canvas.render(snapshot);
  expect([...canvas.core.keys()]).toHaveLength(7);
  expect((canvas as unknown as {hidden: Set<string>}).hidden.size).toBe(2);
  expect((canvas as unknown as {groupToggles: {key: string; hidden: number}[]}).groupToggles)
    .toEqual([expect.objectContaining({key: 'child:Root', hidden: 2})]);
});
