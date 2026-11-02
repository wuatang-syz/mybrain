import {DEFAULT_MIND_MAP, type MindMapSettings} from '../../mind-map-settings';
import type { GraphNode } from '../../model/types';

const cache = new Map<string, {width: number; height: number}>();
let context: OffscreenCanvasRenderingContext2D | null | undefined;

/** Use the same font for text measurement and rendering, including CJK and mixed titles. */
export function nodeSize(node: GraphNode, settings: Readonly<MindMapSettings> = DEFAULT_MIND_MAP): {width: number; height: number} {
  if (node.zone === 'outer') return {width: 132, height: 64};
  const focus = node.zone === 'focus', fontSize = settings.fontSize + (focus ? 4 : 0);
  const title = node.displayTitle ?? node.title;
  const label = settings.showIcons && node.icon ? `${node.icon} ${title}` : title;
  const key = `${focus}:${fontSize}:${label}`;
  const existing = cache.get(key);
  if (existing) return existing;
  if (context === undefined) context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  let textWidth: number;
  if (context) {
    context.font = `${fontSize}px sans-serif`;
    textWidth = context.measureText(label).width;
  } else {
    // Headless environments without canvas still receive deterministic, conservative geometry.
    textWidth = Array.from(label).reduce((width, char) => width + fontSize * (char.codePointAt(0)! > 127 ? 1 : /[MW@]/.test(char) ? .9 : /[il.,' ]/.test(char) ? .3 : .6), 0);
  }
  const size = {width: Math.max(focus ? 80 : 64, Math.ceil(textWidth) + 40), height: (focus ? 60 : 48) + settings.fontSize - 16};
  if (cache.size >= 1000) cache.clear();
  cache.set(key, size);
  return size;
}
