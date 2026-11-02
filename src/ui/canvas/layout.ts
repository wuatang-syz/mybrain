import {DEFAULT_MIND_MAP, type MindMapSettings} from '../../mind-map-settings';
import type { GraphEdge, GraphNode, LayoutState, Neighborhood, Point } from '../../model/types';
import { siblingParent, type FoldGroup } from './groups';
import { outerNetwork } from './outer-network';
import { nodeSize } from './node-size';
export { nodeSize } from './node-size';

export interface GroupLabel extends Point { text: string; kind: string }
export interface DropArea extends Point { width: number; height: number }
export type DropAreas = Record<'parent' | 'child' | 'jump' | 'sibling', DropArea>;
export interface GroupToggle extends Point { key: string; expanded: boolean; hidden: number }
export interface CanvasLayout { positions: Record<string, Point>; labels: GroupLabel[]; areas: DropAreas; toggles: GroupToggle[] }
export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 48;
export const DEFAULT_AREAS: DropAreas = {
  parent: { x: -270, y: -240, width: 540, height: 128 },
  child: { x: -270, y: 112, width: 540, height: 128 },
  jump: { x: -496, y: -92, width: 240, height: 184 },
  sibling: { x: 256, y: -220, width: 240, height: 280 },
};

function zoneArea(points: (Point & {width: number})[], fallback: DropArea): DropArea {
  if (!points.length) return { ...fallback };
  const x = Math.min(...points.map(p => p.x - p.width / 2)) - 36;
  const y = Math.min(...points.map(p => p.y)) - 64;
  return { x, y, width: Math.max(...points.map(p => p.x + p.width / 2)) + 36 - x,
    height: Math.max(...points.map(p => p.y)) + 64 - y };
}

