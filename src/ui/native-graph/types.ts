import type { ItemView, WorkspaceLeaf } from 'obsidian';
import type { Point } from '../../model/types';

export interface PixiEvent {
  button: number; nativeEvent: MouseEvent; pointerId: number;
  getLocalPosition(container: Display): Point;
  stopPropagation(): void;
}
export interface Display {
  x: number; y: number; alpha: number; visible: boolean; tint: number; zIndex: number;
  eventMode: string; cursor: string; parent?: Display;
  scale: {x: number; y: number; set(x: number, y?: number): void};
  pivot: {x: number; y: number; set(x: number, y?: number): void};
  anchor?: {set(x: number, y?: number): void};
  style?: Record<string, unknown>;
  text?: string;
  addChild(child: Display): void; removeChild(child: Display): void;
  on(name: string, callback: (event: PixiEvent) => void): Display;
  off(name: string, callback: (event: PixiEvent) => void): Display;
  destroy(): void;
}
export interface Graphics extends Display {
  clear(): Graphics;
  beginFill(color: number, alpha?: number): Graphics; endFill(): Graphics;
  lineStyle(width: number, color: number, alpha?: number): Graphics;
  drawCircle(x: number, y: number, radius: number): Graphics;
  drawEllipse(x: number, y: number, halfWidth: number, halfHeight: number): Graphics;
  drawRoundedRect(x: number, y: number, width: number, height: number, radius: number): Graphics;
  moveTo(x: number, y: number): Graphics; lineTo(x: number, y: number): Graphics;
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): Graphics;
}
export interface NativeNode {
  id: string; type: string; x: number; y: number; fx: number | null; fy: number | null;
  circle?: Graphics; text?: Display; highlight?: Graphics; rendered: boolean;
  render(): void; getSize(): number; clearGraphics(): void;
}
export interface NativeLink {
  source: NativeNode; target: NativeNode; rendered: boolean;
  line?: Display; arrow?: Display;
  render(): void; clearGraphics(): void;
}
export interface NativeData { nodes: Record<string, {type: string; links: Record<string, boolean>; color?: unknown}>; [key: string]: unknown }
export interface NativeRenderer {
  containerEl: HTMLElement; interactiveEl: HTMLCanvasElement;
  nodes: NativeNode[]; nodeLookup: Record<string, NativeNode>; links: NativeLink[];
  hanger?: Display; px?: {stage: Display; render?(): void};
  worker: {postMessage(message: unknown): void};
  scale: number; targetScale: number; panX: number; panY: number; width: number; height: number;
  nodeScale: number; fNodeSizeMult: number;
  dragNode: NativeNode | null; highlightNode: NativeNode | null;
  onNodeClick: ((event: MouseEvent, id: string, type: string) => void) | null;
  onNodeRightClick: ((event: MouseEvent, id: string, type: string) => void) | null;
  onPointerDown?: (node: NativeNode, event: PixiEvent) => void;
  setData(data: NativeData): void; changed(): void; onResize(): void;
  setPan(x: number, y: number): void; setScale(scale: number): void; zoomTo(scale: number): void;
  setForces?(forces: {centerStrength: number; repelStrength: number; linkDistance: number}): void;
  destroy(): void;
}
export interface NativeView extends ItemView {
  headerEl: HTMLElement;
  renderer: NativeRenderer;
  dataEngine: {render(): void; options: Record<string, unknown>; queue?: {cancel(): void} | null; progression: number};
  onOptionsChange(): void;
}
export interface NativeRegistry { viewRegistry?: {viewByType?: Record<string, (leaf: WorkspaceLeaf) => NativeView>} }

/** Fail closed when Obsidian changes its private graph contract. Never substitute a simulated graph. */
export function assertNativeView(view: NativeView): void {
  const renderer = view?.renderer;
  if (!renderer || !view.dataEngine || typeof view.dataEngine.render !== 'function' ||
    !['setData', 'changed', 'onResize', 'setPan', 'setScale', 'zoomTo', 'destroy'].every(key => typeof renderer[key as keyof NativeRenderer] === 'function') ||
    !Array.isArray(renderer.nodes) || !Array.isArray(renderer.links) || !renderer.worker?.postMessage || !renderer.interactiveEl) {
    throw new Error('当前 Obsidian 原生图谱接口不兼容，请更新 Brain 适配。');
  }
}
export function newGraphics(source: Graphics): Graphics {
  return new (source.constructor as new () => Graphics)();
}
/**
 * Builds text objects with the same class the native graph uses, so card labels share its font
 * pipeline. Returns undefined when the surface does not expose a usable text class.
 */
export function newText(source?: Display): ((text: string, style?: Record<string, unknown>) => Display) | undefined {
  const Ctor = source && (source as unknown as {constructor?: new (text: string, style?: Record<string, unknown>) => Display}).constructor;
  if (typeof Ctor !== 'function') return undefined;
  try { void new Ctor(''); } catch { return undefined; }
  return (text, style) => new Ctor(text, style);
}
