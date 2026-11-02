import type {GraphEdge, GraphNode, Point} from '../../model/types';
import type {MindMapSettings} from '../../mind-map-settings';
import {nodeSize} from '../canvas/node-size';
import type {NativeRenderer} from './types';

export interface EdgePaths {paths: Point[][]}
export interface EdgeRoute {kind: 'outer'; lane: number; side: 'left' | 'right' | 'top' | 'bottom'; parent?: string}
export const edgeKey = (edge: GraphEdge): string => JSON.stringify([edge.kind, ...[edge.source, edge.target].sort()]);

/** Ordinary sibling/association edges keep their curves; only outer relationships get tracks. */
export function planEdgeRoutes(core: Map<string, GraphNode>, positions: Record<string, Point>, edges: GraphEdge[]): Map<string, EdgeRoute> {
  const routes = new Map<string, EdgeRoute>();
  const outer: {edge: GraphEdge; side: EdgeRoute['side']; low: number; high: number; parent?: string}[] = [];
  const ys = [...core.keys()].flatMap(id => positions[id] ? [positions[id]!.y] : []);
  const middle = ys.length ? Math.min(...ys) + Math.max(...ys) : 0;
  for (const edge of edges) {
    const a = core.get(edge.source), b = core.get(edge.target);
    const from = positions[edge.source], to = positions[edge.target];
    if (!a || !b || !from || !to) continue;
    const parent = edge.kind === 'hierarchy' ? b.zone === 'jump' ? a.id
      : a.zone === 'jump' ? b.id : undefined : undefined;
    if (parent) {
      outer.push({edge, side: 'top', parent, low: Math.min(from.x, to.x), high: Math.max(from.x, to.x)});
    } else if (edge.kind === 'jump' && ['jump', 'sibling'].includes(a.zone) && ['jump', 'sibling'].includes(b.zone)) {
      const sameColumn = a.zone === b.zone;
      const side = sameColumn ? (a.zone === 'jump' ? 'left' : 'right') : (from.y + to.y < middle ? 'top' : 'bottom');
      outer.push({edge, side, low: Math.min(sameColumn ? from.y : from.x, sameColumn ? to.y : to.x),
        high: Math.max(sameColumn ? from.y : from.x, sameColumn ? to.y : to.x)});
    }
  }
  const tracks = new Map<string, number[]>();
  outer.sort((a, b) => a.low - b.low || a.high - b.high || edgeKey(a.edge).localeCompare(edgeKey(b.edge)));
  for (const item of outer) {
    const lanes = tracks.get(item.side) ?? [];
    let lane = lanes.findIndex(end => end + 16 < item.low);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = item.high; tracks.set(item.side, lanes);
    routes.set(edgeKey(item.edge), {kind: 'outer', side: item.side, lane, ...(item.parent ? {parent: item.parent} : {})});
  }
  return routes;
}

/** Use live positions so endpoints follow native dragging and reorder animations. */
export function routedEdgePaths(renderer: NativeRenderer, edge: GraphEdge, core: Map<string, GraphNode>,
  settings: Readonly<MindMapSettings>, route?: EdgeRoute): EdgePaths | undefined {
  if (!route) return;
  const box = (id: string) => {
    const node = core.get(id), p = renderer.nodeLookup[id];
    if (!node || !p) return;
    const size = nodeSize(node, settings);
    return {x: p.x, y: p.y, left: p.x - size.width / 2, right: p.x + size.width / 2,
      top: p.y - size.height / 2, bottom: p.y + size.height / 2};
  };
  const a = box(edge.source), b = box(edge.target);
  if (!a || !b) return;
  const boxes = [...core.keys()].map(box).filter((item): item is NonNullable<typeof item> => !!item);
  const left = Math.min(...boxes.map(p => p.left)), right = Math.max(...boxes.map(p => p.right));
  const gutter = 22 + route.lane * 8;
  if (route.side === 'left' || route.side === 'right') {
    const isLeft = route.side === 'left', x = isLeft ? left - gutter : right + gutter;
    const from = {x: isLeft ? a.left : a.right, y: a.y}, to = {x: isLeft ? b.left : b.right, y: b.y};
    return {paths: [[from, {x, y: from.y}, {x, y: to.y}, to]]};
  }
  const y = route.side === 'top' ? Math.min(...boxes.map(p => p.top)) - 54 - route.lane * 8
    : Math.max(...boxes.map(p => p.bottom)) + 32 + route.lane * 8;
  if (route.parent) {
    const parent = box(route.parent)!, leaf = route.parent === edge.source ? b : a;
    const isLeft = leaf.x < parent.x, x = isLeft ? left - gutter : right + gutter;
    const parentIsAbove = core.get(route.parent)?.zone === 'parent';
    const exit = parent.x <= leaf.x ? left - gutter : right + gutter;
    const path = parentIsAbove ? [{x: parent.x, y: parent.top}, {x: parent.x, y}]
      : [{x: parent.x <= leaf.x ? parent.left : parent.right, y: parent.y}, {x: exit, y: parent.y}, {x: exit, y}];
    path.push({x, y}, {x, y: leaf.y}, {x: isLeft ? leaf.left : leaf.right, y: leaf.y});
    return {paths: [route.parent === edge.source ? path : path.reverse()]};
  }
  const focus = [...core.values()].find(node => node.zone === 'focus');
  const focusX = focus ? box(focus.id)?.x ?? 0 : 0;
  const side = (p: NonNullable<ReturnType<typeof box>>) => p.x < focusX ? -1 : 1;
  const sa = side(a), sb = side(b);
  const from = {x: sa < 0 ? a.left : a.right, y: a.y}, to = {x: sb < 0 ? b.left : b.right, y: b.y};
  const ax = sa < 0 ? left - gutter : right + gutter, bx = sb < 0 ? left - gutter : right + gutter;
  return {paths: [[from, {x: ax, y: from.y}, {x: ax, y}, {x: bx, y}, {x: bx, y: to.y}, to]]};
}

/** Keep all edges visible; interaction emphasizes the active note's direct connections. */
export function edgeAppearance(edge: GraphEdge, core: Map<string, GraphNode>, active?: string): {alpha: number; width: number} {
  const focus = core.get(edge.source)?.zone === 'focus' || core.get(edge.target)?.zone === 'focus';
  const associated = core.get(edge.source)?.zone === 'jump' || core.get(edge.target)?.zone === 'jump';
  const primary = focus || (edge.kind === 'hierarchy' && !associated);
  const inspecting = active && core.has(active) && core.get(active)?.zone !== 'focus';
  if (inspecting && (edge.source === active || edge.target === active)) return {alpha: 1, width: 1.8};
  return {alpha: inspecting ? (primary ? .35 : .12) : (primary ? .85 : .28), width: primary ? 1.5 : 1.05};
}
