import type {MapCardBox, MapDrawable, MapLayout, MapNodeBox, MapSnapshot} from '../../graph/knowledge-map';
import type {NoteId, Point} from '../../model/types';
import type {Graphics, NativeNode, NativeRenderer} from '../native-graph/types';

/**
 * Card frames, edges, chrome and node shapes are all painted through the native per-node graphics
 * objects. That keeps everything on one surface — and on a surface we know Obsidian already
 * renders — so a missing auxiliary layer can never make the map go blank again.
 */
export interface MapPaintHost {
  renderer: NativeRenderer;
  snapshot?: MapSnapshot;
  drawable?: MapDrawable;
  layout?: MapLayout;
  nodes: Map<NoteId, MapNodeBox>;
  cards: Map<NoteId, MapCardBox>;
  /** Structure edges grouped by child so a node can draw its own parent links. */
  incoming: Map<NoteId, NoteId[]>;
  /** Jump targets grouped by source. */
  jumps: Map<NoteId, NoteId[]>;
  selected?: NoteId | null;
  hovered?: NoteId | null;
  hoverCard?: NoteId | null;
  hoverZone?: 'enter' | 'expand' | null;
}

export const ACCENT = 0x6256df;
const MUTED = 0x9298ac;
export const isDark = (renderer: NativeRenderer) => !!renderer.containerEl.ownerDocument.body.classList.contains('theme-dark');
/** World units per CSS pixel: chrome is sized in screen pixels and converted with this. */
export function zoomRatio(renderer: NativeRenderer): number {
  const dpr = renderer.containerEl.win.devicePixelRatio || 1;
  return Math.max(.02, renderer.scale / dpr);
}
export function chromeScale(renderer: NativeRenderer): number {return 1 / zoomRatio(renderer);}
export function semanticLevel(renderer: NativeRenderer): 'far' | 'mid' | 'near' {
  const ratio = zoomRatio(renderer);
  return ratio < .55 ? 'far' : ratio < .95 ? 'mid' : 'near';
}
export function toScreen(renderer: NativeRenderer, point: Point): Point {
  const dpr = renderer.containerEl.win.devicePixelRatio || 1;
  return {x: (point.x * renderer.scale + renderer.panX) / dpr, y: (point.y * renderer.scale + renderer.panY) / dpr};
}
export function toWorld(renderer: NativeRenderer, point: Point): Point {
  const dpr = renderer.containerEl.win.devicePixelRatio || 1;
  return {x: (point.x * dpr - renderer.panX) / renderer.scale, y: (point.y * dpr - renderer.panY) / renderer.scale};
}
/** Rough advance width: CJK glyphs occupy a full em, latin roughly half. */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) units += char.charCodeAt(0) > 0x2e80 ? 1 : .56;
  return units * fontSize;
}
export function truncate(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return '';
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let out = '';
  for (const char of text) {
    if (textWidth(out + char + '…', fontSize) > maxWidth) break;
    out += char;
  }
  return out ? `${out}…` : '';
}

export interface CardChrome {
  enter: {x: number; y: number; r: number} | null;
  expand: {x: number; y: number; r: number} | null;
  headerY: number;
  scale: number;
}
/**
 * Header chrome floats just above the ellipse in screen-constant size, like the reference design
 * where a cluster label sits above its group. Chips drop out on narrow cards so they never crowd.
 */
export function cardChrome(renderer: NativeRenderer, card: MapCardBox, showExpand = true): CardChrome {
  const zoom = zoomRatio(renderer), scale = 1 / zoom, screenWidth = card.width * zoom;
  const headerY = card.y - 10 * scale;
  let right = card.x + card.width - 6 * scale;
  let enter: CardChrome['enter'] = null;
  if (card.drillable) {
    enter = {x: right - 11 * scale, y: headerY, r: 11 * scale};
    right = enter.x - enter.r - 8 * scale;
  }
  let expand: CardChrome['expand'] = null;
  if (showExpand && card.hidden > 0 && screenWidth >= 120) {
    expand = {x: right - 11 * scale, y: headerY, r: 11 * scale};
  }
  return {enter, expand, headerY, scale};
}

