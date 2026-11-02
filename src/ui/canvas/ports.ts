import type { GraphNode, Point, RelationRequest } from '../../model/types';
import { nodeSize } from './layout';

export const portKinds = { top: 'parent', bottom: 'child', left: 'jump', right: 'sibling' } as const;
export type PortSide = keyof typeof portKinds;
export interface Port { id: string; side: PortSide }
export const portLabels: Record<PortSide, string> = { top: '父级', bottom: '子级', left: '跳转关联', right: '同级' };
export function allowsPort(node: GraphNode | undefined, side: PortSide): boolean {
  return !!node && !(node.kind === 'root' && (side === 'top' || side === 'right')) && !(node.kind && node.kind !== 'note' && side === 'left') && !(node.kind === 'note' && side === 'bottom');
}

export function readPort(element: Element | null): Port | undefined {
  const gate = element?.closest<HTMLElement>('[data-port]');
  const id = gate?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
  const side = gate?.dataset.port;
  if (id && side && Object.prototype.hasOwnProperty.call(portKinds, side)) return { id, side: side as PortSide };
  return undefined;
}

export function portPoint(node: GraphNode, center: Point, side: PortSide): Point {
  if (node.zone === 'outer') return {
    x: center.x + (side === 'left' ? -16 : side === 'right' ? 16 : 0),
    y: center.y - 16 + (side === 'top' ? -16 : side === 'bottom' ? 16 : 0),
  };
  const { width, height } = nodeSize(node);
  return { x: center.x + (side === 'left' ? -width / 2 : side === 'right' ? width / 2 : 0),
    y: center.y + (side === 'top' ? -height / 2 : side === 'bottom' ? height / 2 : 0) };
}

/** The destination side defines the source note's role relative to that destination. */
export function portRequest(source: string, target: Port | undefined, nodes: Map<string, GraphNode>): RelationRequest | undefined {
  if (!target || source === target.id || !nodes.has(source) || !nodes.has(target.id) || nodes.get(target.id)?.zone === 'outer' || !allowsPort(nodes.get(target.id), target.side)) return;
  const sourceNode = nodes.get(source)!;
  if ((target.side === 'top' && sourceNode.kind === 'note') || (target.side === 'left' && sourceNode.kind && sourceNode.kind !== 'note')) return;
  return { focus: target.id, target: source, kind: portKinds[target.side] };
}
