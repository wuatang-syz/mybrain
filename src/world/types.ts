import type * as THREE from 'three';
import type {NoteId, Point3} from '../model/types';

/**
 * Knowledge snapshot types. A snapshot is pure knowledge: it never carries colours, coordinates,
 * materials or world names. Themes read it and decide how a world looks.
 */
export interface SnapshotGroup {
  id: NoteId;
  title: string;
  /** Groups always sit directly below the world centre. */
  depth: number;
  members: NoteId[];
  hidden: number;
  drillable: boolean;
  /** The synthetic bucket for notes belonging to no displayed group. */
}
export interface SnapshotNote {
  id: NoteId;
  title: string;
  group: NoteId;
  /** Structural depth below the current world centre. */
  depth: number;
  /** The note owns children, so the world can drill into it. */
  expandable: boolean;
}
export type SnapshotRelationKind = 'hierarchy' | 'jump';
export interface SnapshotRelation {source: NoteId; target: NoteId; kind: SnapshotRelationKind}
export interface SnapshotStats {groups: number; notes: number; drawn: number; hidden: number; total: number}
export interface KnowledgeSnapshot {
  /** The level currently explored. It is the world centre and stays off the canvas. */
  level: {id: NoteId; title: string} | null;
  root: NoteId | null;
  selected: NoteId | null;
  groups: SnapshotGroup[];
  notes: SnapshotNote[];
  relations: SnapshotRelation[];
  /** Notes chosen by the shared expansion budget, in stable order. */
  drawn: NoteId[];
  stats: SnapshotStats;
}

export type WorldShapeId =
  | 'core' | 'galaxy' | 'planet' | 'island' | 'station' | 'orb'
  | 'plaza' | 'district' | 'landmark' | 'building' | 'grid' | 'room'
  | 'octagon' | 'heptagon' | 'hexagon' | 'pentagon' | 'quad' | 'triangle' | 'point'
  | 'unassigned';
export type WorldRole = 'center' | 'group' | 'member';
/** A mapping entry either points at a concrete shape or follows the level ladder. */
export type WorldShapeChoice = WorldShapeId | 'level';

export interface WorldLevel {id: string; name: string; shape: WorldShapeId; size: number; detail: number}

export interface WorldAppearance {
  background: string;
  palette: string[];
  labelSize: number;
  modelScale: number;
  motion: boolean;
  /** Theme specific: universe glow strength, city ambient fill. */
  glow: number;
  windowLight?: number;
  /** Shared: structure, jump and decoration strokes. */
  structure: string;
  decoration: string;
  /** Universe nebula tint / city ground colour. */
  ground: string;
  /** Universe crystal accent / city building accent. */
  building: string;
}
export interface WorldLayoutSpec {
  groupGap: number;
  memberGap: number;
  /** Universe drags on the camera plane, the city drags on its ground plane. */
  plane: 'camera' | 'ground';
  rings: number;
  orbit: number;
  spacing: number;
  lift: number;
  tilt: number;
}
export interface WorldRelationStyle {color: string; opacity: number; width: number; dashed: boolean}
export interface WorldDecorationSpec {kind: 'orbit' | 'road'; color: string; opacity: number; width: number}
export interface WorldCopy {
  eyebrow: string;
  heading: string;
  centerSubtitle: string;
  groupSubtitle: string;
  navigator: string;
  navigatorHint: string;
  /** `{level}` is replaced with the level name of the target level. */
  enter: string;
  expand: string;
  motionOn: string;
  motionOff: string;
  hint: string;
  legend: {label: string; role: WorldRole}[];
  fail: string;
}
export interface WorldMotionSpec {spin: number; drift: number; twinkle: boolean}

export interface ResolvedAppearance {
  background: number;
  palette: number[];
  labelSize: number;
  modelScale: number;
  motion: boolean;
  glow: number;
  windowLight?: number;
  structure: number;
  decoration: number;
  ground: number;
  building: number;
}
export interface WorldObject {
  id: NoteId;
  title: string;
  role: WorldRole;
  /** Resolved ladder index, or 0 for the world centre. */
  level: number;
  depth: number;
  shape: WorldShapeId;
  color: number;
  size: number;
  detail: number;
  icon?: string;
  count: number;
  hidden: number;
  enter: boolean;
  expandable: boolean;
  /** Owning group for members, own id for groups. */
  domain: NoteId;
}

export interface ShapeInput {
  seed?: number;
  role: WorldRole;
  level: number;
  shape: WorldShapeId;
  color: number;
  size: number;
  detail: number;
  appearance: ResolvedAppearance;
}
export interface ShapeResult {
  object: THREE.Group;
  /** The mesh used for raycasting, selection and dragging. */
  hit: THREE.Mesh;
  /** Bounding radius in world units. */
  radius: number;
  /** Radians per second of idle spin. */
  spin: number;
}
export type WorldShapeBuilder = (input: ShapeInput) => ShapeResult;

/** A buildable object: the resolved knowledge object plus its live three.js scene node. */
export interface WorldBody {
  object: WorldObject;
  group: THREE.Group;
  hit: THREE.Mesh;
  radius: number;
  spin: number;
}

/** A theme declares its ladder, visuals, layout, relation styles, copy and animation. */
export interface WorldThemeDefinition {
  lighting?: {ambient: string; ambientIntensity: number; key: string; keyIntensity: number; rim: string; rimIntensity: number; fogNear: number; fogFar: number};
  id: string;
  name: string;
  levels: WorldLevel[];
  roles: Record<WorldRole, WorldShapeChoice>;
  visuals: WorldAppearance;
  layout: WorldLayoutSpec;
  relations: {structure: WorldRelationStyle; jump: WorldRelationStyle};
  decoration: WorldDecorationSpec;
  motion: WorldMotionSpec;
  copy: WorldCopy;
  shapes: Partial<Record<WorldShapeId, WorldShapeBuilder>>;
}

export interface WorldObjectOverride {color?: string; icon?: string; shape?: WorldShapeId}
export interface WorldMappingConfig {
  center: WorldShapeChoice;
  group: WorldShapeChoice;
  member: WorldShapeChoice;
  groups: Record<NoteId, WorldObjectOverride>;
  notes: Record<NoteId, WorldObjectOverride>;
}
/** Only fields the user changed are stored; every other field follows the theme default. */
export interface WorldAppearanceConfig {
  background?: string;
  palette?: string[];
  labelSize?: number;
  modelScale?: number;
  motion?: boolean;
  glow?: number;
  windowLight?: number;
  structure?: string;
  decoration?: string;
  ground?: string;
  building?: string;
}
export interface WorldLayoutConfig {groupGap?: number; memberGap?: number}
export interface WorldThemeConfig {
  appearance: WorldAppearanceConfig;
  mapping: WorldMappingConfig;
  layout: WorldLayoutConfig;
}
export interface WorldView {
  camera: Point3;
  target: Point3;
  positions: Record<NoteId, Point3>;
  expanded: NoteId[];
}
export interface KnowledgeWorldState {
  version: 1;
  theme: string;
  themes: Record<string, WorldThemeConfig>;
  /** Camera, positions and expansion per theme and attention level. */
  views: Record<string, WorldView>;
}
