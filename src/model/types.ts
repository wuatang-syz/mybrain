export type NoteId = string;
export type RelationKind = 'parent' | 'child' | 'jump';
export type Zone = RelationKind | 'sibling' | 'outer' | 'focus';
export interface NoteRecord {
  id: NoteId;
  title: string;
  kind?: 'root' | 'folder' | 'note';
  path?: string;
  notePath?: string;
  icon?: string;
  parents: NoteId[];
  links: NoteId[];
  issues: string[];
}
export interface GraphAccess {
  get(id: NoteId): NoteRecord | undefined;
  all(): NoteRecord[];
  parents(id: NoteId): NoteId[];
  children(id: NoteId): NoteId[];
  linked(id: NoteId): NoteId[];
}
export interface GraphNode { id: NoteId; title: string; displayTitle?: string; icon?: string; kind?: NoteRecord['kind']; notePath?: string; links?: NoteId[]; zone: Zone; groupParents: NoteId[]; issues: string[] }
export interface GraphEdge { source: NoteId; target: NoteId; kind: 'hierarchy' | 'jump' }
export interface Neighborhood {
  focus: NoteId;
  root?: NoteId;
  nodes: GraphNode[];
  edges: GraphEdge[];
  overflow: GraphNode[];
  parents: {id: NoteId; title: string}[];
  counts: Record<Zone, number>;
}
export interface Point { x: number; y: number }
export interface Viewport { x: number; y: number; scale: number }
export interface LayoutState { positions: Record<NoteId, Point>; pinned: NoteId[]; viewport?: Viewport; order?: NoteId[]; windows?: Partial<Record<'parent' | 'child' | 'sibling' | 'jump', number>>; windowVersion?: 3 }
/**
 * Knowledge map layout is card based: `cards` holds whole-cluster offsets and `nodes` holds the
 * absolute position of individually dragged notes. Card boxes are always recomputed from those
 * two inputs so a moved node can never leave its card behind.
 */
export interface MapLayoutState {
  version: 2;
  nodes: Record<NoteId, Point>;
  cards: Record<NoteId, Point>;
  viewport?: Viewport;
  universe?: UniverseState;
}
export interface Point3 {x: number; y: number; z: number}
/** Three-dimensional state is separate from the legacy card coordinates. */
export interface UniverseState {
  version: 1;
  level: NoteId | null;
  camera: Point3;
  target: Point3;
  positions: Record<NoteId, Point3>;
  motion: boolean;
}
export interface RelationRequest {
  focus: NoteId;
  target: NoteId;
  kind: RelationKind | 'sibling';
}
export interface CanvasCallbacks {
  renderIcon?(element: HTMLElement, name: string): void;
  onFocus(id: NoteId): void;
  onOpen(id: NoteId): void;
  onEdit?(id: NoteId): void;
  onDrop(request: RelationRequest): void;
  onConnect(source: NoteId, target: NoteId): void;
  /** Dragging a core node port onto blank canvas asks for a new note. */
  onCreate(source: NoteId, kind: RelationKind | 'sibling', point: Point): void;
  onNewNote(): void;
  onEdgeContext?(edge: GraphEdge, event: MouseEvent): void;
  onContext(id: NoteId, event: MouseEvent): void;
  onLayout(state: LayoutState): void;
  /** Current canvas zoom, consumed by the shared footer readout. */
  onZoom?(percent: number): void;
  onOverflow(nodes: GraphNode[]): void;
}
