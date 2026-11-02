import type {GraphAccess, GraphEdge, NoteId} from '../model/types';

export type MapNodeRole = 'topic' | 'direct' | 'deep';
/**
 * One cluster card. `direct` holds the card topic's own children, `deep` everything below them.
 * The card topic itself anchors the card and is drawn as its title node.
 */
export interface MapCard {
  id: NoteId;
  title: string;
  direct: NoteId[];
  deep: NoteId[];
  members: NoteId[];
}
export interface MapNodeInfo {id: NoteId; title: string; card: NoteId; role: MapNodeRole}
export interface MapSnapshot {
  /** Attention note: the level currently being explored. It is never drawn on the canvas. */
  attention: NoteId | null;
  attentionTitle: string | null;
  root: NoteId | null;
  cards: MapCard[];
  nodes: MapNodeInfo[];
  /** Structure edges; both endpoints always sit inside one card. */
  edges: GraphEdge[];
  /** Jump edges between notes of this level, drawn as secondary connectors. */
  jumps: GraphEdge[];
  total: number;
  selected: NoteId | null;
}
export interface MapDrawable {drawn: NoteId[]; hidden: Record<NoteId, number>; hiddenTotal: number}
export interface MapCardBox {
  id: NoteId; title: string; color: number; x: number; y: number; width: number; height: number;
  count: number; hidden: number; drillable: boolean; collapsed: boolean;
}
export interface MapNodeBox {id: NoteId; title: string; card: NoteId; role: MapNodeRole; x: number; y: number; width: number; height: number}
export interface MapLayout {
  cards: MapCardBox[];
  nodes: MapNodeBox[];
  bounds: {minX: number; minY: number; maxX: number; maxY: number};
}
export interface MapRequest {attention?: NoteId | null; root?: NoteId | null; selected?: NoteId | null}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Builds one level of the map: the attention note is the current parent and every direct child
 * becomes a card, leaves included. The attention note itself stays off the canvas.
 * Without a root the top level contains actual parentless nodes.
 */
export function knowledgeMap(graph: GraphAccess, request: MapRequest = {}): MapSnapshot {
  const all = graph.all().slice().sort((a, b) => compare(a.id, b.id));
  const root = request.root && graph.get(request.root) ? request.root : null;
  const attention = request.attention && graph.get(request.attention) ? request.attention : root;
  const selected = request.selected && graph.get(request.selected) ? request.selected : null;
  const topics = (attention
    ? graph.children(attention)
    : all.filter(note => !graph.parents(note.id).length).map(note => note.id))
    .filter(id => id !== attention && !!graph.get(id)).sort(compare);
  const owner = new Map<NoteId, NoteId>();
  const queue = topics.map(id => ({id, topic: id}));
  for (const id of topics) owner.set(id, id);
  for (let i = 0; i < queue.length; i++) {
    const {id, topic} = queue[i]!;
    for (const child of graph.children(id).slice().sort(compare)) {
      if (child === attention || owner.has(child) || !graph.get(child)) continue;
      owner.set(child, topic); queue.push({id: child, topic});
    }
  }
  const owned = new Map<NoteId, NoteId[]>();
  for (const id of owner.keys()) {
    const topic = owner.get(id)!;
    if (topic === id) continue;
    const list = owned.get(topic);
    if (list) list.push(id); else owned.set(topic, [id]);
  }
  const cards: MapCard[] = topics.map(id => {
    const direct = graph.children(id).filter(child => !!graph.get(child)).sort(compare);
    const members = (owned.get(id) ?? []).slice().sort(compare);
    const directSet = new Set(direct);
    return {id, title: graph.get(id)!.title, direct, deep: members.filter(member => !directSet.has(member)), members};
  });
  const nodes: MapNodeInfo[] = [];
  for (const card of cards) {
    nodes.push({id: card.id, title: card.title, card: card.id, role: 'topic'});
    for (const id of card.direct) nodes.push({id, title: graph.get(id)!.title, card: card.id, role: 'direct'});
    for (const id of card.deep) nodes.push({id, title: graph.get(id)!.title, card: card.id, role: 'deep'});
  }
  const known = new Set(nodes.map(node => node.id));
  const edges: GraphEdge[] = [], jumps: GraphEdge[] = [], seen = new Set<string>(), seenJump = new Set<string>();
  for (const card of cards) {
    const inCard = new Set<NoteId>([card.id, ...card.members]);
    for (const id of inCard) {
      for (const child of graph.children(id)) {
        if (!inCard.has(child)) continue;
        const key = `hierarchy:${id}->${child}`;
        if (!seen.has(key)) {seen.add(key); edges.push({source: id, target: child, kind: 'hierarchy'});}
      }
      for (const jump of graph.linked(id)) {
        if (jump === id || !known.has(jump)) continue;
        const key = `jump:${[id, jump].sort(compare).join('|')}`;
        if (!seenJump.has(key)) {seenJump.add(key); jumps.push({source: id, target: jump, kind: 'jump'});}
      }
    }
  }
  return {
    attention,
    attentionTitle: attention ? graph.get(attention)!.title : null,
    root, cards, nodes, edges, jumps,
    total: cards.reduce((sum, card) => sum + card.members.length + 1, 0),
    selected,
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const DEEP_EXPANSION_LIMIT = 60;

/**
 * Chooses which notes are drawn. Card topics always stay, direct children are added round robin
 * until the node budget is spent, and expanded cards reveal their deeper members.
 */
export function mapDrawable(snapshot: MapSnapshot, options: {expanded?: Iterable<NoteId>; budget?: number; selected?: NoteId | null} = {}): MapDrawable {
  const expanded = new Set(options.expanded ?? []);
  const raw = Number(options.budget);
  const budget = clamp(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200, 1, 2000);
  const drawn = new Set<NoteId>();
  for (const card of snapshot.cards) drawn.add(card.id);
  const remaining = Math.max(0, budget - drawn.size);
  let round = 0, added = 0;
  while (added < remaining) {
    let progressed = false;
    for (const card of snapshot.cards) {
      if (added >= remaining || round >= card.direct.length) continue;
      drawn.add(card.direct[round]!); added++; progressed = true;
    }
    if (!progressed) break;
    round++;
  }
  for (const card of snapshot.cards) {
    if (!expanded.has(card.id)) continue;
    for (const id of card.deep.slice(0, DEEP_EXPANSION_LIMIT)) drawn.add(id);
  }
  const selected = options.selected && snapshot.nodes.some(node => node.id === options.selected) ? options.selected : null;
  if (selected) drawn.add(selected);
  const hidden: Record<NoteId, number> = {};
  let hiddenTotal = 0;
  for (const card of snapshot.cards) {
    const missing = card.members.filter(id => !drawn.has(id)).length;
    hidden[card.id] = missing; hiddenTotal += missing;
  }
  return {drawn: snapshot.nodes.filter(node => drawn.has(node.id)).map(node => node.id), hidden, hiddenTotal};
}

/**
 * Compatibility adapter: the two-dimensional card packing and its palette now live in the
 * presentation layer, and the legacy map plus its tests keep importing them from here.
 */
export {
  CARD_GAP, CARD_MARGIN, DIRECT_HEIGHT, TOPIC_HEIGHT, UNASSIGNED_COLOR, cardColor, clusterColor,
  directWidth, mapCardAt, mapLayout, palette, topicWidth,
} from '../ui/knowledge-map/appearance';
