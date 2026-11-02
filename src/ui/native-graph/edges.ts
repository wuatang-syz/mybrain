import {DEFAULT_MIND_MAP, type MindMapSettings} from '../../mind-map-settings';
import type { CanvasCallbacks, GraphEdge, GraphNode, Point } from '../../model/types';
import { nodeSize } from '../canvas/layout';
import { newGraphics, type Graphics, type NativeLink, type NativeRenderer } from './types';
import { relationEdge } from './data';
import type {ChildRoute} from '../canvas/windows';
import {edgeAppearance, routedEdgePaths, type EdgeRoute} from './edge-routing';
import {drawEdgePath} from './edge-path';

export interface EdgeGeometry {from: Point; to: Point; controls?: [Point, Point]; via?: ChildRoute; trunk?: {to: Point; draw: boolean}}
export interface EdgeCurve {controls: [Point, Point]; to: Point}

/** Child branches leave a common vertical trunk before fanning into column centers. */
export function edgeCurves({from, to, controls, via, trunk}: EdgeGeometry): EdgeCurve[] {
  if (via) {
    const start = via.drawStem === false ? via : trunk?.to ?? from;
    const rise = to.y - start.y;
    return [{controls: [{x: start.x, y: start.y + rise * .60}, {x: to.x, y: to.y - rise * .35}], to}];
  }
  return controls ? [{controls, to}] : [];
}
export function edgeGeometry(renderer: NativeRenderer, edge: GraphEdge, core: Map<string, GraphNode>, settings: Readonly<MindMapSettings> = DEFAULT_MIND_MAP, route?: ChildRoute): EdgeGeometry | undefined {
  const source = renderer.nodeLookup[edge.source], target = renderer.nodeLookup[edge.target];
  if (!source || !target) return;
  const a = core.get(source.id), b = core.get(target.id);
  const from = {x: source.x, y: source.y}, to = {x: target.x, y: target.y};
  if (route && edge.kind === 'hierarchy' && a?.zone === 'focus' && b?.zone === 'child') {
    from.y += nodeSize(a, settings).height / 2;
    to.y -= nodeSize(b, settings).height / 2;
    const trunk = route.drawStem === false ? undefined : {
      to: {x: from.x, y: from.y + Math.min(24, Math.max(10, (route.y - from.y) * .22))},
      draw: route.drawTrunk === true,
    };
    return {from, to, via: route, trunk};
  }
  if (edge.kind === 'hierarchy' && b?.zone === 'sibling') {
    const sign = to.x >= from.x ? 1 : -1;
    if (a) from.x += nodeSize(a, settings).width / 2 * sign;
    to.x -= nodeSize(b, settings).width / 2 * sign;
    const stem = from.x + (to.x - from.x) * .66;
    return {from, to, controls: [{x: stem, y: from.y}, {x: stem, y: to.y}]};
  }
  if (edge.kind === 'hierarchy') {
    const sign = to.y >= from.y ? 1 : -1;
    if (a) from.y += nodeSize(a, settings).height / 2 * sign;
    if (b) to.y -= nodeSize(b, settings).height / 2 * sign;
    const middle = (from.y + to.y) / 2;
    return {from, to, controls: [{x: from.x, y: middle}, {x: to.x, y: middle}]};
  }
  {
    const sign = to.x >= from.x ? 1 : -1;
    if (a) from.x += nodeSize(a, settings).width / 2 * sign;
    if (b) to.x -= nodeSize(b, settings).width / 2 * sign;
    const bend = Math.max(40, Math.min(160, Math.abs(to.x - from.x) * .45));
    const arc = Math.abs(to.y - from.y) < 1 ? Math.min(48, Math.abs(to.x - from.x) * .15) : 0;
    return {from, to, controls: [{x: from.x + sign * bend, y: from.y + arc}, {x: to.x - sign * bend, y: to.y + arc}]};
  }
  return {from, to};
}

/** Structure is a visual overlay, never a native link or worker spring. */
export function decorateStructure(renderer: NativeRenderer, edge: GraphEdge, core: Map<string, GraphNode>, callbacks: CanvasCallbacks, settings?: () => MindMapSettings, opacity?: (id: string) => number, route?: (id: string) => ChildRoute | undefined, display: EdgeDisplay = {}): () => void {
  const source = renderer.nodeLookup[edge.source], target = renderer.nodeLookup[edge.target];
  if (!source || !target || !core.has(source.id) || !core.has(target.id)) return () => {};
  const link: NativeLink = {source, target, rendered: true, render: () => {}, clearGraphics: () => {}};
  const cleanup = decorateEdge(renderer, link, core, [edge], callbacks, {settings, opacity, route, ...display});
  const render = source.render;
  source.render = function() {render.call(source); link.render();};
  return () => {source.render = render; cleanup();};
}

