import {expect, it} from 'vitest';
import {GraphIndex} from '../src/graph';
import {computeLayout, nodeSize} from '../src/ui/canvas/layout';
import type {GraphNode} from '../src/model/types';

const node = (title: string, zone: GraphNode['zone'] = 'child'): GraphNode => ({id: title, title, zone, groupParents: [], issues: []});
it('grows with Chinese, Latin and mixed titles with horizontal padding and minimum widths', () => {
  for (const [short, long] of [['学习', '学习方法与知识管理实践'], ['AI', 'Artificial intelligence'], ['AI学习', 'AI学习方法与知识管理实践']]) {
    expect(nodeSize(node(long!)).width).toBeGreaterThan(nodeSize(node(short!)).width);
    expect(nodeSize(node(long!)).height).toBe(48);
  }
  expect(nodeSize(node('学习方法', 'focus')).width).toBeGreaterThan(nodeSize(node('学习方法')).width);
  expect(nodeSize(node('学习')).width).toBe(72);
  expect(nodeSize(node('学习', 'focus')).width).toBe(80);
  expect(nodeSize(node('')).width).toBe(64);
});
it('keeps wide structural nodes separated across rows and side columns', () => {
  const graph = new GraphIndex();
  const title = '这是包含中英文 AI 的很长很长的知识管理笔记标题';
  for (let i = 0; i < 25; i++) graph.upsert({id: `n${i}`, title: `${title}${i}`, parents: i === 0 ? [] : i < 10 ? ['n0'] : [],
    links: i === 0 ? Array.from({length: 10}, (_, j) => `n${j + 10}`) : [], issues: []});
  const snapshot = graph.neighborhood('n0');
  const layout = computeLayout(snapshot);
  const structural = snapshot.nodes.filter(n => n.zone !== 'outer');
  for (let i = 0; i < structural.length; i++) for (const b of structural.slice(i + 1)) {
    const a = structural[i]!, pa = layout.positions[a.id]!, pb = layout.positions[b.id]!;
    expect(Math.abs(pa.x - pb.x) >= (nodeSize(a).width + nodeSize(b).width) / 2 + 24 ||
      Math.abs(pa.y - pb.y) >= (nodeSize(a).height + nodeSize(b).height) / 2 + 24).toBe(true);
  }
});
