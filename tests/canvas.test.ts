// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphIndex } from '../src/graph';
import { GraphCanvas } from '../src/ui/canvas';
import { computeLayout, edgePath, nodeSize } from '../src/ui/canvas/layout';
import type { CanvasCallbacks, Neighborhood, NoteRecord, Point } from '../src/model/types';

const note = (id: string, props: Partial<NoteRecord> = {}): NoteRecord => ({id, title: id, parents: [], links: [], issues: [], ...props});
const fixture = () => new GraphIndex([note('F', {parents: ['P'], links: ['J']}), note('P'), note('J'),
  note('C', {parents: ['F']}), note('S', {parents: ['P']}), note('O', {title: '一篇需要完整显示标题但不能撑开节点的长笔记'})]);
let canvas: GraphCanvas | undefined;
const callbacks = (): CanvasCallbacks => ({onFocus: vi.fn(), onOpen: vi.fn(), onDrop: vi.fn(), onConnect: vi.fn(),
  onEdgeContext: vi.fn(), onCreate: vi.fn(), onNewNote: vi.fn(), onContext: vi.fn(), onLayout: vi.fn(), onOverflow: vi.fn()});
function snapshotFor(graph: GraphIndex): Neighborhood {
 const snapshot = graph.neighborhood('F');
 for(const note of graph.all()) if(!graph.parents(note.id).length && !graph.children(note.id).length && !graph.linked(note.id).length && note.id!=='F') {
  snapshot.nodes.push({...note,zone:'outer',groupParents:[]}); snapshot.counts.outer++;
 }
 snapshot.overflow.push(...snapshot.nodes.slice(200)); snapshot.nodes=snapshot.nodes.slice(0,200);
 return snapshot;
}
function mount(graph = fixture()) {
  const host = document.createElement('div'); document.body.append(host);
  const calls = callbacks(); canvas = new GraphCanvas(host, calls);
  canvas.element.getBoundingClientRect = () => ({left: 0, top: 0, right: 1440, bottom: 944, width: 1440, height: 944, x: 0, y: 0, toJSON: () => ({})});
  canvas.render(snapshotFor(graph));
  return {view: canvas, calls, graph, body: (id: string) => host.querySelector<HTMLButtonElement>(`[data-node-id="${id}"] .brain-node-body`)!};
}
function pointer(target: EventTarget, type: string, point: Point) {
  const event = new MouseEvent(type, {bubbles: true, button: 0, clientX: point.x, clientY: point.y});
  Object.defineProperty(event, 'pointerId', {value: 1}); target.dispatchEvent(event);
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {configurable: true, value: () => ({matches: true})});
});
afterEach(() => {canvas?.destroy(); canvas = undefined; document.body.replaceChildren(); vi.useRealTimers();});

