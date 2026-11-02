import {DEFAULT_MIND_MAP, type MindMapSettings} from '../../mind-map-settings';
import type {GraphEdge, GraphNode, Neighborhood, Point} from '../../model/types';
import {nodeSize} from './node-size';

export type WindowZone = 'parent' | 'child' | 'sibling' | 'jump';
export type WindowOffsets = Partial<Record<WindowZone, number>>;
export interface ChildRoute extends Point {drawStem?: boolean; drawTrunk?: boolean}
export interface RelationWindow {
  zone: WindowZone; x: number; y: number; width: number; height: number;
  axis: 'x' | 'y'; offset: number; max: number; count: number; extent: number;
}
export interface WindowLayout {
  snapshot: Neighborhood; positions: Record<string, Point>; opacity: Record<string, number>;
  childRoutes: Record<string, ChildRoute>;
  windows: RelationWindow[]; offsets: WindowOffsets; width: number; height: number;
}
export const windowNames: Record<WindowZone, string> = {parent: '父级', child: '子级', sibling: '同级', jump: '关联'};

/** Center the fullest span of complete columns nearest the collection's midpoint. */
function centeredChildOffset(lengths: number[], gap: number, extent: number, max: number): number {
  if (!max) return 0;
  let first = 0, left = 0, span = 0, bestCount = 0, bestDistance = Infinity, offset = max / 2;
  for (let last = 0; last < lengths.length; last++) {
    span += lengths[last]! + (last > first ? gap : 0);
    while (span > extent && first < last) {
      const step = lengths[first++]! + gap;
      left += step; span -= step;
    }
    const count = last - first + 1, center = left + span / 2;
    const distance = Math.abs(center - (max + extent) / 2);
    if (count > bestCount || (count === bestCount && distance < bestDistance)) {
      bestCount = count; bestDistance = distance; offset = center - extent / 2;
    }
  }
  return Math.max(0, Math.min(max, offset));
}

/** All relatives remain navigable, including those beyond the graph's peripheral-node budget. */
export function windowSource(snapshot: Neighborhood): Neighborhood {
  const nodes = [...snapshot.nodes, ...snapshot.overflow.filter(node => node.zone !== 'outer')];
  const edges = [...snapshot.edges];
  const keys = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target, edge.kind])));
  const add = (source: string, target: string, kind: GraphEdge['kind'] = 'hierarchy') => {
    const key = JSON.stringify([source, target, kind]);
    if (!keys.has(key)) {edges.push({source, target, kind}); keys.add(key);}
  };
  for (const node of nodes) {
    if (node.zone === 'child') add(snapshot.focus, node.id);
    if (node.zone === 'parent') add(node.id, snapshot.focus);
    if (node.zone === 'sibling') for (const parent of node.groupParents) add(parent, node.id);
    if (node.zone === 'jump' && !edges.some(edge => edge.kind === 'jump' &&
      ((edge.source === snapshot.focus && edge.target === node.id) || (edge.target === snapshot.focus && edge.source === node.id)))) add(snapshot.focus, node.id, 'jump');
  }
  return {...snapshot, nodes, edges, overflow: snapshot.overflow.filter(node => node.zone === 'outer')};
}

