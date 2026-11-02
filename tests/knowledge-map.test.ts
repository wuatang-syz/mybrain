import {describe, expect, it} from 'vitest';
import {GraphIndex} from '../src/graph';
import {knowledgeMap, mapDrawable, mapLayout} from '../src/graph/knowledge-map';
import type {MapLayoutState, NoteRecord} from '../src/model/types';
import {emptyMapLayout, loadBrainData} from '../src/settings';

const note = (id: string, parents: string[] = [], links: string[] = [], jumps: string[] = []): NoteRecord =>
  ({id, title: id, parents, links: [...links, ...jumps], issues: []});
const state = (overrides: Partial<MapLayoutState> = {}): MapLayoutState => ({...emptyMapLayout(), ...overrides});
const cardOf = (map: ReturnType<typeof knowledgeMap>, id: string) => map.cards.find(card => card.id === id);

describe('knowledge map levels', () => {
  it('gives every direct child a card, leaves included, and keeps the attention note off the canvas', () => {
    const records = [note('Root'), note('Leaf', ['Root']), note('Topic', ['Root']), note('Child', ['Topic']), note('Loose')];
    const graph = new GraphIndex(records), before = graph.all();
    const map = knowledgeMap(graph, {attention: 'Root', root: 'Root'});
    expect(map.attention).toBe('Root');
    expect(map.attentionTitle).toBe('Root');
    expect(map.cards.map(card => card.id)).toEqual(['Leaf', 'Topic']);
    expect(cardOf(map, 'Leaf')).toMatchObject({direct: [], deep: [], members: []});
    expect(cardOf(map, 'Topic')?.direct).toEqual(['Child']);
    expect(map.nodes.some(node => node.id === 'Root')).toBe(false);
    expect(map.nodes.find(node => node.id === 'Child')).toMatchObject({card: 'Topic', role: 'direct'});
    expect(map.total).toBe(3);
    expect(graph.all()).toEqual(before);
  });
  it('drills one level down and drops the unassigned card below the global level', () => {
    const graph = new GraphIndex([note('Root'), note('Topic', ['Root']), note('Child', ['Topic']), note('Loose')]);
    const top = knowledgeMap(graph, {attention: 'Root', root: 'Root'});
    expect(top.cards.map(card => card.id)).toEqual(['Topic']);
    const deep = knowledgeMap(graph, {attention: 'Topic', root: 'Root'});
    expect(deep.attention).toBe('Topic');
    expect(deep.cards.map(card => card.id)).toEqual(['Child']);
    expect(deep.nodes.map(node => node.id).sort()).toEqual(['Child']);
  });
  it('falls back to the global root and to parentless topics without inventing a level', () => {
    const graph = new GraphIndex([note('Root'), note('Topic', ['Root']), note('Child', ['Topic'])]);
    expect(knowledgeMap(graph, {attention: 'missing', root: 'Root'}).attention).toBe('Root');
    const bare = knowledgeMap(new GraphIndex([note('Topic'), note('Child', ['Topic']), note('Alone')]), {});
    expect(bare.attention).toBeNull();
    expect(bare.cards.map(card => card.id)).toEqual(['Alone', 'Topic']);
    expect(knowledgeMap(new GraphIndex(), {}).cards).toEqual([]);
  });
  it('assigns members by shortest hierarchy path', () => {
    const graph = new GraphIndex([note('Root'), note('B', ['Root']), note('A', ['Root']), note('deep', ['A']), note('short', ['deep', 'B']), note('tie', ['B', 'A'])]);
    const map = knowledgeMap(graph, {attention: 'Root', root: 'Root'});
    expect(map.nodes.find(node => node.id === 'short')?.card).toBe('B');
    expect(map.nodes.find(node => node.id === 'tie')?.card).toBe('A');
  });
  it('terminates on cycles without inventing unassigned groups', () => {
 const graph = new GraphIndex([note('A',['B']),note('B',['A']),note('C',['missing'])]);
 expect(knowledgeMap(graph).cards.map(c=>c.id)).toEqual(['C']);
});
});

