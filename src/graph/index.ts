import type { GraphAccess, NoteId, NoteRecord, Neighborhood } from '../model/types';
import { buildNeighborhood } from './neighborhood';

const unique = (ids: NoteId[]) => [...new Set(ids)];

/** A note graph with reverse indexes. Missing destinations remain latent until restored. */
export class GraphIndex implements GraphAccess {
  private records = new Map<NoteId, NoteRecord>();
  private childIndex = new Map<NoteId, Set<NoteId>>();
  private linkIndex = new Map<NoteId, Set<NoteId>>();
  private listeners = new Set<() => void>();
  private batchDepth = 0;
  private dirty = false;
  private catalog?: NoteRecord[];

  constructor(initial: Iterable<NoteRecord> = []) {
    this.batch(() => { for (const note of initial) this.upsert(note); });
  }

  get(id: NoteId): NoteRecord | undefined { return this.records.get(id); }
  all(): NoteRecord[] {
    this.catalog ??= [...this.records.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
    return this.catalog.slice();
  }

  upsert(input: NoteRecord): void {
    const record = { ...input, parents: unique(input.parents), links: unique(input.links), issues: [...input.issues] };
    const previous = this.records.get(record.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(record)) return;
    if (previous) this.updateReverse(previous, false);
    this.records.set(record.id, record);
    this.updateReverse(record, true);
    this.changed();
  }

  remove(id: NoteId): void {
    const previous = this.records.get(id);
    if (!previous) return;
    this.updateReverse(previous, false);
    this.records.delete(id);
    this.changed();
  }

  clear(): void {
    if (!this.records.size) return;
    this.records.clear(); this.childIndex.clear(); this.linkIndex.clear();
    this.changed();
  }

  parents(id: NoteId): NoteId[] { return this.existing(this.records.get(id)?.parents ?? [], id); }
  children(id: NoteId): NoteId[] { return this.records.has(id) ? this.existing(this.childIndex.get(id) ?? [], id) : []; }
  linked(id: NoteId): NoteId[] {
    if (!this.records.has(id)) return [];
    return this.existing(new Set([...(this.records.get(id)?.links ?? []), ...(this.linkIndex.get(id) ?? [])]), id);
  }

  neighborhood(focus: NoteId, maxNodes = 200, preferredId?: NoteId, root?: NoteId | null): Neighborhood {
    return buildNeighborhood(this, focus, maxNodes, preferredId, root);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  batch<T>(operation: () => T): T {
    this.batchDepth++;
    try { return operation(); }
    finally {
      this.batchDepth--;
      if (!this.batchDepth && this.dirty) this.emit();
    }
  }

  private existing(ids: Iterable<NoteId>, self: NoteId): NoteId[] {
    return [...ids].filter(id => id !== self && this.records.has(id));
  }

  private updateReverse(record: NoteRecord, add: boolean): void {
    const groups: [Map<NoteId, Set<NoteId>>, NoteId[]][] = [[this.childIndex, record.parents], [this.linkIndex, record.links]];
    for (const [index, targets] of groups) {
      for (const target of targets) {
        if (add) {
          let sources = index.get(target);
          if (!sources) { sources = new Set(); index.set(target, sources); }
          sources.add(record.id);
        } else {
          const sources = index.get(target);
          sources?.delete(record.id);
          if (!sources?.size) index.delete(target);
        }
      }
    }
  }

  private changed(): void { this.catalog = undefined; this.dirty = true; if (!this.batchDepth) this.emit(); }
  private emit(): void {
    this.dirty = false;
    for (const listener of [...this.listeners]) listener();
  }
}