/** Stable focus and bounded, transparent relation windows. Never fit the whole collection. */
export function relationWindowLayout(snapshot: Neighborhood, size: {width: number; height: number}, offsets: WindowOffsets = {},
  settings: Readonly<MindMapSettings> = DEFAULT_MIND_MAP): WindowLayout {
  const width = Math.max(680, size.width);
  const childRowHeight = 48 + settings.fontSize - 16;
  const siblingCount = snapshot.nodes.filter(node => node.zone === 'sibling').length;
  const jumpCount = snapshot.nodes.filter(node => node.zone === 'jump').length;
  const sideGap = {compact: 8, standard: 10, spacious: 14}[settings.spacing];
  const siblingRows = Math.min(7, Math.max(1, siblingCount));
  const siblingHeight = siblingRows * childRowHeight + (siblingRows - 1) * sideGap;
  const jumpRows = Math.min(7, Math.max(1, jumpCount));
  const jumpHeight = jumpRows * childRowHeight + (jumpRows - 1) * sideGap;
  const focusHeight = childRowHeight + 12;
  const minimumHeight = siblingCount ? 2 * (34 + siblingHeight / 2 + (focusHeight + childRowHeight) / 2 + 40) : 500;
  const height = Math.max(500, size.height, minimumHeight, jumpCount ? jumpHeight + 68 : 0);
  const gap = {compact: 24, standard: 38, spacious: 58}[settings.spacing];
  const sideWidth = Math.min(300, width * .25);
  const distance = .85 + settings.lineLength / 100 * .15;
  // Keep the scroll hit area clear of the host's search/settings icon rail.
  const sideX = Math.min(width * .22 * distance, width / 2 - sideWidth - 84);
  const childRowGap = {compact: 16, standard: 22, spacious: 30}[settings.spacing];
  const childHeight = childRowHeight * 2 + childRowGap + 36;
  const parentY = Math.max(-height * .34 * distance,
    siblingCount ? -height / 2 + 34 + siblingHeight / 2 - childRowHeight / 2 : -Infinity);
  const parentCenter = parentY + childRowHeight / 2;
  const childY = Math.min(Math.max(height * .18 * distance, siblingCount ? parentCenter + siblingHeight / 2 + 48 : -Infinity),
    height / 2 - childHeight - 18);
  const windows: RelationWindow[] = [
    {zone: 'parent', x: -width * .25, y: parentY, width: width * .5, height: 78, axis: 'x', offset: 0, max: 0, count: 0, extent: 0},
    {zone: 'child', x: -width * .39, y: childY, width: width * .78, height: childHeight, axis: 'x', offset: 0, max: 0, count: 0, extent: 0},
    {zone: 'sibling', x: sideX, y: parentCenter - siblingHeight / 2, width: sideWidth, height: siblingHeight, axis: 'y', offset: 0, max: 0, count: 0, extent: 0},
    {zone: 'jump', x: -sideX - sideWidth, y: -jumpHeight / 2, width: sideWidth, height: jumpHeight, axis: 'y', offset: 0, max: 0, count: 0, extent: 0},
  ];
  const positions: Record<string, Point> = {[snapshot.focus]: {x: 0, y: 0}};
  const display = new Map<string, GraphNode>();
  const shorten = (node: GraphNode, limit: number): GraphNode => {
    const characters = Array.from(node.title);
    const length = characters.length;
    while (characters.length > 1 && nodeSize({...node, displayTitle: characters.join('') + (characters.length < length ? '…' : '')}, settings).width > limit) characters.pop();
    return characters.length === length ? node : {...node, displayTitle: characters.join('') + '…'};
  };
  const focus = snapshot.nodes.find(node => node.id === snapshot.focus);
  if (focus) display.set(focus.id, shorten(focus, Math.max(120, Math.min(300, sideX * 2 - 64))));
  const opacity: Record<string, number> = {};
  const childRoutes: Record<string, ChildRoute> = {};
  const visible = new Set([snapshot.focus]);
  const nextOffsets: WindowOffsets = {};
  for (const window of windows) {
    const nodes = snapshot.nodes.filter(node => node.zone === window.zone).map(node => {
      const limit = Math.min(280, window.width - 28, window.zone === 'parent' ? sideX * 2 - 40 : Infinity);
      const shown = shorten(node, limit);
      display.set(node.id, shown); return shown;
    });
    window.count = nodes.length;
    const horizontal = window.axis === 'x';
    const rows = window.zone === 'child' ? 2 : 1;
    const sizes = nodes.map(node => nodeSize(node, settings));
    const lengths: number[] = [];
    for (let index = 0; index < sizes.length; index += rows) {
      lengths.push(Math.max(...sizes.slice(index, index + rows).map(s => horizontal ? s.width : s.height)));
    }
    const extent = horizontal ? window.width : window.height;
    const stepGap = horizontal ? (window.zone === 'child' ? {compact: 32, standard: 48, spacious: 68}[settings.spacing] : gap)
      : sideGap;
    const total = lengths.reduce((sum, n) => sum + n, 0) + Math.max(0, lengths.length - 1) * stepGap;
    window.extent = extent;
    window.max = Math.max(0, total - extent);
    const defaultOffset = window.zone === 'child' ? centeredChildOffset(lengths, stepGap, extent, window.max) : 0;
    window.offset = Math.max(0, Math.min(window.max, Number.isFinite(offsets[window.zone]) ? offsets[window.zone]! : defaultOffset));
    nextOffsets[window.zone] = window.offset;
    // Both side windows show complete rows while retaining raw wheel/trackpad progress.
    const displayOffset = !horizontal && lengths.length ? Math.round(window.offset / (lengths[0]! + stepGap)) * (lengths[0]! + stepGap) : window.offset;
    let cursor = window.max ? -displayOffset : (extent - total) / 2;
    const starts = lengths.map(length => {const start = cursor; cursor += length + stepGap; return start;});
    nodes.forEach((node, index) => {
      const column = Math.floor(index / rows), row = index % rows;
      const length = lengths[column]!, s = sizes[index]!;
      // Keep the whole title inside the window. A short fade softens entry/exit without
      // making invisible labels intercept clicks outside their own scrolling region.
      const start = starts[column]!, end = start + length;
      if (end < 0 || start > extent) return;
      const coverage = Math.min(1, (Math.min(end, extent) - Math.max(0, start)) / length);
      if (coverage < .82) return;
      const center = Math.max(length / 2, Math.min(extent - length / 2, (start + end) / 2));
      const phase = extent ? center / extent : .5;
      positions[node.id] = horizontal
        ? {x: window.x + center, y: window.y + s.height / 2 + (window.zone === 'child' ? row * (childRowHeight + childRowGap) + 10 * Math.sin(phase * Math.PI) : 0)}
        : {x: window.zone === 'sibling' ? window.x + 12 + s.width / 2 : window.x + window.width - 12 - s.width / 2,
          y: window.y + center};
      if (window.zone === 'child') {
        const point = positions[node.id]!;
        // The shared stem follows the column's center. The lower segment starts
        // at the upper card's bottom, so no duplicate stroke crosses its label.
        childRoutes[node.id] = {x: point.x, y: row === 0 ? window.y - 16 : point.y - childRowGap - s.height / 2, drawStem: row === 0};
      }
      opacity[node.id] = coverage < 1 ? .3 + (coverage - .82) / .18 * .7 : 1;
      visible.add(node.id);
    });
  }
  // One fully visible column owns the common trunk to avoid dark overlapping strokes.
  const upperRoutes = Object.entries(childRoutes).filter(([, route]) => route.drawStem);
  const trunkOwner = upperRoutes.find(([id]) => opacity[id] === 1) ?? upperRoutes[0];
  if (trunkOwner) trunkOwner[1].drawTrunk = true;
  // Peripheral notes remain owned by the native worker.
  const nodes = snapshot.nodes.filter(node => visible.has(node.id) || node.zone === 'outer').map(node => display.get(node.id) ?? node);
  const ids = new Set(nodes.map(node => node.id));
  return {snapshot: {...snapshot, nodes, edges: snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))},
    positions, opacity, childRoutes, windows, offsets: nextOffsets, width, height};
}
