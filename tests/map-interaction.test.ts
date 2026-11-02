// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {TFile, type WorkspaceLeaf} from 'obsidian';
import {GraphIndex} from '../src/graph';
import {knowledgeMap, mapDrawable, mapLayout} from '../src/graph/knowledge-map';
import type {NoteRecord} from '../src/model/types';
import BrainPlugin from '../src/main';
import {BrainView} from '../src/ui/view';
import {KnowledgeMapCanvas} from '../src/ui/knowledge-map';
import {cardChrome} from '../src/ui/knowledge-map/paint';
import {findCompanionNote, initializeNoteSplit} from '../src/ui/note-pane';
import {loadBrainData} from '../src/settings';

const note = (id: string, parents: string[] = []): NoteRecord => ({id, title: id, parents, links: [], issues: []});
const fixtureGraph = () => new GraphIndex([note('Root'), note('Topic', ['Root']), note('A', ['Topic']), note('B', ['Topic']), note('Deep', ['A'])]);
const pointer = (x: number, y: number) => ({
  type: 'pointer', button: 0, pointerId: 7, clientX: x, clientY: y,
  preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
});
const makeCanvas = () => {
  const canvas = Object.create(KnowledgeMapCanvas.prototype) as KnowledgeMapCanvas;
  const graph = fixtureGraph();
  const snapshot = knowledgeMap(graph, {attention: 'Root', root: 'Root'});
  const drawable = mapDrawable(snapshot, {});
  const layout = mapLayout(snapshot, drawable, {version: 2, nodes: {}, cards: {}}, 1.5);
  const callbacks = {select: vi.fn(), edit: vi.fn(), context: vi.fn(), enter: vi.fn(), save: vi.fn()};
  const renderer = {
    scale: 1, panX: 0, panY: 0, targetScale: 1, width: 1200, height: 800, nodes: [], dragNode: null,
    interactiveEl: {getBoundingClientRect: () => ({left: 0, top: 0}), style: {cursor: ''}},
    setData: vi.fn(), changed: vi.fn(), worker: {postMessage: vi.fn()},
    containerEl: {win: {devicePixelRatio: 1}, ownerDocument: {body: {classList: {contains: () => false}}}},
  };
  const win = {devicePixelRatio: 1, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {}};
  Object.assign(canvas, {
    renderer, container: {win}, callbacks, graph, snapshot, drawable, layout, budget: 200, disposed: false, applied: '',
    setData: renderer.setData, decorations: new Map(), lastClick: {id: '', time: 0},
    base: {nodes: Object.fromEntries(snapshot.nodes.map(node => [node.id, {type: 'markdown', links: {}}]))},
    host: {
      renderer, snapshot, drawable, layout,
      nodes: new Map(layout.nodes.map(node => [node.id, node])), cards: new Map(layout.cards.map(card => [card.id, card])), links: [],
    },
    state: {version: 2, nodes: {}, cards: {}}, links: [], expanded: new Set(),
  });
  return {canvas, layout, callbacks, renderer};
};
const internal = (canvas: KnowledgeMapCanvas) => canvas as unknown as {
  start(event: unknown): void; move(event: unknown): void; end(event: unknown): void; cancel(): void;
};

