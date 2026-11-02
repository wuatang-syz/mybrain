import type {GraphNode, Neighborhood} from '../../model/types';

export const GROUP_LIMIT = 6;
export interface FoldGroup {
  key: string;
  parent: string;
  zone: 'child' | 'sibling';
  expanded: boolean;
  hidden: number;
}

export function siblingParent(snapshot: Neighborhood, node: GraphNode): string {
  return snapshot.parents.find(parent => node.groupParents.includes(parent.id))?.id ?? '';
}

export function foldGroups(snapshot: Neighborhood, expanded: Set<string>, limit = GROUP_LIMIT): {snapshot: Neighborhood; groups: FoldGroup[]} {
  const members = new Map<string, {parent: string; zone: 'child' | 'sibling'; nodes: GraphNode[]}>();
  for (const node of snapshot.nodes) {
    if (node.zone !== 'child' && node.zone !== 'sibling') continue;
    const parent = node.zone === 'child' ? snapshot.focus : siblingParent(snapshot, node);
    const key = `${node.zone}:${parent}`;
    const group = members.get(key) ?? {parent, zone: node.zone, nodes: []};
    group.nodes.push(node);
    members.set(key, group);
  }
  const hiddenIds = new Set<string>();
  const groups: FoldGroup[] = [];
  for (const [key, group] of members) {
    if (group.nodes.length <= limit) continue;
    const isExpanded = expanded.has(key);
    groups.push({key, parent: group.parent, zone: group.zone, expanded: isExpanded, hidden: group.nodes.length - limit});
    if (!isExpanded) for (const node of group.nodes.slice(limit)) hiddenIds.add(node.id);
  }
  return {snapshot: {...snapshot,
    nodes: snapshot.nodes.filter(node => !hiddenIds.has(node.id)),
    edges: snapshot.edges.filter(edge => !hiddenIds.has(edge.source) && !hiddenIds.has(edge.target)),
  }, groups};
}
