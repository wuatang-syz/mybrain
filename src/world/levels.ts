import type {WorldLevel} from './types';

/**
 * The shared level ladder. A world object takes the ladder entry that matches its structural
 * depth below the current world centre: the centre is level 0, its domains level 1, their direct
 * children level 2 and everything deeper continues down the ladder until it becomes a point.
 *
 * Every theme declares its own names and shapes for the ladder, and the tail below is shared so
 * two themes always degrade the same way once the theme specific levels are used up.
 */
export const LEVEL_COUNT = 15;
/** The deepest ladder index; every deeper note keeps this entry instead of falling off the ladder. */
export const POINT_LEVEL = LEVEL_COUNT - 1;

/** Levels 6-14: polygons losing one side each step, then plain points. */
export const POLYGON_POINT_TAIL: WorldLevel[] = [
  {id: 'octagon', name: '八边形', shape: 'octagon', size: .5, detail: 1},
  {id: 'heptagon', name: '七边形', shape: 'heptagon', size: .44, detail: 1},
  {id: 'hexagon', name: '六边形', shape: 'hexagon', size: .38, detail: 1},
  {id: 'pentagon', name: '五边形', shape: 'pentagon', size: .32, detail: 1},
  {id: 'quad', name: '四边形', shape: 'quad', size: .26, detail: 1},
  {id: 'triangle', name: '三边形', shape: 'triangle', size: .22, detail: 1},
  {id: 'point', name: '点', shape: 'point', size: .18, detail: 1},
  {id: 'point-deep', name: '点', shape: 'point', size: .15, detail: 1},
  {id: 'point-faint', name: '点', shape: 'point', size: .12, detail: 1},
];

/** Depth below the world centre, clamped onto the ladder. */
export function ladderIndex(depth: number): number {
  if (!Number.isFinite(depth)) return 0;
  return Math.max(0, Math.min(POINT_LEVEL, Math.floor(depth)));
}

/** Resolves the ladder entry for a depth, tolerating a theme that declared a shorter ladder. */
export function ladderLevel(levels: WorldLevel[], depth: number): WorldLevel {
  const index = Math.min(ladderIndex(depth), Math.max(0, levels.length - 1));
  return levels[index] ?? levels[levels.length - 1]!;
}
