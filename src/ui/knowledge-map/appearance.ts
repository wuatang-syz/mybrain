import {type MapCard, type MapCardBox, type MapDrawable, type MapLayout, type MapNodeBox, type MapSnapshot} from '../../graph/knowledge-map';
import type {MapLayoutState, NoteId, Point} from '../../model/types';

/**
 * Presentation layer of the two-dimensional knowledge map: colours and the card packing.
 * The graph layer stays pure knowledge; worlds and themes never import from here.
 */
export const palette = [0x7165df, 0x48a88f, 0xe99b63, 0x6496c8, 0xb77da8];
export const UNASSIGNED_COLOR = 0x9298ac;
export function clusterColor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}
export const cardColor = (id: NoteId): number => clusterColor(id);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const CARD_GAP = 60;
export const CARD_MARGIN = 80;
export const TOPIC_HEIGHT = 44, DIRECT_HEIGHT = 38;
const DIRECT_CELL_H = 48, DIRECT_CELL_W = 180, DEEP_CELL = 34, DIRECT_MAX_COLS = 4, DEEP_MAX_COLS = 12;
/** An ellipse has to contain the content block, so both axes grow by 1/sqrt(2) plus a margin. */
const ELLIPSE_FIT = 1.5;
export const topicWidth = (title: string) => Math.round(clamp(title.length * 15 + 30, 130, 220));
export const directWidth = (title: string) => Math.round(clamp(title.length * 13 + 26, 100, DIRECT_CELL_W));

/**
 * Deterministic card packing: cards keep a stable order, wrap by the canvas aspect ratio and are
 * centred around the origin. Each card is an ellipse large enough to contain its node grid, so the
 * content stays visually inside the frame at every zoom level.
 * Manual card offsets and manual node positions are applied last, and a node that left its card
 * grows that card instead of being pulled back.
 */
