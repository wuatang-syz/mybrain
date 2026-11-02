import {DEFAULT_MIND_MAP, type MindMapSettings} from '../../mind-map-settings';
import type { GraphNode, Point } from '../../model/types';
import { nodeSize } from '../canvas/layout';
import {allowsPort, type PortSide} from '../canvas/ports';
import { newGraphics, type Graphics, type NativeNode, type NativeRenderer, type PixiEvent } from './types';

export interface NodeHost {
  settings?: MindMapSettings;
  renderer: NativeRenderer;
  core: Map<string, GraphNode>; positions: Record<string, Point>; selected?: string;
  startPort(id: string, side: PortSide, event: PixiEvent): void;
  hoverPort(id?: string, side?: PortSide): void;
  hoveredPort(): string | undefined;
  connecting(): boolean;
  connectionSource(): string | undefined;
  nodeOpacity?(id: string): number;
}
export function showPorts(core: boolean, hovered: boolean, connecting: boolean, source: boolean): boolean {
  return connecting ? source || (core && hovered) : hovered;
}
export function nodePort(host: NodeHost, node: NativeNode, side: PortSide): Point {
  const core = host.core.get(node.id);
  const size = core ? nodeSize(core, host.settings) : {width: (node.getSize() * host.renderer.nodeScale + 12) * 2, height: 0};
  return {x: node.x + (side === 'right' ? size.width / 2 : side === 'left' ? -size.width / 2 : 0),
    y: node.y + (side === 'bottom' ? size.height / 2 : side === 'top' ? -size.height / 2 : 0)};
}
/** Patch individual native nodes only. Graphics stay in the native PIXI hanger. */
export function decorateNode(host: NodeHost, node: NativeNode): () => void {
  const render = node.render, clear = node.clearGraphics, getSize = node.getSize;
  let wasCore = host.core.has(node.id);
  const ports = new Map<PortSide, Graphics>();
  const win = host.renderer.containerEl.ownerDocument.defaultView ?? window;
  let hoverUntil = 0;
  let wasHovered = false;
  let hideTimer = 0;
  const clearPorts = () => { for (const port of ports.values()) {port.parent?.removeChild(port); port.destroy();} ports.clear(); };
  node.getSize = function() {return host.core.has(node.id) ? 100 : getSize.call(node);};
  node.clearGraphics = function() {clearPorts(); clear.call(node);};
  node.render = function() {
    const core = host.core.get(node.id), position = host.positions[node.id];
    if (wasCore !== !!core) {node.clearGraphics(); wasCore = !!core;}
    if (core && position) { node.x = position.x; node.y = position.y; }
    render.call(node);
    const {circle, text} = node, renderer = host.renderer;
    if (!circle || !text || !renderer.hanger) return;
    if (core) {
      const size = nodeSize(core, host.settings);
      // Native rendering may redraw this same Graphics object after a resize,
      // highlight or animation update. Always restore the structural shape.
      {
        const hovered = renderer.highlightNode === node || host.hoveredPort() === node.id;
        circle.clear().lineStyle(1.5, hovered || core.zone === 'focus' ? 0x7560dd : 0xa8a3bb).beginFill(0xffffff)
          .drawRoundedRect(-size.width / 2, -size.height / 2, size.width, size.height, 7).endFill();
        circle.pivot.set(0);
      }
      circle.x = node.x; circle.y = node.y; circle.scale.set(1); circle.alpha = host.nodeOpacity?.(node.id) ?? 1;
      const dark = renderer.containerEl.ownerDocument.body.classList.contains('theme-dark');
      circle.tint = core.zone === 'focus' ? 0x7560dd : dark ? 0x34313d : 0xffffff;
      if (node.highlight) node.highlight.visible = false;
      const title = core.displayTitle ?? core.title;
      text.text = (host.settings ?? DEFAULT_MIND_MAP).showIcons && core.icon ? `${core.icon} ${title}` : title; text.anchor?.set(.5); text.x = node.x; text.y = node.y; text.scale.set(1);
      text.alpha = circle.alpha; text.visible = circle.visible;
      if (text.style) Object.assign(text.style, {fontFamily: 'sans-serif', fontWeight: 'normal', fontSize: (host.settings ?? DEFAULT_MIND_MAP).fontSize + (core.zone === 'focus' ? 4 : 0), fill: core.zone === 'focus' ? 0xffffff : dark ? 0xe5e3eb : 0x33313c, wordWrap: false});
    }
    const highlighted = renderer.highlightNode === node;
    if (highlighted) {
      hoverUntil = Number.POSITIVE_INFINITY;
      if (hideTimer) win.clearTimeout(hideTimer);
      hideTimer = 0;
    } else if (wasHovered) {
      hoverUntil = Date.now() + 180;
      hideTimer = win.setTimeout(() => renderer.changed(), 190);
    }
    wasHovered = highlighted;
    const sides: PortSide[] = core ? (['top', 'bottom', 'left', 'right'] as PortSide[]).filter(side => allowsPort(core, side))
      : node.id.toLowerCase().endsWith('.md') && node.type !== 'unresolved' ? ['right'] : [];
    for (const side of sides) {
      let port = ports.get(side);
      if (!port) {
        port = newGraphics(circle); port.eventMode = 'static'; port.cursor = 'crosshair'; port.zIndex = 5;
        port.lineStyle(1.5, 0x7560dd).beginFill(0xffffff).drawCircle(0, 0, 5).endFill();
        port.on('pointerdown', event => host.startPort(node.id, side, event));
        port.on('pointerover', () => host.hoverPort(node.id, side));
        port.on('pointerout', () => host.hoverPort());
        renderer.hanger.addChild(port); ports.set(side, port);
      }
      const point = nodePort(host, node, side); port.x = point.x; port.y = point.y;
      port.scale.set(Math.max(1, Math.min(2, 1 / renderer.scale)));
      const hovered = highlighted || host.hoveredPort() === node.id || (!host.connecting() && Date.now() < hoverUntil);
      port.visible = circle.visible && showPorts(!!core, hovered, host.connecting(), host.connectionSource() === node.id);
    }
  };
  return () => { if (hideTimer) win.clearTimeout(hideTimer); clearPorts(); node.render = render; node.clearGraphics = clear; node.getSize = getSize; node.clearGraphics(); };
}
