import type {NoteId, Point3} from '../model/types';
import {LEVEL_COUNT, ladderIndex, ladderLevel} from './levels';
import {cityTheme} from './themes/city';
import {universeTheme} from './themes/universe';
import type {
  KnowledgeSnapshot, KnowledgeWorldState, ResolvedAppearance, SnapshotGroup, WorldAppearanceConfig,
  WorldLayoutConfig, WorldLayoutSpec, WorldMappingConfig, WorldObject, WorldObjectOverride, WorldShapeChoice,
  WorldShapeId, WorldThemeConfig, WorldThemeDefinition, WorldView,
} from './types';

export const DEFAULT_THEME_ID = 'universe';
/** Synthetic centre used when the snapshot has no attention note. */
export const CENTER_ID = '\u0000world-center';

const registry: Record<string, WorldThemeDefinition> = {[universeTheme.id]: universeTheme, [cityTheme.id]: cityTheme};

/** Unknown themes fall back to the universe, as the plan requires. */
export function resolveTheme(id?: string | null): WorldThemeDefinition {
  return (id && registry[id]) || registry[DEFAULT_THEME_ID]!;
}
export function themeOptions(): {id: string; name: string}[] {
  return Object.values(registry).map(theme => ({id: theme.id, name: theme.name}));
}
export function knownThemes(): string[] {return Object.keys(registry);}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseColor(value: string | undefined, fallback: number): number {
  if (!value || !HEX.test(value.trim())) return fallback;
  const raw = value.trim().slice(1);
  const full = raw.length === 3 ? raw.split('').map(char => char + char).join('') : raw;
  return Number.parseInt(full, 16);
}
function hex(value: number): string {return `#${value.toString(16).padStart(6, '0')}`;}
export function toHex(value: number): string {return hex(value);}
export function defaultThemeConfig(theme: WorldThemeDefinition): WorldThemeConfig {
  return {appearance: {}, layout: {},
    mapping: {center: theme.roles.center, group: theme.roles.group, member: theme.roles.member, groups: {}, notes: {}}};
}
export function newWorldState(): KnowledgeWorldState {
  const themes: Record<string, WorldThemeConfig> = {};
  for (const theme of Object.values(registry)) themes[theme.id] = defaultThemeConfig(theme);
  return {version: 1, theme: DEFAULT_THEME_ID, themes, views: {}};
}
export function themeConfig(state: KnowledgeWorldState, id: string): WorldThemeConfig {
  const theme = resolveTheme(id);
  const existing = state.themes[theme.id] ?? defaultThemeConfig(theme);
  state.themes[theme.id] = existing;
  return existing;
}
export function viewKey(themeId: string, level: string | null | undefined): string {
  return `${resolveTheme(themeId).id}:${level ?? ''}`;
}
export function emptyView(): WorldView {
  return {camera: {x: 0, y: 32, z: 42}, target: {x: 0, y: 0, z: 0}, positions: {}, expanded: []};
}
export function cloneWorldState(state: KnowledgeWorldState): KnowledgeWorldState {
  return JSON.parse(JSON.stringify(state)) as KnowledgeWorldState;
}

export function resolveAppearance(theme: WorldThemeDefinition, config: WorldThemeConfig): ResolvedAppearance {
  const visuals = theme.visuals, appearance: WorldAppearanceConfig = config.appearance ?? {};
  const palette = Array.isArray(appearance.palette) && appearance.palette.length
    ? appearance.palette.filter(color => typeof color === 'string' && HEX.test(color)).slice(0, 12)
    : visuals.palette;
  const resolved = palette.length ? palette : visuals.palette;
  return {
    background: parseColor(appearance.background, parseColor(visuals.background, 0x050d20)),
    palette: (resolved.length ? resolved : visuals.palette).map(color => parseColor(color, 0x888888)),
    labelSize: clamp(finite(appearance.labelSize) ? appearance.labelSize : visuals.labelSize, .5, 2),
    modelScale: clamp(finite(appearance.modelScale) ? appearance.modelScale : visuals.modelScale, .4, 2.5),
    motion: typeof appearance.motion === 'boolean' ? appearance.motion : visuals.motion,
    windowLight: clamp(finite(appearance.windowLight) ? appearance.windowLight : visuals.windowLight ?? 1, 0, 2),
    glow: clamp(finite(appearance.glow) ? appearance.glow : visuals.glow, 0, 1.5),
    structure: parseColor(appearance.structure, parseColor(visuals.structure, 0x8fd8ff)),
    decoration: parseColor(appearance.decoration, parseColor(visuals.decoration, 0x2b4d7d)),
    ground: parseColor(appearance.ground, parseColor(visuals.ground, 0x101a3a)),
    building: parseColor(appearance.building, parseColor(visuals.building, 0x85bdff)),
  };
}
export function resolveLayout(theme: WorldThemeDefinition, config: WorldThemeConfig): WorldLayoutSpec {
  const layout: WorldLayoutConfig = config.layout ?? {};
  return {...theme.layout,
    groupGap: clamp(finite(layout.groupGap) ? layout.groupGap : theme.layout.groupGap, 4, 40),
    memberGap: clamp(finite(layout.memberGap) ? layout.memberGap : theme.layout.memberGap, 1, 12)};
}

