import type { GraphAccess, GraphEdge, GraphNode, Neighborhood, NoteId, Zone } from '../model/types';

const zones: Zone[] = ['focus', 'parent', 'child', 'jump', 'sibling', 'outer'];
const pair = (a: NoteId, b: NoteId) => JSON.stringify(a < b ? [a, b] : [b, a]);
const compare = (a: GraphNode, b: GraphNode) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id);

export function buildNeighborhood(graph: GraphAccess, focus: NoteId, maxNodes = 200, preferredId?: NoteId, root?: NoteId | null): Neighborhood {
  const counts: Record<Zone, number> = { focus: 0, parent: 0, child: 0, jump: 0, sibling: 0, outer: 0 };
  const result: Neighborhood = { focus, nodes: [], edges: [], overflow: [], parents: [], counts };
  if (root && graph.get(root)) result.root = root;
  if (!graph.get(focus)) return result;
  const nodes = new Map<NoteId, GraphNode>();
  const add = (id: NoteId, zone: Zone) => {
    const existing = nodes.get(id);
    if (existing) return;
    const note = graph.get(id);
    if (note) nodes.set(id, { id, title: note.title, kind: note.kind, notePath: note.notePath, links: note.links, ...(note.icon ? {icon: note.icon} : {}),
      zone, groupParents: [], issues: [...note.issues] });
  };
  add(focus, 'focus');
  const parents = graph.parents(focus);
  for (const id of parents) add(id, 'parent');
  for (const id of graph.children(focus)) add(id, 'child');
  for (const id of graph.linked(focus)) add(id, 'jump');
  for (const parent of parents) {
    const note = graph.get(parent)!;
    result.parents.push({ id: parent, title: note.title });
    for (const id of graph.children(parent)) {
      if (id === focus) continue;
      add(id, 'sibling');
      nodes.get(id)?.groupParents.push(parent);
    }
  }
  const ordered: GraphNode[] = [];
  for (const zone of zones) {
    const group = [...nodes.values()].filter(node => node.zone === zone);
    group.sort(compare);
    counts[zone] = group.length;
    ordered.push(...group);
  }
  result.parents.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
  const limit = Number.isFinite(maxNodes) ? Math.min(200, Math.max(1, Math.floor(maxNodes))) : 200;
  result.nodes = ordered.slice(0, limit);
  result.overflow = ordered.slice(limit);
  const preferred = result.overflow.find(node => node.id === preferredId);
  if (preferred) {
    if (result.nodes.length > 1) {
      const displaced = result.nodes.pop()!;
      result.nodes.push(preferred);
      result.overflow = result.overflow.filter(node => node !== preferred);
      result.overflow.unshift(displaced);
    }
  }
  result.edges = visibleEdges(graph, result.nodes);
  return result;
}

function visibleEdges(graph: GraphAccess, nodes: GraphNode[]): GraphEdge[] {
  const core = nodes;
  const visible = new Set(core.map(node => node.id));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of core) {
    for (const parent of graph.parents(node.id)) {
      if (!visible.has(parent)) continue;
      const key = JSON.stringify(['hierarchy', parent, node.id]);
      if (!seen.has(key)) { seen.add(key); edges.push({ source: parent, target: node.id, kind: 'hierarchy' }); }
    }
    for (const jump of graph.linked(node.id)) {
      if (!visible.has(jump)) continue;
      const key = `jump:${pair(node.id, jump)}`;
      if (!seen.has(key)) { seen.add(key); edges.push({ source: node.id, target: jump, kind: 'jump' }); }
    }
  }
  return edges;
}
