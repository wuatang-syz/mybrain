// @vitest-environment jsdom
import {describe, expect, it, vi, beforeEach} from 'vitest';
import type {GraphEdge} from '../src/model/types';
import {GraphIndex} from '../src/graph';
import {directoryRecords} from '../src/graph/directory';
import {allowsPort, portRequest} from '../src/ui/canvas/ports';
import {BrainView} from '../src/ui/view';
import {Scene} from '../src/ui/canvas/scene';

const items: {title: string; click?: () => void}[] = [];
vi.mock('obsidian', async original => {
  const host = await original<typeof import('obsidian')>();
  return {...host, Menu: class {
    addItem(setup: (item: unknown) => void) {
      const result = {title: '', click: undefined as (() => void) | undefined};
      const item = {setTitle: (title: string) => {result.title = title; return item;}, setIcon: () => item,
        onClick: (click: () => void) => {result.click = click; return item;}};
      setup(item); items.push(result); return this;
    }
    addSeparator() {return this;}
    showAtMouseEvent() {}
  }};
});
const fixture = (reverse = false) => {
  const graph = new GraphIndex(directoryRecords('Vault', ['Topic'], [
    {id: 'Topic/A.md', title: 'A', parents: [], links: reverse ? ['B.md'] : [], issues: []},
    {id: 'B.md', title: 'B', parents: [], links: ['Topic/A.md'], issues: []},
  ]));
  const view = Object.create(BrainView.prototype) as BrainView, openNote = vi.fn(async () => {});
  const source = {};
  Object.assign(view, {leaf: source, brain: {graph, openNote, report: vi.fn()}, app: {}});
  return {view, graph, openNote, source};
};
beforeEach(() => {items.length = 0;});
describe('native relation UI', () => {
  it.each([false, true])('offers actual link sources for editing (reciprocal: %s)', reverse => {
    const {view, openNote, source} = fixture(reverse);
    const internal = view as unknown as {edgeContext(edge: GraphEdge, event: MouseEvent): void};
    internal.edgeContext({source: 'Topic/A.md', target: 'B.md', kind: 'jump'}, new MouseEvent('contextmenu'));
    expect(items.map(item => item.title)).toEqual(reverse ? ['编辑来源：A', '编辑来源：B'] : ['编辑来源：B']);
    items.at(-1)!.click!(); expect(openNote).toHaveBeenCalledWith('B.md', source);
    expect(items.some(item => item.title.includes('删除'))).toBe(false);
  });
  it('exposes child ports only on folders and jump ports only on notes', () => {
    const {graph} = fixture();
    const nodes = new Map(graph.neighborhood('Topic/A.md').nodes.map(node => [node.id, node]));
    expect(allowsPort(nodes.get('Topic/A.md'), 'bottom')).toBe(false);
    expect(allowsPort(nodes.get('Topic/A.md'), 'left')).toBe(true);
    expect(allowsPort(nodes.get('Topic'), 'bottom')).toBe(true);
    expect(allowsPort(nodes.get('Topic'), 'left')).toBe(false);
    expect(portRequest('B.md', {id: 'Topic/A.md', side: 'top'}, nodes)).toBeUndefined();
    const scene = new Scene(document.createElement('div'));
    scene.render(graph.neighborhood('Topic/A.md'), []);
    expect(scene.nodes.get('Topic/A.md')!.querySelector('[data-port="bottom"]')).toBeNull();
    expect(scene.nodes.get('Topic')!.querySelector('[data-port="left"]')).toBeNull();
  });
});