function shapeFor(choice: WorldShapeChoice, fallback: WorldShapeId): WorldShapeId {
  return choice === 'level' ? fallback : choice;
}
function override(overrides: Record<NoteId, WorldObjectOverride>, id: NoteId): WorldObjectOverride {
  return overrides[id] ?? {};
}
function overrideColor(raw: WorldObjectOverride, fallback: number): number {
  return typeof raw.color === 'string' ? parseColor(raw.color, fallback) : fallback;
}
function overrideShape(theme: WorldThemeDefinition, raw: WorldObjectOverride, fallback: WorldShapeId): WorldShapeId {
  if (!raw.shape) return fallback;
  return theme.shapes[raw.shape] ? raw.shape : fallback;
}

/**
 * Field level merge: theme default, then role default, then the object override.
 * A group colour is inherited by every member that does not override it, and a note that is
 * drilled into becomes the centre, so it uses the centre mapping instead of its member mapping.
 */
export function resolveObjects(theme: WorldThemeDefinition, config: WorldThemeConfig, snapshot: KnowledgeSnapshot): WorldObject[] {
  const appearance = resolveAppearance(theme, config), mapping = config.mapping;
  const levels = theme.levels;
  const centerId = snapshot.level?.id ?? CENTER_ID;
  const centerOverride = override(mapping.notes, centerId);
  const center: WorldObject = {
    id: centerId, title: snapshot.level?.title ?? '个人知识库', role: 'center', level: 0, depth: 0,
    shape: overrideShape(theme, centerOverride, shapeFor(mapping.center, levels[0]!.shape)),
    color: overrideColor(centerOverride, appearance.building), size: levels[0]!.size * appearance.modelScale,
    detail: levels[0]!.detail, icon: centerOverride.icon, count: snapshot.stats.total, hidden: 0,
    enter: false, expandable: false, domain: centerId,
  };
  const objects: WorldObject[] = [center];
  snapshot.groups.forEach((group: SnapshotGroup, index) => {
    const raw = override(mapping.groups, group.id);
    const paletteColor = appearance.palette[index % Math.max(1, appearance.palette.length)] ?? appearance.building;
    const color = overrideColor(raw, paletteColor);
    const shape: WorldShapeId = overrideShape(theme, raw, shapeFor(mapping.group, levels[Math.min(1, levels.length - 1)]!.shape));
    objects.push({id: group.id, title: group.title, role: 'group', level: group.depth, depth: group.depth, shape,
      color, size: levels[Math.min(1, levels.length - 1)]!.size * appearance.modelScale,
      detail: levels[Math.min(1, levels.length - 1)]!.detail, icon: raw.icon, count: group.members.length,
      hidden: group.hidden, enter: group.drillable, expandable: group.hidden > 0, domain: group.id});
    for (const id of group.members) {
      const entry = snapshot.notes.find(note => note.id === id);
      if (!entry) continue;
      const level = ladderIndex(entry.depth), step = ladderLevel(levels, entry.depth);
      const noteOverride = override(mapping.notes, id);
      objects.push({id, title: entry.title, role: 'member', level, depth: entry.depth,
        shape: overrideShape(theme, noteOverride, shapeFor(mapping.member, step.shape)),
        color: overrideColor(noteOverride, overrideColor(raw, color)),
        size: step.size * appearance.modelScale, detail: step.detail, icon: noteOverride.icon ?? raw.icon ?? undefined,
        count: 0, hidden: 0, enter: entry.expandable, expandable: entry.expandable, domain: group.id});
    }
  });
  return objects;
}
/** The theme level name used for labels, hints and the settings shape list. */
export function levelName(theme: WorldThemeDefinition, level: number): string {
  return ladderLevel(theme.levels, level).name;
}
export function levelChoices(theme: WorldThemeDefinition): {id: WorldShapeId; name: string; level: number}[] {
  return theme.levels.slice(0, LEVEL_COUNT).map((entry, level) => ({id: entry.shape, name: entry.name, level}));
}

