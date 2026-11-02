import type {MindMapSettings} from '../../mind-map-settings';
import type { GraphEdge, GraphNode, LayoutState, Neighborhood, Point } from '../../model/types';
import { computeLayout, type CanvasLayout } from '../canvas/layout';
import type { FoldGroup } from '../canvas/groups';
import type { NativeData } from './types';
import type {GraphAccess} from '../../model/types';

/** Replace file-only native data with the shared directory projection. */
export function directoryGraphData(graph: GraphAccess, base?: NativeData): NativeData {
  const records = graph.all();
  const nodes: NativeData['nodes'] = {};
  for (const record of records) {
    if (base && record.kind === 'note' && !base.nodes[record.notePath ?? record.id]) continue;
    nodes[record.id] = {type: '', links: {}};
  }
  for (const record of records) {
    const node = nodes[record.id]; if (!node) continue;
    for (const target of [...record.parents, ...record.links]) if (nodes[target] && target !== record.id) node.links[target] = true;
  }
  return {...base, nodes};
}

/** Folding and display limits hide nodes without changing the vault relationship model. */
export function hiddenNativeNodes(snapshot: Neighborhood, visible: Set<string>): Set<string> {
  return new Set([
    ...snapshot.nodes.filter(node => !visible.has(node.id)).map(node => node.id),
    ...snapshot.overflow.filter(node => !visible.has(node.id)).map(node => node.id),
  ]);
}

export function structuralNodes(snapshot: Neighborhood): Map<string, GraphNode> {
  return new Map(snapshot.nodes.filter(node => node.zone !== 'outer').map(node => [node.id, node]));
}
export function structuralPositions(snapshot: Neighborhood): Record<string, Point> {
  return structuralLayout(snapshot).positions;
}
export function structuralLayout(snapshot: Neighborhood, folds: FoldGroup[] = [], saved?: LayoutState, settings?: MindMapSettings): CanvasLayout {
  // No peripheral layout is computed here; the native worker owns every round node.
  return computeLayout({...snapshot, nodes: snapshot.nodes.filter(node => node.zone !== 'outer')}, saved, folds, settings);
}
export function filteredGraphData(data: NativeData, hidden = new Set<string>()): NativeData {
  const nodes = Object.fromEntries(Object.entries(data.nodes).filter(([id]) => !hidden.has(id))
    .map(([id, node]) => [id, {...node, links: Object.fromEntries(Object.entries(node.links).filter(([target]) => !hidden.has(target)))}]));
  return {...data, nodes};
}
export function relationEdge(edges: GraphEdge[], source: string, target: string): GraphEdge | undefined {
  return edges.find(edge => ((edge.source === source && edge.target === target) || (edge.source === target && edge.target === source)));
}
