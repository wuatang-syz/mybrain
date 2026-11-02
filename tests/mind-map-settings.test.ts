// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {DEFAULT_MIND_MAP, loadMindMapSettings} from '../src/mind-map-settings';
import {loadBrainData} from '../src/settings';
import {MindMapPanel} from '../src/ui/mind-map-panel';
import {GraphIndex} from '../src/graph';
import {foldGroups} from '../src/ui/canvas/groups';
import {computeLayout} from '../src/ui/canvas/layout';
import {nodeSize} from '../src/ui/canvas/node-size';
import {edgeGeometry} from '../src/ui/native-graph/edges';
import {NativeGraphCanvas} from '../src/ui/native-graph';
import {BrainView} from '../src/ui/view';
import type {NativeRenderer} from '../src/ui/native-graph/types';
import type {NoteRecord} from '../src/model/types';

describe('mind map preferences', () => {
  it('migrates missing settings, validates corrupt values and persists independent settings', () => {
    expect(loadMindMapSettings(null)).toEqual(DEFAULT_MIND_MAP);
    expect(loadMindMapSettings({fontSize: 90, foldLimit: -1, lineWidth: NaN, lineOpacity: Infinity, showIcons: 'false', references: 'bad'}))
      .toEqual({...DEFAULT_MIND_MAP, fontSize: 24, foldLimit: 3});
    const data = loadBrainData({settings: {mindMap: {...DEFAULT_MIND_MAP, spacing: 'compact'}}});
    expect(loadBrainData(JSON.parse(JSON.stringify(data))).settings.mindMap).toEqual(data.settings.mindMap);
    data.settings.mindMap.fontSize = 12;
    expect(loadBrainData(null).settings.mindMap.fontSize).toBe(16);
  });
  it('updates immediately, preserves active controls, resets only preferences and handles Escape', () => {
    const parent = document.createElement('div'); document.body.append(parent);
    const change = vi.fn(), close = vi.fn(), bubbling = vi.fn(); parent.addEventListener('wheel', bubbling);
    const panel = new MindMapPanel(parent, {...DEFAULT_MIND_MAP}, change, close);
    const groups = [...panel.element.querySelectorAll('details')];
    expect(groups.map(group => group.open)).toEqual([true, false, false]);
    groups[2]!.open = true;
    panel.update({...DEFAULT_MIND_MAP, lineLength: 150});
    expect(groups[2]!.open).toBe(true);
    expect(panel.element.querySelector<HTMLInputElement>('[aria-label="连线长度"]')!.value).toBe('150');
    panel.update({...DEFAULT_MIND_MAP});
    const range = panel.element.querySelector<HTMLInputElement>('[aria-label="节点字号"]')!;
    range.focus(); range.value = '24'; range.dispatchEvent(new Event('input', {bubbles: true}));
    expect(change).toHaveBeenLastCalledWith({...DEFAULT_MIND_MAP, fontSize: 24});
    panel.update({...DEFAULT_MIND_MAP, fontSize: 20});
    expect(document.activeElement).toBe(range); expect(range.value).toBe('20');
    expect(panel.element.querySelector('[aria-label="普通引用线"]')).toBeNull();
    panel.element.dispatchEvent(new WheelEvent('wheel', {bubbles: true})); expect(bubbling).not.toHaveBeenCalled();
    [...panel.element.querySelectorAll('button')].find(button => button.textContent === '恢复默认')!.click();
    expect(change).toHaveBeenLastCalledWith(DEFAULT_MIND_MAP);
    range.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); expect(close).toHaveBeenCalledOnce();
    panel.destroy(); expect(parent.children).toHaveLength(0); parent.remove();
  });
  it('lengthens structural connections without changing node sizes or within-group spacing', () => {
    const note = (id: string, parents: string[] = [], jumps: string[] = []): NoteRecord => ({id, title: id, parents, links: jumps, issues: []});
    const graph = new GraphIndex([note('Parent'), note('Root', ['Parent'], ['Jump']), note('Jump'), note('Sibling', ['Parent']), note('A', ['Root']), note('B', ['Root'])]);
    const snapshot = graph.neighborhood('Root');
    const layouts = [50, 100, 200].map(lineLength => computeLayout(snapshot, undefined, [], {...DEFAULT_MIND_MAP, lineLength}));
    for (const id of ['Parent', 'A', 'Jump', 'Sibling']) {
      const distances = layouts.map(layout => Math.hypot(layout.positions[id]!.x, layout.positions[id]!.y));
      expect(distances[0]).toBeLessThan(distances[1]!); expect(distances[1]).toBeLessThan(distances[2]!);
    }
    expect(layouts.map(layout => layout.positions.B!.x - layout.positions.A!.x)).toEqual([120, 120, 120]);
    const data = loadBrainData({settings: {mindMap: {lineLength: 150}}});
    expect(loadBrainData(JSON.parse(JSON.stringify(data))).settings.mindMap.lineLength).toBe(150);
    expect(loadMindMapSettings({lineLength: -10}).lineLength).toBe(50);
    expect(loadMindMapSettings({lineLength: Infinity}).lineLength).toBe(100);
  });
  it.each(['compact', 'standard', 'spacious'] as const)('keeps long cards separated with %s spacing and adjustable folding', spacing => {
    const note = (id: string, parents: string[] = []): NoteRecord => ({id, title: '很长的中文节点标题和 English '+id, icon: '💡', parents, links: [], issues: []});
    const graph = new GraphIndex([note('root'), ...Array.from({length: 12}, (_, i) => note(String(i), ['root']))]);
    const snapshot = graph.neighborhood('root');
    const folded = foldGroups(snapshot, new Set(), 3);
    expect(folded.groups[0]?.hidden).toBe(9);
    const expanded = foldGroups(snapshot, new Set(['child:root']), 3);
    const settings = {...DEFAULT_MIND_MAP, fontSize: 24, spacing};
    const layout = computeLayout(expanded.snapshot, undefined, expanded.groups, settings);
    for (const a of expanded.snapshot.nodes) for (const b of expanded.snapshot.nodes) {
      if (a.id === b.id || a.zone === 'outer' || b.zone === 'outer') continue;
      const p = layout.positions[a.id]!, q = layout.positions[b.id]!, x = nodeSize(a, settings), y = nodeSize(b, settings);
      expect(Math.abs(p.x - q.x) >= (x.width + y.width) / 2 || Math.abs(p.y - q.y) >= (x.height + y.height) / 2).toBe(true);
    }
    const a = expanded.snapshot.nodes.find(node => node.id === 'root')!, b = expanded.snapshot.nodes.find(node => node.id === '0')!;
    const renderer = {nodeLookup: {root: {...layout.positions.root, id: 'root'}, '0': {...layout.positions['0'], id: '0'}}} as unknown as NativeRenderer;
    const geometry = edgeGeometry(renderer, {source: 'root', target: '0', kind: 'hierarchy'}, new Map([[a.id, a], [b.id, b]]), settings)!;
    expect(geometry.from.y).toBe(nodeSize(a, settings).height / 2);
    expect(nodeSize(a, {...settings, showIcons: false}).width).toBeLessThan(nodeSize(a, settings).width);
  });
  it('redraws style-only changes without rebuilding the layout or changing the viewport', () => {
    const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
    const render = vi.fn(), changed = vi.fn();
    Object.assign(canvas, {settings: {...DEFAULT_MIND_MAP}, getLayout: () => ({positions: {}, pinned: [], viewport: {x: 23, y: 42, scale: .8}}),
      render, renderOverlay: vi.fn(), renderer: {changed}, snapshot: {focus: 'Root'}});
    canvas.applySettings({...DEFAULT_MIND_MAP, lineWidth: 150});
    expect(render).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalledOnce();
    canvas.applySettings({...DEFAULT_MIND_MAP, fontSize: 20});
    expect(render).toHaveBeenCalledWith({focus: 'Root'}, expect.objectContaining({viewport: {x: 23, y: 42, scale: .8}}));
  });
  it('shares preferences across mind views without changing other modes', () => {
    const views = ['mind', 'mind', 'map'].map(mode => {
      const view = Object.create(BrainView.prototype) as BrainView;
      const applySettings = vi.fn(), update = vi.fn();
      Object.assign(view, {mode, canvas: {applySettings}, mindPanel: {update}, syncFooter: vi.fn()});
      return {view, applySettings, update};
    });
    const brain = {data: loadBrainData(null), scheduleSave: vi.fn(), views: () => views.map(item => item.view)};
    for (const {view} of views) Object.assign(view, {brain});
    const settings = {...DEFAULT_MIND_MAP, fontSize: 22};
    (views[0]!.view as unknown as {updateMindSettings(value: typeof settings): void}).updateMindSettings(settings);
    expect(brain.data.settings.mindMap).toEqual(settings); expect(brain.scheduleSave).toHaveBeenCalledOnce();
    for (const item of views.slice(0, 2)) {expect(item.applySettings).toHaveBeenCalledWith(settings); expect(item.update).toHaveBeenCalledWith(settings);}
    expect(views[2]!.applySettings).not.toHaveBeenCalled();
  });
  ;
});
