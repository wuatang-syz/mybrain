import { describe, expect, it, vi } from 'vitest';
import { GraphIndex } from '../src/graph';
import type { NoteRecord } from '../src/model/types';

const note = (id: string, changes: Partial<NoteRecord> = {}): NoteRecord => ({ id, title: id, parents: [], links: [], issues: [], ...changes });

describe('GraphIndex', () => {
  it('keeps hierarchy directional, jumps and ordinary links symmetric, and updates reverse indexes', () => {
    const graph = new GraphIndex([note('A', { parents: ['P'], links: [...['B'], ...['C']] }), note('P'), note('B'), note('C')]);
    expect(graph.parents('A')).toEqual(['P']);
    expect(graph.children('P')).toEqual(['A']);
    expect(graph.linked('B')).toEqual(['A']);
    expect(graph.linked('C')).toEqual(['A']);
    graph.upsert(note('A', { parents: ['B'] }));
    expect(graph.children('P')).toEqual([]);
    expect(graph.children('B')).toEqual(['A']);
    expect(graph.linked('B')).toEqual([]);
    expect(graph.linked('C')).toEqual([]);
  });

  it('hides deleted targets and restores references when their notes return', () => {
    const graph = new GraphIndex([note('A', { parents: ['P'], links: [...['P'], ...['P']] }), note('P')]);
    graph.remove('P');
    expect(graph.parents('A')).toEqual([]);
    expect(graph.linked('A')).toEqual([]);
    expect(graph.linked('A')).toEqual([]);
    graph.upsert(note('P'));
    expect(graph.children('P')).toEqual(['A']);
    expect(graph.linked('P')).toEqual(['A']);
    graph.remove('A');
    expect(graph.children('P')).toEqual([]);
    expect(graph.linked('P')).toEqual([]);
  });

  it('shows incoming and outgoing internal links as jumps alongside directory edges', () => {
 const graph = new GraphIndex([note('F', {parents: ['P'], links: ['Sibling', 'C', 'Outside']}), note('P'), note('Sibling', {parents: ['P'], links: ['F']}), note('C', {parents: ['F']}), note('Outside'), note('Incoming', {links: ['F']}), note('Unrelated')]);
 const view = graph.neighborhood('F');
 expect(view.nodes.find(n => n.id === 'Unrelated')).toBeUndefined();
 expect(view.nodes.find(n => n.id === 'Incoming')?.zone).toBe('jump');
 expect(view.nodes.find(n => n.id === 'Outside')?.zone).toBe('jump');
 expect(view.nodes.find(n => n.id === 'C')?.zone).toBe('child');
 expect(view.edges.filter(e => e.kind === 'jump')).toHaveLength(4);
 expect(view.edges).toContainEqual({source: 'F', target: 'C', kind: 'hierarchy'});
});

  it('counts overflow within the local neighborhood', () => {
 const graph = new GraphIndex([note('F', {parents: ['P'], links: ['A', 'B', 'C']}), note('P'), note('A'), note('B'), note('C')]);
 const view = graph.neighborhood('F', 3);
 expect(view.nodes.map(n=>n.id)).toEqual(['F','P','A']);
 expect(view.overflow.map(n=>n.id)).toEqual(['B','C']);
 expect(view.counts.jump).toBe(3); expect(view.counts.outer).toBe(0);
 expect(graph.neighborhood('missing').nodes).toEqual([]);
});

  it('notifies subscribers once for batches and never for unchanged records', () => {
    const graph = new GraphIndex();
    let count = 0;
    const unsubscribe = graph.subscribe(() => count++);
    graph.batch(() => { graph.upsert(note('A')); graph.upsert(note('B')); });
    expect(count).toBe(1);
    graph.upsert(note('A'));
    expect(count).toBe(1);
    unsubscribe(); graph.remove('A');
    expect(count).toBe(1);
  });

  it('builds capped views of the in-memory 10,000-note catalog without repeated sorting', () => {
    const notes = Array.from({ length: 10_000 }, (_, i) => note(`${i}.md`, i > 0 && i < 151 ? { parents: ['0.md'] } : {}));
    const graph = new GraphIndex(notes);
    graph.all();
    const started = performance.now();
    for (let i = 0; i < 30; i++) expect(graph.neighborhood('0.md', 100).nodes).toHaveLength(100);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(graph.neighborhood('0.md', 100).overflow).toHaveLength(51);
  });

  it('caches the sorted catalog, invalidates on changes and keeps caller mutations isolated', () => {
    const graph = new GraphIndex([note('B'), note('A')]);
    expect(graph.all().map(n => n.id)).toEqual(['A', 'B']);
    const sort = vi.spyOn(Array.prototype, 'sort');
    try {
      graph.all().pop();
      expect(graph.all()).toHaveLength(2);
      expect(sort).not.toHaveBeenCalled();
      graph.upsert(note('C')); graph.all();
      expect(sort).toHaveBeenCalledTimes(1);
      graph.remove('A'); expect(graph.all().map(n => n.id)).toEqual(['B', 'C']);
    } finally { sort.mockRestore(); }
  });

  it('leaves isolated notes in their directories rather than injecting peripheral buckets', () => {
 const graph = new GraphIndex([note('F'), note('Alone'), note('Parent'), note('Child', {parents:['Parent']})]);
 expect(graph.neighborhood('F').nodes.map(n=>n.id)).toEqual(['F']);
 expect(graph.neighborhood('Parent').nodes.map(n=>n.id)).toEqual(['Parent','Child']);
});

  it('enforces the single-canvas 200-node limit even if a larger budget is requested', () => {
    const graph = new GraphIndex(Array.from({ length: 250 }, (_, i) => note(`${i}`, i ? { parents: ['0'] } : {})));
    expect(graph.neighborhood('0', 500).nodes).toHaveLength(200);
    expect(graph.neighborhood('0', 500).overflow).toHaveLength(50);
  });
});