describe('four-direction canvas', () => {
  it.each([{x: 0, y: -180}, {x: 0, y: 180}, {x: -180, y: 0}, {x: 180, y: 0}])('does not create from a focus body drag %o', delta => {
    const {view, body, calls} = mount();
    pointer(body('F'), 'pointerdown', {x: 720, y: 472});
    pointer(view.element, 'pointermove', {x: 720 + delta.x, y: 472 + delta.y});
    pointer(view.element, 'pointerup', {x: 720 + delta.x, y: 472 + delta.y});
    expect(calls.onCreate).not.toHaveBeenCalled();
    expect(calls.onDrop).not.toHaveBeenCalled();
    expect(view.getLayout().positions.F).toEqual({x: 0, y: 0});
    expect(view.getLayout().pinned).not.toContain('F');
  });
  it('dispatches the exact relationship from a line context menu', () => {
    const {view, calls} = mount();
    const edge = view.element.querySelector('.brain-edge-hierarchy') as SVGElement;
    edge.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true}));
    expect(calls.onEdgeContext).toHaveBeenCalledWith({source: edge.dataset.source, target: edge.dataset.target, kind: 'hierarchy'}, expect.any(MouseEvent));
    expect(calls.onContext).not.toHaveBeenCalled();
  });

  it('collapses each parent group independently and preserves expanded state on refresh', () => {
    const graph = new GraphIndex([note('F', {parents: ['P', 'Q']}), note('P'), note('Q')]);
    for (const parent of ['F', 'P', 'Q']) for (let i = 0; i < 9; i++) graph.upsert(note(`${parent}-${i}`, {parents: [parent]}));
    const {view, calls} = mount(graph);
    const count = (parent: string) => view.element.querySelectorAll(`[data-node-id^="${parent}-"]`).length;
    const button = (key: string) => view.element.querySelector<HTMLButtonElement>(`[data-group-key="${key}"]`)!;
    expect(count('F')).toBe(6); expect(count('P')).toBe(6); expect(count('Q')).toBe(6);
    expect(button('sibling:P').textContent).toBe('展开另外 3 个');
    expect(view.element.querySelector('[data-source="P"][data-target="P-8"]')).toBeNull();
    const viewport = view.getLayout().viewport;
    pointer(button('sibling:P'), 'pointerdown', {x: 900, y: 600});
    pointer(button('sibling:P'), 'pointerup', {x: 900, y: 600});
    button('sibling:P').click();
    expect(count('P')).toBe(9); expect(count('Q')).toBe(6); expect(count('F')).toBe(6);
    expect(button('sibling:P').getAttribute('aria-expanded')).toBe('true');
    expect(view.element.querySelector('[data-source="P"][data-target="P-8"]')).not.toBeNull();
    view.render(snapshotFor(graph), view.getLayout());
    expect(count('P')).toBe(9);
    button('sibling:P').click();
    expect(count('P')).toBe(6);
    button('child:F').click();
    expect(count('F')).toBe(9);
    expect(view.getLayout().viewport).toEqual(viewport);
    expect(calls.onFocus).not.toHaveBeenCalled(); expect(calls.onNewNote).not.toHaveBeenCalled();
    expect(calls.onDrop).not.toHaveBeenCalled(); expect(calls.onCreate).not.toHaveBeenCalled();
  });
  it('opens standalone creation on a blank canvas double-click without changing focus', () => {
    const {view, calls} = mount();
    view.element.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    expect(calls.onNewNote).toHaveBeenCalledOnce();
    expect(calls.onFocus).not.toHaveBeenCalled();
    expect(calls.onOpen).not.toHaveBeenCalled();
    expect(view.getFocus()).toBe('F');
  });
  it('does not create on nodes, connectors, zoom controls, or while connecting', () => {
    const {view, calls, body} = mount();
    for (const target of [body('C'), view.element.querySelector('[data-port]')!, view.element.querySelector('.brain-zoom button')!]) {
      target.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    }
    view.element.querySelector<HTMLButtonElement>('[data-node-id="F"] [data-port="right"]')!.click();
    view.element.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    expect(calls.onNewNote).not.toHaveBeenCalled();
    expect(calls.onOpen).toHaveBeenCalledExactlyOnceWith('C');
  });
  it('orders sibling groups by parent position instead of sibling titles', () => {
    const graph = new GraphIndex([note('F', {parents: ['Left', 'Right']}), note('Left', {title: 'A'}), note('Right', {title: 'B'}),
      note('Upper', {title: 'Z', parents: ['Left']}), note('Lower', {title: 'A', parents: ['Right']})]);
    const {positions} = computeLayout(snapshotFor(graph));
    expect(positions.Left!.x).toBeLessThan(positions.Right!.x);
    expect(positions.Upper!.y).toBeLessThan(positions.Lower!.y);
  });

  it('uses directional slots and routes siblings from their actual parent', () => {
    const view = fixture().neighborhood('F'); const {positions} = computeLayout(view);
    expect(positions.P!.y).toBeLessThan(0); expect(positions.C!.y).toBeGreaterThan(0);
    expect(positions.J!.x).toBeLessThan(0); expect(positions.S!.x).toBeGreaterThan(0);
    expect(view.edges).toContainEqual({source: 'P', target: 'S', kind: 'hierarchy'});
    const p = view.nodes.find(n => n.id === 'P')!, s = view.nodes.find(n => n.id === 'S')!;
    const path = edgePath(positions.P!, positions.S!, p, s, 'hierarchy');
    expect(path).toContain(' C '); expect(path.startsWith(`M ${positions.P!.x + nodeSize(p).width / 2} ${positions.P!.y} `)).toBe(true);
  });

  it('renders four core connectors and only one right outer connector, without relationship zone labels', () => {
    const {view, body} = mount(); const outer = body('O').parentElement!;
    for (const node of view.element.querySelectorAll('.brain-node')) {
      const sides = node.classList.contains('brain-node-outer') ? ['right'] : ['top', 'bottom', 'left', 'right'];
      expect([...node.querySelectorAll<HTMLElement>('[data-action="connect"]')].map(gate => gate.dataset.port)).toEqual(sides);
    }
    expect(view.element.querySelector('.brain-zone-label')).toBeNull();
    expect(outer.title).toContain('一篇需要完整显示标题'); expect(outer.title).toContain('O');
    expect(outer.querySelector('.brain-node-dot')).not.toBeNull();
    expect(outer.style.width).toBe('132px'); expect(view.element.querySelector('[data-source="O"], [data-target="O"]')).toBeNull();
  });
  it('opens outer notes immediately on a single click and never centers them', () => {
    const {body, calls} = mount();
    body('O').dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
    expect(calls.onOpen).toHaveBeenCalledExactlyOnceWith('O');
    body('O').dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 2}));
    body('O').dispatchEvent(new MouseEvent('dblclick', {bubbles: true, detail: 2}));
    vi.advanceTimersByTime(300);
    expect(calls.onOpen).toHaveBeenCalledTimes(1);
    expect(calls.onFocus).not.toHaveBeenCalled();
    body('O').click();
    expect(calls.onOpen).toHaveBeenCalledTimes(2);
    body('C').click(); expect(calls.onFocus).toHaveBeenCalledExactlyOnceWith('C');
  });
  it('does not replace a core double-click target while metadata refreshes', () => {
    const {view, body, calls, graph} = mount(); const original = body('C');
    original.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
    graph.upsert(note('New')); view.render(snapshotFor(graph));
    expect(body('C')).toBe(original);
    original.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, detail: 2}));
    expect(calls.onOpen).toHaveBeenCalledWith('C'); expect(calls.onFocus).not.toHaveBeenCalled();
  });
  it('repositions outer node bodies even in a relationship region, and cancels cleanly', () => {
    const {view, body, calls} = mount();
    const start = view.getLayout().positions.O!;
    const screen = (p: Point) => ({x: 720 + p.x, y: 472 + p.y});
    pointer(body('O'), 'pointerdown', screen(start)); pointer(window, 'pointermove', screen({x: -550, y: 300}));
    pointer(window, 'pointerup', screen({x: -550, y: 300}));
    expect(calls.onDrop).not.toHaveBeenCalled(); expect(view.getLayout().pinned).toContain('O');
    body('O').click(); expect(calls.onOpen).not.toHaveBeenCalled();
    pointer(body('O'), 'pointerdown', screen({x: -550, y: 300})); pointer(window, 'pointermove', screen({x: 0, y: 176}));
    pointer(window, 'pointerup', screen({x: 0, y: 176}));
    expect(calls.onDrop).not.toHaveBeenCalled();
    expect(view.getLayout().positions.O).toEqual({x: 0, y: 176});
    expect(view.element.querySelector('.brain-drop-zones')).toBeNull();
    const previous = view.getLayout().positions.O!;
    pointer(body('O'), 'pointerdown', screen(previous)); pointer(window, 'pointermove', screen({x: -550, y: 400}));
    view.element.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Escape'}));
    expect(view.getLayout().positions.O).toEqual(previous); expect(calls.onDrop).not.toHaveBeenCalled();
  });
  it.each([['top', 'parent'], ['bottom', 'child'], ['left', 'jump'], ['right', 'sibling']])('connects to the %s port as %s without moving the source', (side, kind) => {
    const {view, calls} = mount();
    const source = view.element.querySelector('[data-node-id="O"] [data-action="connect"]')!;
    const target = view.element.querySelector(`[data-node-id="F"] [data-port="${side}"]`)!;
    const previous = view.getLayout().positions.O;
    pointer(source, 'pointerdown', {x: 200, y: 200});
    pointer(target, 'pointermove', {x: 720, y: 472});
    expect(target.classList.contains('is-port-target')).toBe(true);
    expect(view.element.classList.contains('is-connecting')).toBe(true);
    pointer(target, 'pointerup', {x: 720, y: 472});
    expect(calls.onDrop).toHaveBeenCalledExactlyOnceWith({focus: 'F', target: 'O', kind});
    expect(calls.onConnect).not.toHaveBeenCalled();
    expect(view.getLayout().positions.O).toEqual(previous);
    expect(view.element.querySelector('.is-port-target')).toBeNull();
  });
  it.each(['top', 'bottom', 'left', 'right'])('starts connections from the %s core port without moving or creating a note', side => {
    const {view, calls} = mount();
    const source = view.element.querySelector(`[data-node-id="F"] [data-port="${side}"]`)!;
    const target = view.element.querySelector('[data-node-id="C"] [data-port="top"]')!;
    const previous = view.getLayout().positions.F;
    pointer(source, 'pointerdown', {x: 720, y: 472});
    pointer(target, 'pointermove', {x: 720, y: 624});
    pointer(target, 'pointerup', {x: 720, y: 624});
    expect(calls.onDrop).toHaveBeenCalledExactlyOnceWith({focus: 'C', target: 'F', kind: 'parent'});
    expect(calls.onCreate).not.toHaveBeenCalled();
    expect(view.getLayout().positions.F).toEqual(previous);
  });
  it('connects to any core node using keyboard ports without changing focus', () => {
    const {view, calls} = mount();
    view.element.querySelector<HTMLButtonElement>('[data-node-id="O"] [data-action="connect"]')!.click();
    view.element.querySelector<HTMLButtonElement>('[data-node-id="C"] [data-port="bottom"]')!.click();
    expect(calls.onDrop).toHaveBeenCalledExactlyOnceWith({focus: 'C', target: 'O', kind: 'child'});
    expect(calls.onFocus).not.toHaveBeenCalled();
  });
  it.each(['F', 'C'])('creates notes from all four ports of %s when released on blank canvas', id => {
    const {view, calls} = mount();
    const previous = view.getLayout().positions[id];
    for (const [side, kind] of [['top', 'parent'], ['bottom', 'child'], ['left', 'jump'], ['right', 'sibling']]) {
      const source = view.element.querySelector(`[data-node-id="${id}"] [data-port="${side}"]`)!;
      pointer(source, 'pointerdown', {x: 720, y: 472});
      pointer(view.element, 'pointermove', {x: 950, y: 750});
      expect(view.element.querySelector('.brain-canvas-hint')!.textContent).toContain('创建新笔记');
      pointer(view.element, 'pointerup', {x: 950, y: 750});
      expect(calls.onCreate).toHaveBeenLastCalledWith(id, kind, {x: 950, y: 750});
    }
    expect(calls.onCreate).toHaveBeenCalledTimes(4);
    expect(calls.onDrop).not.toHaveBeenCalled();
    expect(view.getLayout().positions[id]).toEqual(previous);
  });
  it('does not create from short drags, outer connectors, or releases outside the canvas', () => {
    const {view, calls} = mount();
    for (const [id, target, end] of [
      ['F', view.element, {x: 730, y: 480}],
      ['O', view.element, {x: 950, y: 750}],
      ['F', document.body, {x: 950, y: 750}],
    ] as const) {
      const source = view.element.querySelector(`[data-node-id="${id}"] [data-port="right"]`)!;
      pointer(source, 'pointerdown', {x: 720, y: 472});
      pointer(target, 'pointermove', end);
      pointer(target, 'pointerup', end);
    }
    expect(calls.onCreate).not.toHaveBeenCalled();
  });
  it('ignores bodies, self connections and outer targets; Escape cancels a connection', () => {
    const {view, body, calls} = mount();
    const source = view.element.querySelector('[data-node-id="F"] [data-action="connect"]')!;
    for (const target of [body('C'), source, view.element.querySelector('[data-node-id="O"] [data-port="right"]')!]) {
      pointer(source, 'pointerdown', {x: 720, y: 442});
      pointer(target, 'pointermove', {x: 200, y: 200});
      pointer(target, 'pointerup', {x: 200, y: 200});
    }
    pointer(source, 'pointerdown', {x: 720, y: 442});
    pointer(view.element, 'pointermove', {x: 200, y: 200});
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    pointer(view.element, 'pointerup', {x: 200, y: 200});
    expect(calls.onDrop).not.toHaveBeenCalled(); expect(calls.onCreate).not.toHaveBeenCalled();
    expect(view.element.classList.contains('is-connecting')).toBe(false);
  });
  it('anchors the preview at ports at non-default zoom and defers metadata updates until release', () => {
    const {view, calls, graph} = mount();
    view.setZoom(1.5);
    const source = view.element.querySelector('[data-node-id="O"] [data-action="connect"]')!;
    const target = view.element.querySelector('[data-node-id="F"] [data-port="bottom"]')!;
    const origin = view.getLayout().positions.O!;
    pointer(source, 'pointerdown', {x: 720 + (origin.x + 16) * 1.5, y: 472 + (origin.y - 16) * 1.5});
    pointer(target, 'pointermove', {x: 720, y: 517});
    const focus = snapshotFor(graph).nodes.find(n => n.id === 'F')!;
    const preview = view.element.querySelector('.brain-connection-preview')?.getAttribute('d');
    const start = preview?.match(/^M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) C /);
    expect(Number(start?.[1])).toBeCloseTo(origin.x + 16);
    expect(Number(start?.[2])).toBeCloseTo(origin.y - 16);
    expect(preview?.endsWith(`, 0 ${nodeSize(focus).height / 2}`)).toBe(true);
    graph.upsert(note('New')); view.render(snapshotFor(graph));
    expect(view.element.querySelector('[data-node-id="New"]')).toBeNull();
    pointer(target, 'pointerup', {x: 720, y: 517});
    expect(calls.onDrop).toHaveBeenCalledExactlyOnceWith({focus: 'F', target: 'O', kind: 'child'});
    expect(view.element.querySelector('[data-node-id="New"]')).not.toBeNull();
  });
  it('keeps the initial core readable and restores saved zoom and positions', () => {
    const graph = fixture(); for (let i = 0; i < 240; i++) graph.upsert(note(`Outer ${i}`));
    const {view} = mount(graph);
    expect(view.getLayout().viewport!.scale).toBeGreaterThanOrEqual(.75);
    expect(view.element.querySelectorAll('.brain-node')).toHaveLength(200);
    view.fit(); expect(view.getLayout().viewport!.scale).toBeLessThan(.75);
    view.setZoom(1.2); expect(view.element.querySelector('.brain-zoom')?.textContent).toContain('120%');
    const state = view.getLayout(); view.render(snapshotFor(graph), state);
    expect(view.getLayout().viewport).toEqual(state.viewport);
    view.zoomBy(100); expect(view.getLayout().viewport!.scale).toBe(3);
  });
  it('places auto-arranged notes without overlap and preserves pinned positions', () => {
    const graph = fixture(); for (let i = 0; i < 193; i++) graph.upsert(note(`O${i}`));
    const snapshot = snapshotFor(graph); const layout = computeLayout(snapshot, {positions: {O: {x: -1000, y: 120}}, pinned: ['O']});
    expect(layout.positions.O).toEqual({x: -1000, y: 120});
    for (let i = 0; i < snapshot.nodes.length; i++) for (let j = i + 1; j < snapshot.nodes.length; j++) {
      const a = snapshot.nodes[i]!, b = snapshot.nodes[j]!, pa = layout.positions[a.id]!, pb = layout.positions[b.id]!;
      const sa = nodeSize(a), sb = nodeSize(b);
      expect(Math.abs(pa.x - pb.x) >= (sa.width + sb.width) / 2 || Math.abs(pa.y - pb.y) >= (sa.height + sb.height) / 2).toBe(true);
    }
  });
});
