import {describe, expect, it, vi} from 'vitest';
import {edgeAppearance, edgeKey, planEdgeRoutes, routedEdgePaths} from '../src/ui/native-graph/edge-routing';
import {drawEdgePath} from '../src/ui/native-graph/edge-path';
import {DEFAULT_MIND_MAP} from '../src/mind-map-settings';
import {nodeSize} from '../src/ui/canvas/node-size';
import type {GraphEdge, GraphNode, Point} from '../src/model/types';
import type {Graphics, NativeRenderer} from '../src/ui/native-graph/types';

function fixture() {
  const nodes: GraphNode[] = [
    {id: 'Focus', title: 'Focus', zone: 'focus', groupParents: [], issues: []},
    {id: 'Parent', title: 'Parent', zone: 'parent', groupParents: [], issues: []},
    ...['Left A', 'Left B'].map(id => ({id, title: id, zone: 'jump' as const, groupParents: [], issues: []})),
    ...['Right A', 'Right B'].map(id => ({id, title: id, zone: 'sibling' as const, groupParents: ['Parent'], issues: []})),
  ];
  const core = new Map(nodes.map(n => [n.id, n]));
  const positions: Record<string, Point> = {Focus: {x: 0, y: 0}, Parent: {x: 0, y: -110},
    'Left A': {x: -280, y: -60}, 'Left B': {x: -280, y: 60},
    'Right A': {x: 280, y: -170}, 'Right B': {x: 280, y: -50}};
  const edge = (source: string, target: string, kind: GraphEdge['kind'] = 'jump'): GraphEdge => ({source, target, kind});
  const edges = [edge('Focus', 'Left A'), edge('Left B', 'Focus'),
    edge('Parent', 'Right A', 'hierarchy'), edge('Parent', 'Right B', 'hierarchy'),
    edge('Left A', 'Left B'), edge('Right A', 'Right B'), edge('Left A', 'Right A'), edge('Left B', 'Right B')];
  const renderer = {nodeLookup: Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, {id, ...p}]))} as unknown as NativeRenderer;
  const routes = planEdgeRoutes(core, positions, edges);
  const paths = (e: GraphEdge) => routedEdgePaths(renderer, e, core, DEFAULT_MIND_MAP, routes.get(edgeKey(e)))!;
  return {core, positions, edges, renderer, routes, paths, edge};
}