describe('map drawable and card layout', () => {
  const graph = () => new GraphIndex([
    note('Root'), note('A', ['Root']), note('B', ['Root']),
    ...Array.from({length: 20}, (_, index) => note(`a${index}`, ['A'])),
    ...Array.from({length: 5}, (_, index) => note(`b${index}`, ['B'])),
    note('a0deep', ['a0']),
  ]);
  it('spends the node budget round robin, keeps the selection visible and reports the rest', () => {
    const map = knowledgeMap(graph(), {attention: 'Root', root: 'Root'});
    const drawable = mapDrawable(map, {budget: 6});
    expect([...drawable.drawn].sort()).toEqual(['A', 'B', 'a0', 'a1', 'b0', 'b1']);
    expect(drawable.hiddenTotal).toBe(26 - 4);
    const forced = mapDrawable(map, {budget: 3, selected: 'a9'});
    expect(forced.drawn).toContain('a9');
    expect(forced.drawn).toHaveLength(4);
  });
  it('reveals deeper members only for expanded cards', () => {
    const map = knowledgeMap(graph(), {attention: 'Root', root: 'Root'});
    expect(mapDrawable(map, {}).drawn).not.toContain('a0deep');
    expect(mapDrawable(map, {expanded: ['A']}).drawn).toContain('a0deep');
  });
  it('packs cards deterministically without overlap and keeps single note cards compact', () => {
    const map = knowledgeMap(graph(), {attention: 'Root', root: 'Root'});
    const drawable = mapDrawable(map, {});
    const first = mapLayout(map, drawable, state(), 1.5), second = mapLayout(map, drawable, state(), 1.5);
    expect(second).toEqual(first);
    for (const a of first.cards) for (const b of first.cards) {
      if (a.id === b.id) continue;
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart).toBe(true);
    }
    const single = knowledgeMap(new GraphIndex([note('Root'), note('Only', ['Root'])]), {attention: 'Root', root: 'Root'});
    const leaf = mapLayout(single, mapDrawable(single), state(), 1.5);
    expect(leaf.cards[0]!.width).toBeGreaterThanOrEqual(210);
    expect(leaf.cards[0]!.height).toBeGreaterThanOrEqual(72);
    expect(leaf.cards[0]!.width).toBeLessThan(380);
  });
  it('grows the card around a dragged node instead of pulling the node back', () => {
    const map = knowledgeMap(graph(), {attention: 'Root', root: 'Root'});
    const drawable = mapDrawable(map, {});
    const base = mapLayout(map, drawable, state(), 1.5);
    const card = base.cards.find(entry => entry.id === 'A')!;
    const node = base.nodes.find(entry => entry.id === 'a0')!;
    const moved = {x: node.x, y: node.y + 420};
    const grown = mapLayout(map, drawable, state({nodes: {a0: moved}}), 1.5);
    const grownCard = grown.cards.find(entry => entry.id === 'A')!;
    expect(grown.nodes.find(entry => entry.id === 'a0')).toMatchObject(moved);
    expect(grownCard.height).toBeGreaterThan(card.height);
    expect(grownCard.y + grownCard.height).toBeGreaterThanOrEqual(moved.y + 8);
    expect(grown.cards.find(entry => entry.id === 'B')).toEqual(base.cards.find(entry => entry.id === 'B'));
  });
  it('moves a whole cluster with its card offset', () => {
    const map = knowledgeMap(graph(), {attention: 'Root', root: 'Root'});
    const drawable = mapDrawable(map, {});
    const base = mapLayout(map, drawable, state(), 1.5);
    const card = base.cards.find(entry => entry.id === 'A')!, node = base.nodes.find(entry => entry.id === 'a3')!;
    const shifted = mapLayout(map, drawable, state({cards: {A: {x: 140, y: -70}}}), 1.5);
    const movedCard = shifted.cards.find(entry => entry.id === 'A')!, movedNode = shifted.nodes.find(entry => entry.id === 'a3')!;
    expect(movedCard.x).toBe(card.x + 140);
    expect(movedCard.y).toBe(card.y - 70);
    expect(movedNode.x).toBe(node.x + 140);
    expect(movedNode.y).toBe(node.y - 70);
  });
  it('keeps structure edges inside one card and never draws the attention note', () => {
    const map = knowledgeMap(graph(), {attention: 'Root', root: 'Root'});
    const cardOfNode = (id: string) => map.nodes.find(node => node.id === id)?.card;
    expect(map.edges.some(edge => edge.source === 'A' && edge.target === 'a0')).toBe(true);
    for (const edge of map.edges) expect(cardOfNode(edge.source)).toBe(cardOfNode(edge.target));
    expect(map.edges.every(edge => edge.source !== 'Root' && edge.target !== 'Root')).toBe(true);
  });
});

describe('map layout persistence', () => {
  it('drops pre card layouts and keeps versioned card state', () => {
    const legacy = loadBrainData({mapLayout: {positions: {A: {x: 1, y: 2}}, pinned: ['A']}, mapSelected: 'A'});
    expect(legacy.mapLayout).toEqual({version: 2, nodes: {}, cards: {}});
    expect(legacy.mapSelected).toBe('A');
    const saved = {version: 2 as const, nodes: {A: {x: 901, y: -340}}, cards: {B: {x: 40, y: 12}}, viewport: {x: 30, y: -40, scale: .7}};
    const restored = loadBrainData(JSON.parse(JSON.stringify({version: 4, mapLayout: saved, mapAttention: 'B'})));
    expect(restored.mapLayout).toEqual(saved);
    expect(restored.mapAttention).toBe('B');
    expect(loadBrainData({}).mapAttention).toBe('/');
    expect(loadBrainData({}).version).toBe(4);
  });
  it('applies a stored node position to the packed layout', () => {
    const map = knowledgeMap(new GraphIndex([note('Root'), note('Topic', ['Root']), note('Child', ['Topic'])]), {attention: 'Root', root: 'Root'});
    const drawable = mapDrawable(map, {});
    const manual = {x: 240, y: -180};
    const layout = mapLayout(map, drawable, state({nodes: {Child: manual}}), 1.5);
    expect(layout.nodes.find(node => node.id === 'Child')).toMatchObject(manual);
  });
});