export function mapLayout(snapshot: MapSnapshot, drawable: MapDrawable, state: MapLayoutState, aspect = 1.5): MapLayout {
  const drawn = new Set(drawable.drawn);
  const titles = new Map(snapshot.nodes.map(node => [node.id, node.title]));
  const titleOf = (id: NoteId) => titles.get(id) ?? id;
  const expandedCards = new Set(snapshot.cards.filter(card => card.deep.some(id => drawn.has(id))).map(card => card.id));
  const planned = snapshot.cards.map(card => {
    const direct = card.direct.filter(id => drawn.has(id));
    const deep = card.deep.filter(id => drawn.has(id));
    const directCols = clamp(Math.ceil(Math.sqrt(Math.max(1, direct.length))), 1, DIRECT_MAX_COLS);
    const directRows = Math.ceil(direct.length / directCols);
    const deepCols = clamp(Math.ceil(Math.sqrt(Math.max(1, deep.length))), 1, DEEP_MAX_COLS);
    const deepRows = Math.ceil(deep.length / deepCols);
    const directCellW = Math.max(DIRECT_CELL_W * .62, ...direct.map(id => directWidth(titleOf(id)) + 14));
    const contentWidth = Math.max(topicWidth(card.title), directCols * directCellW, deepCols * DEEP_CELL);
    const contentHeight = TOPIC_HEIGHT + 16 + directRows * DIRECT_CELL_H + (deepRows ? 14 + deepRows * DEEP_CELL : 0);
    const width = Math.round(Math.max(210, contentWidth * ELLIPSE_FIT));
    const height = Math.round(Math.max(72, contentHeight * ELLIPSE_FIT));
    return {card, direct, deep, directCols, directRows, deepCols, directCellW, width, height, contentWidth, contentHeight};
  });
  const ratio = clamp(aspect, .35, 3);
  const area = planned.reduce((sum, item) => sum + (item.width + CARD_GAP) * (item.height + CARD_GAP), 0);
  const maxWidth = Math.max(1, ...planned.map(item => item.width));
  const rowWidth = Math.max(maxWidth, Math.sqrt(Math.max(1, area) * ratio));
  type Planned = typeof planned[number];
  const rows: {items: Planned[]; width: number; height: number}[] = [];
  let row: {items: Planned[]; width: number; height: number} = {items: [], width: 0, height: 0};
  for (const item of planned) {
    if (row.items.length && row.width + CARD_GAP + item.width > rowWidth) {
      rows.push(row); row = {items: [], width: 0, height: 0};
    }
    row.width = row.items.length ? row.width + CARD_GAP + item.width : item.width;
    row.height = Math.max(row.height, item.height);
    row.items.push(item);
  }
  if (row.items.length) rows.push(row);
  const blockWidth = Math.max(1, ...rows.map(entry => entry.width));
  const blockHeight = rows.reduce((sum, entry) => sum + entry.height, 0) + CARD_GAP * Math.max(0, rows.length - 1);
  const cards: MapCardBox[] = [], nodes: MapNodeBox[] = [];
  let top = -blockHeight / 2;
  for (const entry of rows) {
    let left = -blockWidth / 2 + (blockWidth - entry.width) / 2;
    for (const item of entry.items) {
      const offset = state.cards[item.card.id] ?? {x: 0, y: 0};
      const box: MapCardBox = {
        id: item.card.id, title: item.card.title, color: cardColor(item.card.id),
        x: left + offset.x, y: top + offset.y, width: item.width, height: item.height,
        count: item.card.members.length + 1, hidden: drawable.hidden[item.card.id] ?? 0,
        drillable: item.card.direct.length > 0, collapsed: item.card.deep.length > 0 && !expandedCards.has(item.card.id),
      };
      const centerX = box.x + box.width / 2, top_ = box.y + (box.height - item.contentHeight) / 2;
      const placed: MapNodeBox[] = [{
        id: item.card.id, title: item.card.title, card: item.card.id, role: 'topic',
        x: centerX, y: top_ + TOPIC_HEIGHT / 2,
        width: topicWidth(item.card.title), height: TOPIC_HEIGHT,
      }];
      const gridTop = top_ + TOPIC_HEIGHT + 16;
      item.direct.forEach((id, index) => {
        const col = index % item.directCols, rowIndex = Math.floor(index / item.directCols);
        placed.push({id, title: titleOf(id), card: item.card.id, role: 'direct',
          x: centerX + (col - (item.directCols - 1) / 2) * item.directCellW,
          y: gridTop + rowIndex * DIRECT_CELL_H + DIRECT_CELL_H / 2,
          width: directWidth(titleOf(id)), height: DIRECT_HEIGHT});
      });
      const deepTop = gridTop + item.directRows * DIRECT_CELL_H + (item.deep.length ? 14 : 0);
      item.deep.forEach((id, index) => {
        const col = index % item.deepCols, rowIndex = Math.floor(index / item.deepCols);
        placed.push({id, title: titleOf(id), card: item.card.id, role: 'deep',
          x: centerX + (col - (item.deepCols - 1) / 2) * DEEP_CELL,
          y: deepTop + rowIndex * DEEP_CELL + DEEP_CELL / 2, width: 12, height: 12});
      });
      // A dragged note keeps its absolute position; the card grows to contain it.
      let left_ = box.x, topEdge = box.y, right = box.x + box.width, bottom = box.y + box.height;
      for (const node of placed) {
        const manual = state.nodes[node.id];
        if (!manual) continue;
        node.x = manual.x; node.y = manual.y;
        left_ = Math.min(left_, node.x - node.width / 2 - 14);
        topEdge = Math.min(topEdge, node.y - node.height / 2 - 14);
        right = Math.max(right, node.x + node.width / 2 + 14);
        bottom = Math.max(bottom, node.y + node.height / 2 + 14);
      }
      box.x = Math.round(left_); box.y = Math.round(topEdge);
      box.width = Math.round(right - left_); box.height = Math.round(bottom - topEdge);
      cards.push(box); nodes.push(...placed);
      left += item.width + CARD_GAP;
    }
    top += entry.height + CARD_GAP;
  }
  const bounds = cards.length ? {
    minX: Math.min(...cards.map(card => card.x)) - CARD_MARGIN,
    minY: Math.min(...cards.map(card => card.y)) - CARD_MARGIN,
    maxX: Math.max(...cards.map(card => card.x + card.width)) + CARD_MARGIN,
    maxY: Math.max(...cards.map(card => card.y + card.height)) + CARD_MARGIN,
  } : {minX: 0, minY: 0, maxX: 0, maxY: 0};
  return {cards, nodes, bounds};
}

export function mapCardAt(layout: MapLayout, point: Point): MapCardBox | undefined {
  return layout.cards.find(card => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height);
}
export type {MapCard};