const nodeFill = (dark: boolean, selected: boolean): number => selected ? ACCENT : dark ? 0x2a2e3a : 0xffffff;
const nodeLine = (dark: boolean, selected: boolean): number => selected ? 0xffffff : dark ? 0xb9bfd0 : 0x5c667a;

let paintError: string | null = null;
/** Last painting failure, surfaced by the canvas instead of silently blanking the map. */
export function takePaintError(): string | null {const value = paintError; paintError = null; return value;}

/** Replaces the native dot with card node shapes; card frames and edges ride on the same graphics. */
export function paintNode(host: MapPaintHost, node: NativeNode): () => void {
  const original = node.render, size = node.getSize;
  node.getSize = () => 8;
  node.render = () => {
    try {
      const box = host.nodes.get(node.id), card = box ? host.cards.get(box.card) : undefined;
      if (box) {node.x = box.x; node.y = box.y;}
      original.call(node);
      if (!box || !card || !node.circle || !node.text) return;
      const renderer = host.renderer, dark = isDark(renderer), selected = host.selected === node.id;
      const hovered = host.hovered === node.id, level = semanticLevel(renderer), scale = chromeScale(renderer);
      const circle = node.circle, text = node.text;
      circle.clear();
      // The native graph tints every node with its own colour group; that would multiply our fills.
      circle.tint = 0xffffff;
      circle.pivot.set(0); circle.scale.set(1);
      circle.x = node.x; circle.y = node.y; circle.alpha = 1; circle.visible = true;
      if (node.highlight) node.highlight.visible = false;
      if (box.role === 'topic') {drawCard(host, circle, card, box, text, dark, scale, level); return;}
      drawConnections(host, circle, box, dark);
      circle.lineStyle(1, card.color, box.role === 'deep' ? 0 : .55);
      circle.beginFill(nodeFill(dark, selected), 1);
      if (box.role === 'deep') circle.drawCircle(0, 0, hovered ? 7 : 6);
      else circle.drawEllipse(0, 0, box.width / 2, box.height / 2);
      circle.endFill();
      const dot = box.role === 'deep';
      // Labels stay at a readable screen size down to ~60% zoom, then shrink with the card.
      const ratio = zoomRatio(renderer);
      const labelFont = (dot ? 12.5 : 13.5) / Math.max(ratio, .6);
      text.text = dot ? truncate(box.title, 190, labelFont) : truncate(box.title, box.width - 16, labelFont);
      text.anchor?.set(dot ? 0 : .5, .5);
      text.x = dot ? node.x + 10 : node.x; text.y = node.y; text.scale.set(1);
      text.alpha = 1;
      text.visible = dot ? hovered : ratio >= .4 || hovered;
      if (text.style) Object.assign(text.style, {fontFamily: 'sans-serif', fontSize: labelFont, fontWeight: 'normal',
        fill: dot ? card.color : nodeLine(dark, selected), wordWrap: false});
    } catch (error) {
      paintError = error instanceof Error ? error.message : String(error);
    }
  };
  return () => {node.render = original; node.getSize = size; node.clearGraphics();};
}