function sanitizeView(raw: unknown): WorldView | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<WorldView>;
  const point = (input: unknown): Point3 | undefined => {
    if (!input || typeof input !== 'object') return undefined;
    const candidate = input as Point3;
    return [candidate.x, candidate.y, candidate.z].every(entry => finite(entry) && Math.abs(entry) <= 10000)
      ? {x: candidate.x, y: candidate.y, z: candidate.z} : undefined;
  };
  const camera = point(value.camera), target = point(value.target);
  if (!camera || !target) return undefined;
  if (Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z) < 1) return undefined;
  const positions: Record<NoteId, Point3> = {};
  for (const [id, entry] of Object.entries(value.positions ?? {}).slice(0, 2000)) {
    const parsed = point(entry);
    if (parsed) positions[id] = parsed;
  }
  const expanded = Array.isArray(value.expanded)
    ? [...new Set(value.expanded.filter((id): id is string => typeof id === 'string'))].slice(0, 2000) : [];
  return {camera, target, positions, expanded};
}
function sanitizeOverride(raw: unknown, theme: WorldThemeDefinition): WorldObjectOverride {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as WorldObjectOverride, result: WorldObjectOverride = {};
  if (typeof value.color === 'string' && HEX.test(value.color)) result.color = value.color;
  if (typeof value.icon === 'string' && value.icon && value.icon.length <= 40) result.icon = value.icon;
  if (value.shape && theme.shapes[value.shape]) result.shape = value.shape;
  return result;
}
function sanitizeMapping(raw: unknown, theme: WorldThemeDefinition, base: WorldMappingConfig): WorldMappingConfig {
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<WorldMappingConfig>;
  const choice = (input: unknown, fallback: WorldShapeChoice): WorldShapeChoice => {
    if (input === 'level') return 'level';
    return typeof input === 'string' && theme.shapes[input as WorldShapeId] ? input as WorldShapeId : fallback;
  };
  const overrides = (input: unknown) => {
    const result: Record<NoteId, WorldObjectOverride> = {};
    if (!input || typeof input !== 'object') return result;
    for (const [id, entry] of Object.entries(input).slice(0, 500)) {
      const parsed = sanitizeOverride(entry, theme);
      if (Object.keys(parsed).length) result[id] = parsed;
    }
    return result;
  };
  return {center: choice(value.center, base.center), group: choice(value.group, base.group),
    member: choice(value.member, base.member), groups: overrides(value.groups), notes: overrides(value.notes)};
}
function sanitizeThemeConfig(raw: unknown, theme: WorldThemeDefinition): WorldThemeConfig {
  const base = defaultThemeConfig(theme);
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<WorldThemeConfig>, appearance: WorldAppearanceConfig = {};
  const source = value.appearance ?? {};
  if (typeof source.background === 'string' && HEX.test(source.background)) appearance.background = source.background;
  if (Array.isArray(source.palette)) {
    const palette = source.palette.filter((color): color is string => typeof color === 'string' && HEX.test(color)).slice(0, 12);
    if (palette.length) appearance.palette = palette;
  }
  if (finite(source.labelSize)) appearance.labelSize = clamp(source.labelSize, .5, 2);
  if (finite(source.modelScale)) appearance.modelScale = clamp(source.modelScale, .4, 2.5);
  if (typeof source.motion === 'boolean') appearance.motion = source.motion;
  if (finite(source.windowLight)) appearance.windowLight = clamp(source.windowLight, 0, 2);
  if (finite(source.glow)) appearance.glow = clamp(source.glow, 0, 1.5);
  for (const key of ['structure', 'decoration', 'ground', 'building'] as const) {
    const entry = source[key];
    if (typeof entry === 'string' && HEX.test(entry)) appearance[key] = entry;
  }
  const layout: WorldLayoutConfig = {};
  if (finite(value.layout?.groupGap)) layout.groupGap = clamp(value.layout.groupGap, 4, 40);
  if (finite(value.layout?.memberGap)) layout.memberGap = clamp(value.layout.memberGap, 1, 12);
  return {appearance, layout, mapping: sanitizeMapping(value.mapping, theme, base.mapping)};
}

/** Every field is validated on its own: an illegal value falls back to that field's default. */
export function sanitizeWorldState(raw: unknown): KnowledgeWorldState {
  const value = raw && typeof raw === 'object' ? raw as Partial<KnowledgeWorldState> : {};
  const state = newWorldState();
  state.theme = typeof value.theme === 'string' && registry[value.theme] ? value.theme : DEFAULT_THEME_ID;
  const sources = value.themes && typeof value.themes === 'object' ? value.themes : {};
  for (const theme of Object.values(registry)) state.themes[theme.id] = sanitizeThemeConfig(sources[theme.id], theme);
  const views = value.views && typeof value.views === 'object' ? value.views : {};
  for (const [key, entry] of Object.entries(views).slice(0, 400)) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    const themeId = key.slice(0, separator), level = key.slice(separator + 1);
    if (!registry[themeId]) continue;
    const view = sanitizeView(entry);
    if (view) state.views[`${themeId}:${level}`] = view;
  }
  return state;
}

