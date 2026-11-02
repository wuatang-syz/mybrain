// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {GraphIndex} from '../src/graph';
import type {NoteRecord, Point} from '../src/model/types';
import {relationWindowLayout, windowSource} from '../src/ui/canvas/windows';
import {WindowControls} from '../src/ui/canvas/window-controls';
import {nodeSize} from '../src/ui/canvas/node-size';
import {loadBrainData} from '../src/settings';
import {DEFAULT_MIND_MAP} from '../src/mind-map-settings';
import {NativeGraphCanvas} from '../src/ui/native-graph';
import {edgeCurves, edgeGeometry} from '../src/ui/native-graph/edges';
import type {NativeRenderer} from '../src/ui/native-graph/types';

const note = (id: string, parents: string[] = []): NoteRecord => ({id, title: id, parents, links: [], issues: []});
const catalog = () => new GraphIndex([note('Root'), note('AI', ['Root']),
  ...Array.from({length: 280}, (_, i) => note(`Sibling ${String(i).padStart(3, '0')}`, ['Root'])),
  ...Array.from({length: 32}, (_, i) => note(`Child ${String(i).padStart(2, '0')}`, ['AI']))]);
const size = {width: 1200, height: 650};

describe('transparent relation windows', () => {
  it('shows children in two rows, keeps both inside the canvas and scrolls to every child', () => {
    const source = windowSource(catalog().neighborhood('AI'));
    const first = relationWindowLayout(source, size, {child: 0});
    const area = first.windows.find(w => w.zone === 'child')!;
    const children = first.snapshot.nodes.filter(n => n.zone === 'child');
    expect(children.length).toBeGreaterThanOrEqual(8);
    expect(first.positions['Child 00']!.x).toBe(first.positions['Child 01']!.x);
    expect(first.positions['Child 01']!.y - first.positions['Child 00']!.y).toBeGreaterThan(48);
    expect(area.y + area.height + 10).toBeLessThan(size.height / 2);
    const seen = new Set<string>();
    for (let offset = 0; offset <= area.max + 30; offset += 30) {
      const layout = relationWindowLayout(source, size, {child: offset});
      expect(Object.values(layout.childRoutes).filter(route => route.drawTrunk)).toHaveLength(1);
      const boxes = layout.snapshot.nodes.filter(n => n.zone === 'child').map(node => {
        seen.add(node.id); return {...layout.positions[node.id]!, ...nodeSize(node)};
      });
      for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) {
        const a = boxes[i]!;
        expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2).toBe(true);
      }
    }
    expect(seen.size).toBe(32);
    const lower = first.snapshot.nodes.find(n => n.id === 'Child 01')!;
    const core = new Map(first.snapshot.nodes.map(n => [n.id, n]));
    const renderer = {nodeLookup: Object.fromEntries(Object.entries(first.positions).map(([id, p]) => [id, {id, ...p}]))} as unknown as NativeRenderer;
    const route = first.childRoutes[lower.id]!;
    const upperRoute = first.childRoutes['Child 00']!;
    expect(route).toMatchObject({x: upperRoute.x, drawStem: false});
    expect(upperRoute.drawStem).toBe(true);
    expect(route.x).toBe(first.positions[lower.id]!.x);
    expect(route.y).toBe(first.positions['Child 00']!.y + nodeSize(lower).height / 2);
    const geometry = edgeGeometry(renderer, {source: 'AI', target: lower.id, kind: 'hierarchy'}, core, DEFAULT_MIND_MAP, route)!;
    expect(geometry.via).toEqual(route);
    expect(upperRoute.y).toBeLessThan(area.y);
    expect(geometry.to.x).toBe(first.positions[lower.id]!.x);
    expect(geometry.to.y).toBe(first.positions[lower.id]!.y - nodeSize(lower).height / 2);
    const curves = edgeCurves(geometry);
    expect(curves).toHaveLength(1);
    for (const control of curves[0]!.controls) expect(control.x).toBe(route.x);
    expect(curves[0]!.controls[0].y).toBeGreaterThan(route.y);
    expect(curves[0]!.controls[1].y).toBeLessThan(geometry.to.y);
    const trunkStarts: Point[] = [];
    expect(Object.values(first.childRoutes).filter(route => route.drawTrunk)).toHaveLength(1);
    // Every upper branch starts vertically at the same trunk endpoint.
    for (const child of children.filter(n => first.childRoutes[n.id]!.drawStem)) {
      const upper = edgeGeometry(renderer, {source: 'AI', target: child.id, kind: 'hierarchy'}, core,
        DEFAULT_MIND_MAP, first.childRoutes[child.id])!;
      const [arch] = edgeCurves(upper);
      expect(edgeCurves(upper)).toHaveLength(1);
      const [a, b] = arch!.controls;
      const start = upper.trunk!.to;
      trunkStarts.push(start);
      expect(start.x).toBe(upper.from.x);
      expect(start.y - upper.from.y).toBeGreaterThanOrEqual(10);
      expect(start.y - upper.from.y).toBeLessThanOrEqual(24);
      expect(a.x).toBe(start.x);
      expect(b.x).toBe(upper.to.x);
      expect(a.y).toBeGreaterThan(start.y);
      expect(b.y).toBeGreaterThan(a.y);
      expect(b.y).toBeLessThan(upper.to.y);
    }
    expect(trunkStarts.every(point => point.x === trunkStarts[0]!.x && point.y === trunkStarts[0]!.y)).toBe(true);
  });
  it('centers the sibling window on its parent and keeps the top labels inside the canvas', () => {
    const source = windowSource(catalog().neighborhood('AI'));
    for (const viewport of [size, {width: 980, height: 630}, {width: 360, height: 500}]) {
      for (const fontSize of [12, 16, 24]) {
        const layout = relationWindowLayout(source, viewport, {}, {...DEFAULT_MIND_MAP, fontSize});
        const area = layout.windows.find(w => w.zone === 'sibling')!;
        expect(area.y + area.height / 2).toBeCloseTo(layout.positions.Root!.y);
        expect(area.y - 26).toBeGreaterThanOrEqual(-layout.height / 2);
        const ys = layout.snapshot.nodes.filter(n => n.zone === 'sibling').map(n => layout.positions[n.id]!.y);
        for (const node of layout.snapshot.nodes.filter(n => n.zone === 'sibling')) {
          expect(layout.positions[node.id]!.x - nodeSize(node, {...DEFAULT_MIND_MAP, fontSize}).width / 2).toBeCloseTo(area.x + 12);
        }
        expect(ys).toHaveLength(7);
        expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(layout.positions.Root!.y);
        const childArea = layout.windows.find(w => w.zone === 'child')!;
        expect(childArea.y - 16 - (area.y + area.height)).toBeGreaterThanOrEqual(30);
      }
    }
  });
  it('mirrors sibling alignment and spacing while centering associated notes on the focus', () => {
    const graph = new GraphIndex([note('Root'), {...note('AI', ['Root']), links: ['Short', 'A much longer associated title']},
      note('Other', ['Root']), note('Short'), note('A much longer associated title')]);
    const source = windowSource(graph.neighborhood('AI'));
    for (const fontSize of [12, 16, 24]) for (const spacing of ['compact', 'standard', 'spacious'] as const) {
      const settings = {...DEFAULT_MIND_MAP, fontSize, spacing};
      const layout = relationWindowLayout(source, size, {}, settings);
      const area = layout.windows.find(w => w.zone === 'jump')!;
      const sibling = layout.windows.find(w => w.zone === 'sibling')!;
      const nodes = layout.snapshot.nodes.filter(n => n.zone === 'jump');
      expect(nodes).toHaveLength(2);
      expect(area.y + area.height / 2).toBe(layout.positions.AI!.y);
      const ys = nodes.map(n => layout.positions[n.id]!.y);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(layout.positions.AI!.y);
      for (const node of nodes) {
        const p = layout.positions[node.id]!, s = nodeSize(node, settings);
        expect(p.x + s.width / 2).toBeCloseTo(area.x + area.width - 12);
        expect(p.x + s.width / 2).toBeCloseTo(-sibling.x - 12);
      }
      const gap = {compact: 8, standard: 10, spacious: 14}[spacing];
      expect(Math.abs(ys[0]! - ys[1]!)).toBe(nodeSize(nodes[0]!, settings).height + gap);
      expect(area.max).toBe(0);
    }
  });
  it('keeps seven complete associated notes centered and makes every association reachable by scrolling', () => {
    const targets = Array.from({length: 23}, (_, i) => `Associated ${String(i).padStart(2, '0')}`);
    const graph = new GraphIndex([{...note('AI'), links: targets}, ...targets.map(id => note(id))]);
    const source = windowSource(graph.neighborhood('AI', 20));
    for (const viewport of [size, {width: 360, height: 500}]) for (const fontSize of [12, 16, 24]) {
      const settings = {...DEFAULT_MIND_MAP, fontSize};
      const first = relationWindowLayout(source, viewport, {}, settings);
      const area = first.windows.find(w => w.zone === 'jump')!;
      expect(area.y - 26).toBeGreaterThanOrEqual(-first.height / 2);
      expect(area.y + area.height).toBeLessThanOrEqual(first.height / 2);
      const seen = new Set<string>();
      for (let offset = 0; offset <= area.max + 20; offset += 20) {
        const layout = relationWindowLayout(source, viewport, {jump: offset}, settings);
        const nodes = layout.snapshot.nodes.filter(n => n.zone === 'jump');
        expect(nodes).toHaveLength(7);
        const ys = nodes.map(n => layout.positions[n.id]!.y);
        expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0);
        expect(layout.positions.AI).toEqual(first.positions.AI);
        for (const node of nodes) {
          seen.add(node.id);
          expect(layout.opacity[node.id]).toBe(1);
          expect(layout.positions[node.id]!.x + nodeSize(node, settings).width / 2).toBeCloseTo(area.x + area.width - 12);
          expect(layout.snapshot.edges).toContainEqual({source: 'AI', target: node.id, kind: 'jump'});
        }
      }
      expect(seen.size).toBe(targets.length);
      const last = relationWindowLayout(source, viewport, {jump: 1e9}, settings);
      expect(last.offsets.jump).toBe(area.max);
      expect(last.positions[targets[targets.length - 1]!]).toBeDefined();
    }
  });
  it('starts overflowing children at the middle and centers small child groups under the focus', () => {
    const source = windowSource(catalog().neighborhood('AI'));
    for (const viewport of [size, {width: 360, height: 500}]) {
      const layout = relationWindowLayout(source, viewport);
      const area = layout.windows.find(w => w.zone === 'child')!;
      expect(area.x + area.width / 2).toBeCloseTo(layout.positions.AI!.x);
      expect(area.max).toBeGreaterThan(0);
      const children = layout.snapshot.nodes.filter(n => n.zone === 'child');
      expect(children.length).toBeGreaterThanOrEqual(6);
      const edges = children.map(n => ({x: layout.positions[n.id]!.x, width: nodeSize(n).width}));
      expect((Math.min(...edges.map(n => n.x - n.width / 2)) + Math.max(...edges.map(n => n.x + n.width / 2))) / 2).toBeCloseTo(0);
      expect(relationWindowLayout(source, viewport, {child: 0}).positions['Child 00']).toBeDefined();
    }
    const small = new GraphIndex([note('AI'), note('Short', ['AI']), note('A much longer title', ['AI']), note('Third', ['AI'])]);
    const layout = relationWindowLayout(windowSource(small.neighborhood('AI')), size);
    const boxes = layout.snapshot.nodes.filter(n => n.zone === 'child').map(n => ({x: layout.positions[n.id]!.x, width: nodeSize(n).width}));
    expect((Math.min(...boxes.map(n => n.x - n.width / 2)) + Math.max(...boxes.map(n => n.x + n.width / 2))) / 2).toBeCloseTo(0);
    const varied = new GraphIndex([note('AI'), ...[18, 10, 10, 24, 8, 20].flatMap((length, column) =>
      [note(`${column} ${'x'.repeat(length)}`, ['AI']), note(`${column} lower`, ['AI'])])]);
    const centered = relationWindowLayout(windowSource(varied.neighborhood('AI')), {width: 980, height: 630});
    const visible = centered.snapshot.nodes.filter(n => n.zone === 'child');
    expect(visible.length).toBeGreaterThanOrEqual(6);
    const bounds = visible.map(n => ({x: centered.positions[n.id]!.x, width: nodeSize(n).width}));
    expect((Math.min(...bounds.map(n => n.x - n.width / 2)) + Math.max(...bounds.map(n => n.x + n.width / 2))) / 2).toBeCloseTo(0);
  });
  it('integrates native scrolling and restores the independent offsets when returning to a focus', () => {
    const graph = catalog(), canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
    const onLayout = vi.fn();
    Object.assign(canvas, {core: new Map(), positions: {}, order: [], expandedGroups: new Set(), hidden: new Set(), pinned: new Set(),
      windowControls: {cancel: vi.fn()}, windowOffsets: {}, windowHistory: new Map(), settings: {...DEFAULT_MIND_MAP},
      element: {win: {devicePixelRatio: 1}}, callbacks: {onLayout}, cancelPort: vi.fn(), updateData: vi.fn(), renderOverlay: vi.fn(), overflow: {},
      renderer: {width: 1200, height: 650, nodes: [], nodeLookup: {}, panX: 600, panY: 325, targetScale: 1,
        worker: {postMessage: vi.fn()}, changed: vi.fn(), setPan: vi.fn(), setScale: vi.fn(), zoomTo: vi.fn()}});
    const snapshot = graph.neighborhood('AI', 30);
    canvas.render(snapshot);
    const initial = structuredClone(canvas.positions);
    const scroll = (zone: 'child' | 'sibling', offset: number) =>
      (canvas as unknown as {scrollWindow(zone: string, offset: number): void}).scrollWindow(zone, offset);
    scroll('sibling', 530); scroll('child', 160);
    expect(canvas.positions.AI).toEqual(initial.AI);
    expect(canvas.positions.Root).toEqual(initial.Root);
    expect(canvas.getLayout().windows).toMatchObject({sibling: 530, child: 160});
    expect(onLayout).toHaveBeenCalledTimes(2);
    canvas.render(graph.neighborhood('Root'));
    canvas.render(snapshot);
    expect(canvas.getLayout().windows).toMatchObject({sibling: 530, child: 160});
    expect(canvas.core.size).toBeLessThan(26);
    expect(canvas.renderer.setPan).toHaveBeenLastCalledWith(600, 325);
  });
  it('browses every sibling beyond the node cap while holding focus, parent and children still', () => {
    const graph = catalog(), source = windowSource(graph.neighborhood('AI', 30));
    expect(source.nodes.filter(n => n.zone === 'sibling')).toHaveLength(280);
    const first = relationWindowLayout(source, size);
    const max = first.windows.find(w => w.zone === 'sibling')!.max;
    const seen = new Set<string>();
    for (let offset = 0; offset <= max + 40; offset += 40) {
      const layout = relationWindowLayout(source, size, {sibling: offset});
      expect(layout.positions.AI).toEqual({x: 0, y: 0});
      expect(layout.positions.Root).toEqual(first.positions.Root);
      expect(layout.snapshot.nodes.filter(n => n.zone === 'sibling')).toHaveLength(7);
      for (const node of layout.snapshot.nodes) {
        if (node.zone === 'sibling') seen.add(node.id);
        if (node.zone === 'child') expect(layout.positions[node.id]).toEqual(first.positions[node.id]);
      }
      expect(layout.snapshot.nodes.length).toBeLessThan(26);
      expect(layout.snapshot.edges.some(e => e.source === 'AI' && e.target.startsWith('Sibling'))).toBe(false);
      for (const node of layout.snapshot.nodes.filter(n => n.zone === 'sibling')) {
        expect(layout.snapshot.edges).toContainEqual({source: 'Root', target: node.id, kind: 'hierarchy'});
      }
    }
    expect(seen.size).toBe(280);
  });
  it('bounds long titles, prevents sibling/child overlap and clamps stale offsets after deletions', () => {
    const graph = catalog(); graph.upsert(note('非常非常长的目录标题'.repeat(12), ['Root']));
    const source = windowSource(graph.neighborhood('AI', 10));
    for (const viewport of [size, {width: 360, height: 500}]) {
      const layout = relationWindowLayout(source, viewport, {sibling: 1e9}, {...DEFAULT_MIND_MAP, fontSize: 24});
      const area = layout.windows.find(w => w.zone === 'sibling')!;
      for (const node of layout.snapshot.nodes.filter(n => n.zone === 'sibling')) {
        const s = nodeSize(node, {...DEFAULT_MIND_MAP, fontSize: 24}), p = layout.positions[node.id]!;
        expect(p.x + s.width / 2).toBeLessThan(area.x + area.width + 1);
        expect(p.y + s.height / 2).toBeLessThanOrEqual(area.y + area.height + 1);
      }
      expect(layout.offsets.sibling).toBe(area.max);
    }
    const small = new GraphIndex([note('Root'), note('AI', ['Root']), note('Other', ['Root'])]);
    expect(relationWindowLayout(windowSource(small.neighborhood('AI')), size, {sibling: 1e9}).offsets.sibling).toBe(0);
  });
  it('persists window positions separately for navigation and validates saved data', () => {
    const graph = catalog(), snapshot = graph.neighborhood('AI');
    const state = {positions: {}, pinned: [], windows: {child: 123, sibling: 456, parent: -4, jump: NaN}, windowVersion: 3};
    const saved = loadBrainData({version: 4, layouts: {AI: state}}).layouts.AI!;
    expect(saved.windows).toEqual({child: 123, sibling: 456, parent: 0});
    expect(saved.windowVersion).toBe(3);
    const legacy = loadBrainData({version: 4, layouts: {AI: {...state, windowVersion: undefined}}}).layouts.AI!;
    expect(legacy.windows).toEqual({sibling: 456, parent: 0});
    const centered = relationWindowLayout(windowSource(snapshot), size, legacy.windows);
    const children = centered.windows.find(w => w.zone === 'child')!;
    expect(children.offset).toBe(relationWindowLayout(windowSource(snapshot), size).offsets.child);
  });
  it('places overflow counts beside their scrollbars and hides them when scrolling is unnecessary', () => {
    const graph = catalog();
    const targets = Array.from({length: 20}, (_, i) => `Link ${i}`);
    graph.upsert({...note('AI', ['Root']), links: targets});
    for (const id of targets) graph.upsert(note(id));
    const layout = relationWindowLayout(windowSource(graph.neighborhood('AI')), size);
    const host = document.createElement('div'), surface = document.createElement('div');host.append(surface);
    const controls = new WindowControls(host, surface, e => ({x:e.clientX,y:e.clientY}), vi.fn(), () => true);
    const range = (zone:string) => host.querySelector<HTMLInputElement>(`input[data-zone="${zone}"]`)!;
    const label = (zone:string) => host.querySelector<HTMLElement>(`.brain-window-label[data-zone="${zone}"]`)!;
    const number = (value:string) => parseFloat(value);
    for (const scale of [.55, 1, 1.5]) {
      controls.update(layout, p => ({x:600+p.x*scale,y:400+p.y*scale}), scale, true);
      for (const zone of ['sibling','child','jump']) {
        const r = range(zone), l = label(zone);
        expect(r.hidden).toBe(false);expect(l.hidden).toBe(false);
        const x = number(r.style.left), y = number(r.style.top), w = number(r.style.width), h = number(r.style.height);
        if (zone === 'child') {
          expect(number(l.style.left)).toBeCloseTo(x+w/2);
          expect(number(l.style.top)).toBeCloseTo(y+h+8);
          expect(l.style.transform).toBe('translateX(-50%)');
        } else {
          expect(number(l.style.top)).toBeCloseTo(y+h/2);
          expect(number(l.style.left)).toBeCloseTo(zone==='jump'?x-8:x+w+8);
          expect(l.style.transform).toBe(zone==='jump'?'translate(-100%, -50%)':'translateY(-50%)');
        }
      }
      const jump = layout.windows.find(w=>w.zone==='jump')!;
      expect(number(range('jump').style.left)+10).toBeCloseTo(600+(jump.x-18)*scale);
    }
    controls.update(layout, p=>p, 1, false);
    for (const zone of ['sibling','child','jump']) {expect(label(zone).hidden).toBe(true);expect(range(zone).hidden).toBe(false);}
    const small = new GraphIndex([note('Root'),note('AI',['Root']),note('Sibling',['Root']),
      note('Child',['AI']),note('Ref')]);
    small.upsert({...note('AI',['Root']),links:['Ref']});
    controls.update(relationWindowLayout(windowSource(small.neighborhood('AI')),size),p=>p,1,true);
    for (const zone of ['sibling','child','jump']) {expect(label(zone).hidden).toBe(true);expect(range(zone).hidden).toBe(true);}
    controls.update(layout,p=>p,1,true);
    for (const zone of ['sibling','child','jump']) expect(label(zone).hidden).toBe(false);
    controls.destroy();
  });
  it('routes wheel to one region, leaves modifier zoom alone and cancels pending scroll on navigation', () => {
    const source = windowSource(catalog().neighborhood('AI'));
    const layout = relationWindowLayout(source, size);
    const host = document.createElement('div'), canvas = document.createElement('div'); host.append(canvas); document.body.append(host);
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => {callbacks.push(fn); return callbacks.length;});
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const change = vi.fn();
    const controls = new WindowControls(host, canvas, e => ({x: e.clientX, y: e.clientY}), change, () => true);
    controls.update(layout, (p: Point) => p, 1, true);
    const sibling = layout.windows.find(w => w.zone === 'sibling')!;
    const wheel = (extra = {}) => new WheelEvent('wheel', {bubbles: true, cancelable: true, clientX: sibling.x + 30, clientY: sibling.y + sibling.height / 2, deltaY: 80, ...extra});
    const first = wheel(); canvas.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true); callbacks.shift()!(0);
    expect(change).toHaveBeenLastCalledWith('sibling', 80);
    const zoom = wheel({ctrlKey: true}); canvas.dispatchEvent(zoom); expect(zoom.defaultPrevented).toBe(false);
    const slider = host.querySelector<HTMLInputElement>('input[data-zone="child"]')!;
    slider.value = '170'; slider.dispatchEvent(new Event('input')); callbacks.shift()!(0);
    expect(change).toHaveBeenLastCalledWith('child', 170);
    canvas.dispatchEvent(wheel()); controls.cancel(); expect(cancel).toHaveBeenCalled();
    controls.destroy(); expect(host.querySelector('.brain-relation-windows')).toBeNull();
    const after = wheel(); canvas.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
    host.remove(); vi.restoreAllMocks();
  });
});
