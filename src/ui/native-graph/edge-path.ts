import type {Point} from '../../model/types';
import type {Graphics} from './types';

/** Outer tracks deliberately retain straight segments and right-angle bends. */
export function drawEdgePath(graphic: Graphics, points: Point[]): void {
  if (!points.length) return;
  graphic.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) graphic.lineTo(point.x, point.y);
}
