import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { GraphEdge, GraphNode, LayoutState, Point } from '../../model/types';

interface Particle extends SimulationNodeDatum { id: string }
interface Box { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 24 &&
  Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 24;

/** Lay out each connected component independently, then pack the components around the focus area. */
export function outerNetwork(nodes: GraphNode[], edges: GraphEdge[], core: Point[], saved?: LayoutState): Record<string, Point> {
  const ids = new Set(nodes.map(node => node.id));
  const links = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of links) {
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const pending = [node.id], group: string[] = [];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id); group.push(id);
      for (const neighbor of neighbors.get(id)!) if (!seen.has(neighbor)) pending.push(neighbor);
    }
    components.push(group.sort());
  }
  components.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  const radiusX = Math.max(380, ...core.map(p => Math.abs(p.x) + 120));
  const radiusY = Math.max(220, ...core.map(p => Math.abs(p.y) + 80));
  const occupied: Box[] = [{x: 0, y: 0, width: radiusX * 2, height: radiusY * 2}];
  const positions: Record<string, Point> = {};
  const pinned = new Set(saved?.pinned ?? []);
  for (const group of components) {
    const existing = group.filter(id => saved?.positions[id]);
    const origin = existing.length ? {
      x: existing.reduce((sum, id) => sum + saved!.positions[id]!.x, 0) / existing.length,
      y: existing.reduce((sum, id) => sum + saved!.positions[id]!.y, 0) / existing.length,
    } : {x: 0, y: 0};
    const particles: Particle[] = group.map(id => {
      const point = saved?.positions[id];
      return point ? {id, x: point.x - origin.x, y: point.y - origin.y, fx: point.x - origin.x, fy: point.y - origin.y} : {id};
    });
    if (existing.length !== group.length) {
      const members = new Set(group);
      const simulation = forceSimulation(particles)
        .force('link', forceLink<Particle, {source: string; target: string}>(links.filter(edge => members.has(edge.source))
          .map(edge => ({source: edge.source, target: edge.target}))).id(node => node.id).distance(145).strength(.55))
        .force('charge', forceManyBody().strength(-160))
        .force('collision', forceCollide(82).iterations(3))
        .force('x', forceX(0).strength(.025)).force('y', forceY(0).strength(.025)).stop();
      simulation.tick(120);
    }
    const minX = Math.min(...particles.map(p => p.x ?? 0)), maxX = Math.max(...particles.map(p => p.x ?? 0));
    const minY = Math.min(...particles.map(p => p.y ?? 0)), maxY = Math.max(...particles.map(p => p.y ?? 0));
    const center = {x: (minX + maxX) / 2, y: (minY + maxY) / 2};
    const box: Box = {x: center.x + origin.x, y: center.y + origin.y, width: maxX - minX + 144, height: maxY - minY + 80};
    // Preserve shared positions on center changes. Explicit user pins also survive crowded views.
    if (!group.some(id => pinned.has(id)) && (!existing.length || occupied.some(other => overlaps(box, other)))) {
      for (let slot = 0; ; slot++) {
        const angle = -Math.PI / 2 + slot * Math.PI * (3 - Math.sqrt(5));
        const ring = Math.sqrt(slot / 12);
        box.x = Math.cos(angle) * (radiusX + box.width / 2 + 100 + ring * (box.width + 80));
        box.y = Math.sin(angle) * (radiusY + box.height / 2 + 100 + ring * (box.height + 80));
        if (!occupied.some(other => overlaps(box, other))) break;
      }
    }
    for (const particle of particles) positions[particle.id] = {
      x: (particle.x ?? 0) - center.x + box.x,
      y: (particle.y ?? 0) - center.y + box.y,
    };
    occupied.push(box);
  }
  return positions;
}
