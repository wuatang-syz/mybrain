import {mapDrawable, knowledgeMap, type MapDrawable, type MapSnapshot} from '../graph/knowledge-map';
import type {GraphAccess, NoteId} from '../model/types';
import type {KnowledgeSnapshot, SnapshotGroup, SnapshotNote, SnapshotRelation} from './types';

export interface SnapshotRequest {attention?: NoteId | null; root?: NoteId | null; selected?: NoteId | null}
export interface SnapshotOptions {budget?: number; expanded?: Iterable<NoteId>}
export interface SnapshotBuild {
  snapshot: KnowledgeSnapshot;
  /** The card based map input, retained so the legacy two-dimensional presenter keeps working. */
  map: MapSnapshot;
  drawable: MapDrawable;
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Depth follows the displayed ownership path: the centre is 0, a group is 1 and a group member is
 * 1 + its distance from that group along real structure. Directory grouping determines ownership, and internal links never contribute depth.
 */
function memberDepths(graph: GraphAccess, map: MapSnapshot): Map<NoteId, number> {
  const depths = new Map<NoteId, number>();
  for (const card of map.cards) {
    const inside = new Set<NoteId>([...card.direct, ...card.deep]);
    const queue: {id: NoteId; depth: number}[] = card.direct.map(id => ({id, depth: 2}));
    for (const entry of queue) if (!depths.has(entry.id)) depths.set(entry.id, entry.depth);
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i]!;
      for (const child of graph.children(entry.id).slice().sort(compare)) {
        if (!inside.has(child) || depths.has(child)) continue;
        depths.set(child, entry.depth + 1);
        queue.push({id: child, depth: entry.depth + 1});
      }
    }
  }
  return depths;
}

/**
 * One level of the knowledge world, expressed without colours, coordinates, materials or world
 * names. Both themes consume exactly this result, so grouping, the expansion budget and search
 * reachability stay shared instead of being re-derived per theme.
 */
export function buildKnowledgeSnapshot(graph: GraphAccess, request: SnapshotRequest = {}, options: SnapshotOptions = {}): SnapshotBuild {
  const map = knowledgeMap(graph, request);
  const drawable = mapDrawable(map, {budget: options.budget, expanded: options.expanded, selected: request.selected ?? map.selected});
  const drawn = new Set(drawable.drawn);
  const depths = memberDepths(graph, map);
  const titles = new Map(map.nodes.map(node => [node.id, node.title]));
  const groups: SnapshotGroup[] = map.cards.map(card => {
    return {id: card.id, title: card.title, depth: 1, members: [...card.members], hidden: drawable.hidden[card.id] ?? 0,
      drillable: card.direct.length > 0};
  });
  const notes: SnapshotNote[] = [];
  for (const card of map.cards) {
    for (const id of card.members) {
      if (!drawn.has(id)) continue;
      notes.push({id, title: titles.get(id) ?? id, group: card.id, depth: depths.get(id) ?? 2,
        expandable: card.direct.includes(id) && graph.children(id).length > 0});
    }
  }
  const relations: SnapshotRelation[] = [];
  const seen = new Set<string>();
  const push = (source: NoteId, target: NoteId, kind: SnapshotRelation['kind']) => {
    const key = `${kind}:${source}->${target}`;
    if (seen.has(key)) return;
    seen.add(key); relations.push({source, target, kind});
  };
  for (const edge of map.edges) push(edge.source, edge.target, 'hierarchy');
  for (const edge of map.jumps) push(edge.source, edge.target, 'jump');
  const realGroups = groups.length;
  const snapshot: KnowledgeSnapshot = {
    level: map.attention ? {id: map.attention, title: map.attentionTitle ?? map.attention} : null,
    root: map.root,
    selected: map.selected,
    groups,
    notes,
    relations,
    drawn: notes.map(note => note.id),
    stats: {groups: realGroups, notes: notes.length, drawn: drawn.size, hidden: drawable.hiddenTotal,
      total: map.total + (map.attention ? 1 : 0)},
  };
  return {snapshot, map, drawable};
}