/** Structural nodes use directional slots; peripheral notes retain their saved positions. */
export function computeLayout(snapshot: Neighborhood, saved?: LayoutState, folds: FoldGroup[] = [], settings: Readonly<MindMapSettings> = DEFAULT_MIND_MAP): CanvasLayout {
  const gap = {compact: .75, standard: 1, spacious: 1.5}[settings.spacing];
  const length = settings.lineLength / 100;
  const height = 48 + settings.fontSize - 16;
  const rowStep = height + 28 * gap, sideStep = height + 24 * gap;
  const positions: Record<string, Point> = { [snapshot.focus]: { x: 0, y: 0 } };
  const labels: GroupLabel[] = [];
  const toggles: GroupToggle[] = [];
  const group = (zone: GraphNode['zone']) => snapshot.nodes.filter(node => node.zone === zone);
  for (const zone of ['parent', 'child'] as const) {
    const nodes = group(zone);
    const sign = zone === 'parent' ? -1 : 1;
    nodes.forEach((node, index) => {
      const row = Math.floor(index / 3);
      const count = Math.min(3, nodes.length - row * 3);
      const stride = Math.max(120, ...nodes.slice(row * 3, row * 3 + count).map(item => nodeSize(item, settings).width + 28 * gap));
      positions[node.id] = { x: ((index % 3) - (count - 1) / 2) * stride, y: sign * (height + 72 * gap * length + row * rowStep) };
    });
    const fold = folds.find(item => item.zone === zone);
    if (fold && nodes.length) toggles.push({...fold, x: 0, y: Math.max(...nodes.map(node => positions[node.id]!.y)) + height / 2 + 36 * gap});
  }
  const sideWidth = Math.max(64, ...snapshot.nodes.filter(node => node.zone === 'jump' || node.zone === 'sibling').map(node => nodeSize(node, settings).width));
  const sideStride = sideWidth + 28 * gap;
  const sideX = Math.max(200 + 72 * (length - 1), ...snapshot.nodes.filter(node => positions[node.id]).map(node => Math.abs(positions[node.id]!.x) + nodeSize(node, settings).width / 2 + sideWidth / 2 + 36 * gap * length));
  const jumps = group('jump');
  jumps.forEach((node, index) => {
    positions[node.id] = { x: -sideX - Math.floor(index / 5) * sideStride,
      y: ((index % 5) - (Math.min(5, jumps.length) - 1) / 2) * sideStep };
  });
  const siblingGroups = new Map<string, GraphNode[]>();
  for (const node of group('sibling')) {
    const parent = siblingParent(snapshot, node);
    siblingGroups.set(parent, [...(siblingGroups.get(parent) ?? []), node]);
  }
  const siblingHeight = [...siblingGroups.values()].reduce((total, nodes) => total + (Math.min(nodes.length, 5) - 1) * sideStep + height, 0)
    + Math.max(0, siblingGroups.size - 1) * 74 * gap;
  let siblingY = -siblingHeight / 2 + 24;
  const orderedGroups = [...siblingGroups].sort(([a], [b]) => {
    const left = positions[a], right = positions[b];
    return left && right ? left.y - right.y || left.x - right.x : snapshot.parents.findIndex(p => p.id === a) - snapshot.parents.findIndex(p => p.id === b);
  });
  for (const [parent, nodes] of orderedGroups) {
    if (snapshot.parents.length > 1) {
      labels.push({ x: sideX, y: siblingY - height / 2 - 6, text: snapshot.parents.find(p => p.id === parent)?.title ?? '共同父级', kind: 'group' });
    }
    nodes.forEach((node, index) => {
      positions[node.id] = { x: sideX + Math.floor(index / 5) * sideStride, y: siblingY + (index % 5) * sideStep };
    });
    const fold = folds.find(item => item.zone === 'sibling' && item.parent === parent);
    if (fold) toggles.push({...fold, x: sideX + Math.floor((nodes.length - 1) / 5) * sideStride / 2, y: siblingY + (Math.min(nodes.length, 5) - 1) * sideStep + height / 2 + 32 * gap});
    siblingY += Math.min(nodes.length, 5) * sideStep + 50 * gap + (fold ? 44 : 0);
  }
  const areas = { ...DEFAULT_AREAS };
  for (const zone of ['parent', 'child', 'jump', 'sibling'] as const) {
    areas[zone] = zoneArea(group(zone).map(node => ({...positions[node.id]!, width: nodeSize(node, settings).width})), DEFAULT_AREAS[zone]);
  }
  areas.sibling.height = Math.max(280, areas.sibling.height);
  if (!jumps.length) areas.jump.x = -sideX - 120;
  if (!group('sibling').length) areas.sibling.x = sideX - 120;
  const core = [...snapshot.nodes.filter(node => positions[node.id]).flatMap(node => {
    const point = positions[node.id]!, half = nodeSize(node, settings).width / 2;
    return [{x: point.x - half, y: point.y}, {x: point.x + half, y: point.y}];
  }), ...toggles];
  Object.assign(positions, outerNetwork(group('outer'), snapshot.edges, core, saved));
  return { positions, labels, areas, toggles };
}

/** Relation semantics select the anchors; siblings never gain an artificial focus edge. */
export function edgePath(source: Point, target: Point, sourceNode: GraphNode, targetNode: GraphNode, kind: GraphEdge['kind'] = 'hierarchy'): string {
  const a = nodeSize(sourceNode), b = nodeSize(targetNode);
  if (sourceNode.zone === 'outer' || targetNode.zone === 'outer') {
    // Outer dots sit 16px above the node box's center; their edges must end on the dots.
    const start = {...source, y: source.y - (sourceNode.zone === 'outer' ? 16 : 0)};
    const end = {...target, y: target.y - (targetNode.zone === 'outer' ? 16 : 0)};
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }
  if (kind === 'jump' || targetNode.zone === 'sibling') {
    const sign = target.x >= source.x ? 1 : -1;
    const start = { x: source.x + sign * a.width / 2, y: source.y };
    const end = { x: target.x - sign * b.width / 2, y: target.y };
    const bend = Math.max(40, Math.abs(end.x - start.x) * .55);
    const arc = kind === 'jump' && Math.abs(end.y - start.y) < 1 ? Math.min(48, Math.abs(end.x - start.x) * .15) : 0;
    return `M ${start.x} ${start.y} C ${start.x + sign * bend} ${start.y + arc}, ${end.x - sign * bend} ${end.y + arc}, ${end.x} ${end.y}`;
  }
  const sign = target.y >= source.y ? 1 : -1;
  const start = { x: source.x, y: source.y + sign * a.height / 2 };
  const end = { x: target.x, y: target.y - sign * b.height / 2 };
  const middle = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} C ${start.x} ${middle}, ${end.x} ${middle}, ${end.x} ${end.y}`;
}