describe('readable local relationship routing', () => {
  it('leaves sibling and center association edges on their normal curve renderer', () => {
    const f = fixture();
    for (const e of f.edges.slice(0, 4)) {
      expect(f.routes.has(edgeKey(e))).toBe(false);
      expect(f.paths(e)).toBeUndefined();
    }
  });
  it('uses outer-facing ports and separate tracks for same-column links without loops', () => {
    const f = fixture();
    for (const i of [4, 5]) {
      const e = f.edges[i]!, path = f.paths(e).paths[0]!;
      expect(path).toHaveLength(4);
      expect(path[1]!.x).toBe(path[2]!.x);
      const source = f.core.get(e.source)!, size = nodeSize(source);
      const side = source.zone === 'jump' ? -1 : 1;
      expect(path[0]!.x).toBe(f.positions[e.source]!.x + side * size.width / 2);
      expect((path[1]!.x - path[0]!.x) * side).toBeGreaterThan(0);
      expect(path[0]!.y).toBe(f.positions[e.source]!.y);
      expect(path[3]!.y).toBe(f.positions[e.target]!.y);
    }
  });
  it('routes folder links to associated notes outside the card group in both source directions', () => {
    const f = fixture();
    const edges = [f.edge('Parent', 'Left A', 'hierarchy'), f.edge('Parent', 'Left B', 'hierarchy')];
    const routes = planEdgeRoutes(f.core, f.positions, edges);
    const paths = edges.map(e => routedEdgePaths(f.renderer, e, f.core, DEFAULT_MIND_MAP, routes.get(edgeKey(e)))!);
    for (const [index, routed] of paths.entries()) {
      const path = routed.paths[0]!;
      expect(path).toHaveLength(5);
      expect(path[0]).toEqual({x: 0, y: -110 - nodeSize(f.core.get('Parent')!).height / 2});
      expect(path[1]!.y).toBeLessThan(-170 - nodeSize(f.core.get('Right A')!).height / 2);
      expect(path[2]!.x).toBeLessThan(-280 - nodeSize(f.core.get('Left A')!).width / 2);
      expect(path[3]!.y).toBe(f.positions[edges[index]!.target]!.y);
      expect(path[4]!.x).toBeLessThan(-280);
      const reversed = {...edges[index]!, source: edges[index]!.target, target: 'Parent'};
      const reverse = routedEdgePaths(f.renderer, reversed, f.core, DEFAULT_MIND_MAP, routes.get(edgeKey(reversed)))!;
      expect(reverse.paths[0]).toEqual([...path].reverse());
    }
    expect(paths[0]!.paths[0]![1]!.y).not.toBe(paths[1]!.paths[0]![1]!.y);
  });
  it('routes cross-column links outside all cards rather than through the center', () => {
    const f = fixture();
    for (const e of f.edges.slice(6)) {
      const path = f.paths(e).paths[0]!;
      expect(path).toHaveLength(6);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const node of f.core.values()) {
          const p = f.positions[node.id]!, s = nodeSize(node);
          const intersects = a.x === b.x
            ? a.x > p.x - s.width / 2 + .01 && a.x < p.x + s.width / 2 - .01 &&
              Math.max(a.y, b.y) > p.y - s.height / 2 && Math.min(a.y, b.y) < p.y + s.height / 2
            : a.y > p.y - s.height / 2 + .01 && a.y < p.y + s.height / 2 - .01 &&
              Math.max(a.x, b.x) > p.x - s.width / 2 && Math.min(a.x, b.x) < p.x + s.width / 2;
          expect(intersects, `${e.source} → ${e.target} crosses ${node.id}`).toBe(false);
        }
      }
    }
  });
  it('routes an associated note to its folder even when that folder is shown in the sibling column', () => {
    const f = fixture();
    const edge = f.edge('Right B', 'Left B', 'hierarchy');
    const routes = planEdgeRoutes(f.core, f.positions, [...f.edges, edge]);
    const path = routedEdgePaths(f.renderer, edge, f.core, DEFAULT_MIND_MAP, routes.get(edgeKey(edge)))!.paths[0]!;
    expect(path).toHaveLength(6);
    expect(path[0]!.x).toBeGreaterThan(280);
    expect(path[1]!.x).toBeGreaterThan(path[0]!.x);
    expect(path[2]!.y).toBeLessThan(-170-24);
    expect(path[3]!.y).toBe(path[2]!.y);
    expect(path[4]!.x).toBeLessThan(-280-nodeSize(f.core.get('Left B')!).width/2);
    expect(path[5]!.y).toBe(60);
  });
  it('keeps routing deterministic and endpoints attached during node movement', () => {
    const f = fixture();
    expect(planEdgeRoutes(f.core, f.positions, [...f.edges].reverse())).toEqual(f.routes);
    const e = f.edges[6]!, before = f.paths(e).paths[0]!;
    f.renderer.nodeLookup[e.source]!.x -= 20;
    f.renderer.nodeLookup[e.source]!.y += 10;
    const after = f.paths(e).paths[0]!;
    expect(after[0]).toEqual({x: before[0]!.x - 20, y: before[0]!.y + 10});
    expect(after[1]!.y).toBe(after[0]!.y);
  });
  it('highlights incident links without hiding unrelated relationships', () => {
    const f = fixture(), secondary = f.edges[6]!;
    const primary = edgeAppearance(f.edges[0]!, f.core);
    const normal = edgeAppearance(secondary, f.core);
    const selected = edgeAppearance(secondary, f.core, secondary.source);
    expect(primary.alpha).toBeGreaterThan(normal.alpha);
    expect(selected.alpha).toBeGreaterThan(primary.alpha);
    expect(selected.width).toBeGreaterThan(normal.width);
    for (const e of f.edges) expect(edgeAppearance(e, f.core, 'Left B').alpha).toBeGreaterThan(0);
    expect(edgeAppearance(secondary, f.core, 'missing')).toEqual(normal);
  });
  it('draws outer gutters exclusively with straight segments and exact endpoints', () => {
    const graphic = {moveTo: vi.fn(), lineTo: vi.fn(), bezierCurveTo: vi.fn()} as unknown as Graphics;
    drawEdgePath(graphic, [{x: 0, y: 0}, {x: -4, y: 0}, {x: -4, y: 50}, {x: -30, y: 50}]);
    expect(graphic.moveTo).toHaveBeenCalledWith(0, 0);
    expect(graphic.lineTo).toHaveBeenLastCalledWith(-30, 50);
    expect(graphic.bezierCurveTo).not.toHaveBeenCalled();
    expect(graphic.lineTo).toHaveBeenCalledTimes(3);
  });
});
