import type {Point3, UniverseState} from '../model/types';

/**
 * Reader for the legacy `mapLayout.universe` record. The knowledge world migrated that state into
 * `knowledgeWorld.views`, but the old field is still validated and preserved so downgrading stays
 * lossless. Never accept NaN or Infinity from persisted plugin data.
 */
export function sanitizeUniverse(raw: unknown): UniverseState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<UniverseState>;
  const valid = (point?: Point3): point is Point3 =>
    !!point && [point.x, point.y, point.z].every(entry => Number.isFinite(entry) && Math.abs(entry) <= 10000);
  if (value.version !== 1 || !valid(value.camera) || !valid(value.target)) return undefined;
  const distance = Math.hypot(value.camera.x - value.target.x, value.camera.y - value.target.y, value.camera.z - value.target.z);
  if (distance < 1 || distance > 4000) return undefined;
  const positions: Record<string, Point3> = {};
  for (const [id, point] of Object.entries(value.positions ?? {}).slice(0, 2000)) if (valid(point)) positions[id] = {...point};
  return {version: 1, level: typeof value.level === 'string' ? value.level : null,
    camera: {...value.camera}, target: {...value.target}, positions, motion: value.motion !== false};
}