describe('map and editable note integration', () => {
  it('follows a file-open selection into the level that contains the note', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const graph = fixtureGraph();
    const data = loadBrainData({version: 3, focus: 'A', mapSelected: 'A', mapAttention: 'Root', globalRoot: 'Root'});
    const openMapNote = vi.fn(), render = vi.fn(), locate = vi.fn(() => true), fit = vi.fn();
    Object.assign(view, {mode: 'map', focusId: 'A', render, mapCanvas: {drawnNotes: new Set(['Topic', 'A', 'B']), locate, fit, setLevel: vi.fn(), applyConfig: vi.fn(), endPreview: vi.fn(), beginPreview: vi.fn(), getView: vi.fn(() => ({camera:{x:0,y:32,z:42},target:{x:0,y:0,z:0},positions:{},expanded:[]}))},
      brain: {data, graph, scheduleSave: vi.fn(), openMapNote}});
    view.focus('Deep', false);
    expect(data.mapSelected).toBe('Deep');
    expect(data.mapAttention).toBe('A');
    expect(openMapNote).not.toHaveBeenCalled();
    expect((view as unknown as {focusId: string}).focusId).toBe('A');
  });
  it('keeps the current level when the note is already on the canvas', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const graph = fixtureGraph();
    const data = loadBrainData({version: 3, mapSelected: 'A', mapAttention: 'Root', globalRoot: 'Root'});
    const locate = vi.fn(() => true), fit = vi.fn();
    Object.assign(view, {mode: 'map', render: vi.fn(), mapCanvas: {drawnNotes: new Set(['Topic', 'A', 'B']), locate, fit, setLevel: vi.fn(), applyConfig: vi.fn(), endPreview: vi.fn(), beginPreview: vi.fn(), getView: vi.fn(() => ({camera:{x:0,y:32,z:42},target:{x:0,y:0,z:0},positions:{},expanded:[]}))},
      brain: {data, graph, scheduleSave: vi.fn(), openMapNote: vi.fn()}});
    view.focus('A', false);
    expect(data.mapAttention).toBe('Root');
    expect(locate).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
  });
  it('fits the level when the revealed note cannot be located on the canvas', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const graph = fixtureGraph();
    const data = loadBrainData({version: 3, mapSelected: 'A', mapAttention: 'Root', globalRoot: 'Root'});
    const locate = vi.fn(() => false), fit = vi.fn();
    Object.assign(view, {mode: 'map', render: vi.fn(), mapCanvas: {drawnNotes: new Set<string>(), locate, fit, setLevel: vi.fn(), applyConfig: vi.fn(), endPreview: vi.fn(), beginPreview: vi.fn(), getView: vi.fn(() => ({camera:{x:0,y:32,z:42},target:{x:0,y:0,z:0},positions:{},expanded:[]}))},
      brain: {data, graph, scheduleSave: vi.fn(), openMapNote: vi.fn()}});
    (view as unknown as {revealMapNote(id: string, open: boolean, options: {focus: boolean}): void}).revealMapNote('Deep', false, {focus: true});
    expect(data.mapAttention).toBe('A');
    expect(fit).toHaveBeenCalledOnce();
  });
  it('drills into a topic without opening the editor or overriding its saved camera', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const graph = fixtureGraph();
    const data = loadBrainData({version: 3, mapSelected: 'A', mapAttention: 'Root', globalRoot: 'Root'});
    const openMapNote = vi.fn(async (id: string) => {void id;}), fit = vi.fn(), locate = vi.fn(() => true);
    Object.assign(view, {mode: 'map', render: vi.fn(), mapCanvas: {drawable: {drawn: ['Topic', 'A', 'B']}, locate, fit, setLevel: vi.fn(), endPreview: vi.fn(), getView: vi.fn(() => ({camera:{x:0,y:32,z:42},target:{x:0,y:0,z:0},positions:{},expanded:[]}))},
      brain: {data, graph, scheduleSave: vi.fn(), openMapNote}});
    (view as unknown as {openMapCard(id: string): void}).openMapCard('Topic');
    expect(data.mapAttention).toBe('Topic');
    expect(data.mapSelected).toBeNull();
    expect(fit).not.toHaveBeenCalled();
    expect(openMapNote).not.toHaveBeenCalled();
  });
  it('initializes only a two-pane sibling split using native dimensions', () => {
    const a = {setDimension: vi.fn(), parent: {}}, b = {setDimension: vi.fn(), parent: {}};
    const parent = {children: [a, b], recomputeChildrenDimensions: vi.fn()}; a.parent = b.parent = parent;
    initializeNoteSplit({parent: a} as unknown as WorkspaceLeaf, {parent: b} as unknown as WorkspaceLeaf);
    expect(a.setDimension).toHaveBeenCalledWith(60); expect(b.setDimension).toHaveBeenCalledWith(40);
    b.parent = {}; initializeNoteSplit({parent: a} as unknown as WorkspaceLeaf, {parent: b} as unknown as WorkspaceLeaf);
    expect(a.setDimension).toHaveBeenCalledOnce();
  });
  it('finds the right sibling after plugin reload and reuses a pinned right tab without splitting again', () => {
    const left = {}, source = {parent: {}}, right = {};
    source.parent = {children: [left, source, right]};
    const leaf = (parent: object, pinned = false) => ({parent, getViewState: () => ({pinned})}) as unknown as WorkspaceLeaf;
    const leftNote = leaf(left), rightNote = leaf(right);
    expect(findCompanionNote(leaf(source), [leftNote, rightNote])).toBe(rightNote);
    const pinned = leaf(right, true);
    expect(findCompanionNote(leaf(source), [leftNote, pinned])).toBe(pinned);
  });
  it('reuses the companion editor and recreates it only after closing', async () => {
    const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
    const leaves: unknown[] = [];
    const sourceTabs = {}, split = {children:[sourceTabs] as object[]};
    Object.assign(sourceTabs,{parent:split});
    const make = () => {
      const tabs = {parent:split};split.children.push(tabs);
      const leaf = {parent:tabs,getViewState:()=>({type:'markdown'}),setPinned: vi.fn(), openFile: vi.fn(async () => {if (!leaves.includes(leaf)) leaves.push(leaf);}), view: {containerEl: document.createElement('div')}};
      return leaf;
    };
    const workspace = {getLeavesOfType: () => leaves, createLeafBySplit: vi.fn(make), revealLeaf: vi.fn(async () => {})};
    Object.assign(plugin, {graph: new GraphIndex(), app: {workspace, vault: {getAbstractFileByPath: (path: string) => Object.assign(new TFile(),{path})}}});
    const source = {parent:sourceTabs} as unknown as WorkspaceLeaf;
    await Promise.all([plugin.openMapNote('A', source), plugin.openMapNote('B', source)]);
    expect(workspace.createLeafBySplit).toHaveBeenCalledOnce();
    const leaf = leaves[0] as ReturnType<typeof make>;
    expect(leaf.openFile.mock.calls).toHaveLength(2);
    leaves.length = 0;split.children.splice(1); await plugin.openMapNote('A', source);
    expect(workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  });
});