interface LegacyUniverse {level: string | null; camera: Point3; target: Point3; positions: Record<string, Point3>; motion?: boolean}
/** Port of the legacy three-dimensional state reader, used only to migrate it forward once. */
export function sanitizeLegacyUniverse(raw: unknown): LegacyUniverse | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<LegacyUniverse> & {version?: number};
  const valid = (point?: Point3): point is Point3 => !!point && [point.x, point.y, point.z].every(entry => finite(entry) && Math.abs(entry) <= 10000);
  if (value.version !== 1 || !valid(value.camera) || !valid(value.target)) return undefined;
  const distance = Math.hypot(value.camera.x - value.target.x, value.camera.y - value.target.y, value.camera.z - value.target.z);
  if (distance < 1 || distance > 4000) return undefined;
  const positions: Record<string, Point3> = {};
  for (const [id, point] of Object.entries(value.positions ?? {}).slice(0, 2000)) if (valid(point)) positions[id] = {...point};
  return {level: typeof value.level === 'string' ? value.level : null, camera: {...value.camera}, target: {...value.target},
    positions, motion: value.motion !== false};
}
/**
 * Moves the legacy `mapLayout.universe` state into the universe view of the level it belonged to.
 * The migration is idempotent: existing knowledge world views are never overwritten, and the old
 * two-dimensional map data is left untouched.
 */
export function migrateLegacyUniverse(state: KnowledgeWorldState, raw: unknown): boolean {
  const legacy = sanitizeLegacyUniverse(raw);
  if (!legacy) return false;
  let changed = false;
  const key = viewKey(DEFAULT_THEME_ID, legacy.level);
  if (!state.views[key]) {
    state.views[key] = {camera: legacy.camera, target: legacy.target, positions: legacy.positions,
      expanded: []};
    changed = true;
  }
  if (legacy.motion === false && state.themes[DEFAULT_THEME_ID]?.appearance.motion === undefined) {
    themeConfig(state, DEFAULT_THEME_ID).appearance.motion = false;
    changed = true;
  }
  return changed;
}
/** Keeps every theme reference aligned after a file or folder rename. */
export function renameWorldRefs(state: KnowledgeWorldState, rename: (path: string) => string): void {
  const views: KnowledgeWorldState['views'] = {};
  for (const [key, view] of Object.entries(state.views)) {
    const separator = key.indexOf(':'), themeId = key.slice(0, separator), level = key.slice(separator + 1);
    views[`${themeId}:${level ? rename(level) : ''}`] = {
      camera: view.camera, target: view.target, expanded: view.expanded.map(rename),
      positions: Object.fromEntries(Object.entries(view.positions).map(([id, point]) => [rename(id), point])),
    };
  }
  state.views = views;
  for (const config of Object.values(state.themes)) {
    config.mapping.groups = Object.fromEntries(Object.entries(config.mapping.groups).map(([id, value]) => [rename(id), value]));
    config.mapping.notes = Object.fromEntries(Object.entries(config.mapping.notes).map(([id, value]) => [rename(id), value]));
  }
}
/** Drops references to notes that no longer exist. Only called once the index is ready. */
export function removeWorldRefs(state: KnowledgeWorldState, missing: (id: string) => boolean): void {
  for (const theme of Object.values(state.themes)) {
    for (const key of ['groups', 'notes'] as const) {
      const source = theme.mapping[key], kept: Record<NoteId, WorldObjectOverride> = {};
      for (const [id, value] of Object.entries(source)) if (!missing(id)) kept[id] = value;
      theme.mapping[key] = kept;
    }
  }
  const views: KnowledgeWorldState['views'] = {};
  for (const [key, view] of Object.entries(state.views)) {
    const separator = key.indexOf(':'), themeId = key.slice(0, separator), level = key.slice(separator + 1);
    if (level && missing(level)) continue;
    views[key] = {camera: view.camera, target: view.target, expanded: view.expanded.filter(id => !missing(id)),
      positions: Object.fromEntries(Object.entries(view.positions).filter(([id]) => !missing(id)))};
    void themeId;
  }
  state.views = views;
}
export function setTheme(state: KnowledgeWorldState, id: string): string {
  state.theme = resolveTheme(id).id;
  themeConfig(state, state.theme);
  return state.theme;
}
export function resetThemeConfig(state: KnowledgeWorldState, id: string): void {
  const theme = resolveTheme(id);
  state.themes[theme.id] = defaultThemeConfig(theme);
}
/** Layout reset only clears the position records of one theme and level. */
export function clearViewPositions(state: KnowledgeWorldState, id: string, level: string | null): void {
  const view = state.views[viewKey(id, level)];
  if (view) view.positions = {};
}
export function ensureView(state: KnowledgeWorldState, id: string, level: string | null): WorldView {
  const key = viewKey(id, level);
  const existing = state.views[key];
  if (existing) return existing;
  const view = emptyView();
  state.views[key] = view;
  return view;
}