export interface EdgeDisplay {
  settings?: () => MindMapSettings;
  duplicate?: boolean;
  opacity?: (id: string) => number;
  route?: (id: string) => ChildRoute | undefined;
  routing?: EdgeRoute;
  selected?: () => string | undefined;
}

export function decorateEdge(renderer: NativeRenderer, link: NativeLink, core: Map<string, GraphNode>, edges: GraphEdge[], callbacks: CanvasCallbacks, display: EdgeDisplay = {}): () => void {
  const render = link.render, clear = link.clearGraphics;
  const structural = relationEdge(edges, link.source.id, link.target.id);
  const edge = structural ?? {source: link.source.id, target: link.target.id, kind: 'jump' as const};
  const duplicate = structural && link.source.id !== structural.source && renderer.links.some(other => other.source.id === structural.source && other.target.id === structural.target);
  let graphic: Graphics | undefined;
  const remove = () => {
    if (graphic) {graphic.parent?.removeChild(graphic); graphic.destroy();}
    graphic = undefined;
  };
  link.clearGraphics = function() {remove(); clear.call(link);};
  link.render = function() {
    render.call(link);
    // Suppress native strokes even when a custom graphic has not been allocated yet.
    // The native links stay in the worker, so drawing links never relayouts nodes.
    if (link.line) link.line.visible = false;
    if (link.arrow) link.arrow.visible = false;
    const settings = display.settings?.() ?? DEFAULT_MIND_MAP;
    if (duplicate || display.duplicate) {
      if (graphic) graphic.visible = false;
      return;
    }
    if (!link.source.circle || !renderer.hanger) return;
    if (!graphic) {
      graphic = newGraphics(link.source.circle); graphic.zIndex = 0; graphic.eventMode = 'static'; graphic.cursor = 'context-menu';
      graphic.on('rightclick', event => {event.stopPropagation(); callbacks.onEdgeContext?.(edge, event.nativeEvent);});
      renderer.hanger.addChild(graphic);
    }
    const source = renderer.nodeLookup[edge.source], target = renderer.nodeLookup[edge.target];
    const geometry = edgeGeometry(renderer, edge, core, settings, display.route?.(edge.target));
    if (!source || !target || !geometry) {graphic.visible = false; return;}
    const {from, to} = geometry;
    const color = edge.kind === 'jump' ? 0x9a88b7 : 0x79aaa8;
    const active = renderer.highlightNode?.id ?? display.selected?.();
    const appearance = edgeAppearance(edge, core, active);
    const stroke = (item: Graphics, width: number, alpha: number) => item.lineStyle(Math.max(width, 1 / renderer.scale) * settings.lineWidth / 100,
      color, alpha * settings.lineOpacity / 100);
    graphic.clear(); stroke(graphic, appearance.width, appearance.alpha);
    const routed = routedEdgePaths(renderer, edge, core, settings, display.routing);
    if (routed) {
      for (const path of routed.paths) drawEdgePath(graphic, path);
    } else {
      graphic.moveTo(from.x, from.y);
      const curves = edgeCurves(geometry);
      if (geometry.via?.drawStem === false) {
        graphic.moveTo(geometry.via.x, geometry.via.y);
      } else if (geometry.trunk) {
        const end = geometry.trunk.to;
        if (geometry.trunk.draw) graphic.lineTo(end.x, end.y);
        else graphic.moveTo(end.x, end.y);
      }
      if (curves.length) for (const curve of curves) {
        graphic.bezierCurveTo(curve.controls[0].x, curve.controls[0].y, curve.controls[1].x, curve.controls[1].y, curve.to.x, curve.to.y);
      } else graphic.lineTo(to.x, to.y);
    }
    graphic.visible = !!source.circle?.visible && !!target.circle?.visible;
    graphic.alpha = Math.min(display.opacity?.(source.id) ?? 1, display.opacity?.(target.id) ?? 1);
  };
  return () => {remove(); link.render = render; link.clearGraphics = clear;};
}