describe('map pointer gestures', () => {
  it('selects a node on the first click and edits it on the second, without a timer', () => {
    const {canvas, layout, callbacks} = makeCanvas();
    const node = layout.nodes.find(entry => entry.id === 'A')!;
    internal(canvas).start(pointer(node.x, node.y));
    internal(canvas).end(pointer(node.x, node.y));
    expect(callbacks.select).toHaveBeenCalledExactlyOnceWith('A');
    expect(callbacks.edit).not.toHaveBeenCalled();
    internal(canvas).start(pointer(node.x, node.y));
    internal(canvas).end(pointer(node.x, node.y));
    expect(callbacks.edit).toHaveBeenCalledExactlyOnceWith('A');
  });
  it('saves a node drag without opening the note and restores an escaped drag', () => {
    const {canvas, layout, callbacks} = makeCanvas();
    const node = layout.nodes.find(entry => entry.id === 'A')!;
    internal(canvas).start(pointer(node.x, node.y));
    internal(canvas).move(pointer(node.x + 120, node.y + 90));
    internal(canvas).end(pointer(node.x + 120, node.y + 90));
    expect(callbacks.select).not.toHaveBeenCalled();
    const saved = callbacks.save.mock.calls[0]?.[0];
    expect(saved.version).toBe(2);
    expect(saved.nodes.A.x).toBeCloseTo(node.x + 120);
    expect(saved.nodes.A.y).toBeCloseTo(node.y + 90);
    Object.assign(canvas, {state: {version: 2, nodes: {}, cards: {}}, drag: undefined});
    internal(canvas).start(pointer(node.x, node.y));
    internal(canvas).move(pointer(node.x + 120, node.y + 90));
    internal(canvas).cancel();
    expect((canvas as unknown as {state: {nodes: Record<string, unknown>}}).state.nodes.A).toBeUndefined();
  });
  it('moves the whole cluster when the drag starts on the card body', () => {
    const {canvas, layout, callbacks} = makeCanvas();
    const card = layout.cards.find(entry => entry.id === 'Topic')!;
    internal(canvas).start(pointer(card.x + 6, card.y + 6));
    expect((canvas as unknown as {drag?: {kind: string}}).drag?.kind).toBe('card');
    internal(canvas).move(pointer(card.x + 86, card.y + 46));
    internal(canvas).end(pointer(card.x + 86, card.y + 46));
    expect(callbacks.save.mock.calls[0]?.[0].cards.Topic.x).toBeCloseTo(80);
    expect(callbacks.select).not.toHaveBeenCalled();
  });
  it('drills into the card from its header button', () => {
    const {canvas, layout, callbacks, renderer} = makeCanvas();
    const card = layout.cards.find(entry => entry.id === 'Topic')!;
    const chrome = cardChrome(renderer as never, card, true);
    expect(chrome.enter).not.toBeNull();
    internal(canvas).start(pointer(chrome.enter!.x, chrome.enter!.y));
    internal(canvas).end(pointer(chrome.enter!.x, chrome.enter!.y));
    expect(callbacks.enter).toHaveBeenCalledExactlyOnceWith('Topic');
    expect(callbacks.select).not.toHaveBeenCalled();
  });
  it('expands collapsed members from the header chip', () => {
    const {canvas, layout, renderer} = makeCanvas();
    const card = layout.cards.find(entry => entry.id === 'Topic')!;
    expect(canvas.drawable?.drawn).not.toContain('Deep');
    const chrome = cardChrome(renderer as never, card, true);
    expect(chrome.expand).not.toBeNull();
    internal(canvas).start(pointer(chrome.expand!.x, chrome.expand!.y));
    internal(canvas).end(pointer(chrome.expand!.x, chrome.expand!.y));
    expect(canvas.drawable?.drawn).toContain('Deep');
  });
});
