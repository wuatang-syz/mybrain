import type {WorldShapeBuilder, WorldShapeId} from './types';
import {tailShapes} from './shapes/tail';
import {universeShapes} from './shapes/universe';
import {cityShapes} from './shapes/city';

/**
 * Every procedural shape a theme may declare in its ladder. Themes only publish the subset they
 * use, so an unknown or missing shape is a configuration error rather than a silent blank scene.
 */
export const worldShapes: Record<WorldShapeId, WorldShapeBuilder> = {
  ...tailShapes,
  ...universeShapes,
  ...cityShapes,
} as Record<WorldShapeId, WorldShapeBuilder>;

export function pickShapes(ids: readonly WorldShapeId[]): Partial<Record<WorldShapeId, WorldShapeBuilder>> {
  const picked: Partial<Record<WorldShapeId, WorldShapeBuilder>> = {};
  for (const id of ids) {const builder = worldShapes[id]; if (builder) picked[id] = builder;}
  return picked;
}