/** The card ellipse, its header chrome and the floating cluster title. */
function drawCard(host: MapPaintHost, g: Graphics, card: MapCardBox, hub: MapNodeBox, text: NativeNode['text'],
  dark: boolean, scale: number, level: 'far' | 'mid' | 'near'): void {
  const offsetX = card.x - hub.x, offsetY = card.y - hub.y;
  const current = !!host.selected && host.nodes.get(host.selected)?.card === card.id;
  g.lineStyle(current ? 1.8 : 1.2, card.color, current ? .8 : dark ? .55 : .45);
  g.beginFill(card.color, dark ? (current ? .22 : .14) : (current ? .12 : .07));
  g.drawEllipse(offsetX + card.width / 2, offsetY + card.height / 2, card.width / 2, card.height / 2);
  g.endFill();
  const chrome = cardChrome(host.renderer, card, level !== 'far');
  if (chrome.enter) {
    const x = offsetX + chrome.enter.x, y = offsetY + chrome.enter.y;
    const hot = host.hoverCard === card.id && host.hoverZone === 'enter';
    g.lineStyle(1, card.color, .9).beginFill(card.color, hot ? 1 : .18).drawCircle(x, y, chrome.enter.r).endFill();
    const radius = chrome.enter.r * .32;
    g.lineStyle(1.5, hot ? 0xffffff : card.color, 1)
      .moveTo(x - radius * .7, y - radius * 1.1).lineTo(x + radius * .85, y).lineTo(x - radius * .7, y + radius * 1.1);
  }
  if (chrome.expand) {
    const x = offsetX + chrome.expand.x, y = offsetY + chrome.expand.y;
    const hot = host.hoverCard === card.id && host.hoverZone === 'expand';
    g.lineStyle(1, card.color, .8).beginFill(card.color, hot ? 1 : .18).drawCircle(x, y, chrome.expand.r).endFill();
    const radius = chrome.expand.r * .34, down = card.collapsed;
    g.lineStyle(1.5, hot ? 0xffffff : card.color, 1)
      .moveTo(x - radius, y - radius * (down ? .5 : -.5))
      .lineTo(x, y + radius * (down ? .6 : -.6))
      .lineTo(x + radius, y - radius * (down ? .5 : -.5));
  }
  // The topic bubble is the cluster head: solid, so it reads even before the title is scanned.
  const hubSelected = host.selected === hub.id;
  g.lineStyle(2, card.color, .35);
  g.beginFill(hubSelected ? ACCENT : card.color, .95);
  g.drawEllipse(0, 0, hub.width / 2, hub.height / 2);
  g.endFill();
  if (!text) return;
  const worldFont = 15 * scale;
  const available = Math.max(24, card.width * (level === 'far' ? .92 : .62));
  const titleFont = Math.min(worldFont, available / Math.max(1, textWidth(card.title, 1)));
  text.text = truncate(card.title, available, titleFont);
  text.anchor?.set(0, .5);
  text.x = card.x + 2 * scale; text.y = card.y - 10 * scale; text.scale.set(1);
  text.alpha = 1; text.visible = true;
  if (text.style) Object.assign(text.style, {fontFamily: 'sans-serif', fontSize: titleFont, fontWeight: '600', fill: card.color, wordWrap: false});
}

/** Directory and jump curves, drawn by the node that owns them so they stay on screen. */
function drawConnections(host: MapPaintHost, g: Graphics, box: MapNodeBox, dark: boolean): void {
  const card = host.cards.get(box.card);
  for (const parentId of host.incoming.get(box.id) ?? []) {
    const parent = host.nodes.get(parentId); if (!parent) continue;
    g.lineStyle(1.15, card?.color ?? MUTED, dark ? .55 : .45);
    curve(g, parent.x - box.x, parent.y - box.y, 0, 0);
  }
  for (const targetId of host.jumps.get(box.id) ?? []) {
    const target = host.nodes.get(targetId); if (!target) continue;
    g.lineStyle(.9, MUTED, dark ? .34 : .3);
    curve(g, 0, 0, target.x - box.x, target.y - box.y);
  }
}
function curve(g: Graphics, ax: number, ay: number, bx: number, by: number): void {
  const bend = (by - ay) * .45;
  g.moveTo(ax, ay).bezierCurveTo(ax, ay + bend, bx, by - bend, bx, by);
}

/** Builds the per-node lookup tables the painter needs. */
export function mapPaintIndex(snapshot: MapSnapshot | undefined, nodes: Map<NoteId, MapNodeBox>): {incoming: Map<NoteId, NoteId[]>; jumps: Map<NoteId, NoteId[]>} {
  const incoming = new Map<NoteId, NoteId[]>(), jumps = new Map<NoteId, NoteId[]>();
  if (!snapshot) return {incoming, jumps};
  for (const edge of snapshot.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const list = incoming.get(edge.target); if (list) list.push(edge.source); else incoming.set(edge.target, [edge.source]);
  }
  for (const edge of snapshot.jumps) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const list = jumps.get(edge.source); if (list) list.push(edge.target); else jumps.set(edge.source, [edge.target]);
  }
  return {incoming, jumps};
}
