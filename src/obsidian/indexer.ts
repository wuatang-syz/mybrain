import type { App, EventRef, TAbstractFile, TFile } from 'obsidian';
import { GraphIndex } from '../graph';
import {directoryRecords} from '../graph/directory';
import { parseCachedNote } from '../graph/parse';

export interface VaultIndexerOptions {
  onRename?: (oldPath: string, newPath: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
  /** Called once the first full scan has been applied, so callers can prune stale state safely. */
  onReady?: () => void;
}

/** Reads Obsidian's public metadata cache; never edits vault files. */
export class VaultIndexer {
  readonly notes = new GraphIndex();
  private folders: string[] = [];
  private cleanup: (() => void)[] = [];
  private pending = new Set<string>();
  private unresolved = new Map<string, Set<string>>();
  private waiting = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private renameQueue: Promise<void> = Promise.resolve();
  private renamesPending = 0;
  private generation = 0;
  private newDestinations = new Set<string>();
  private deleted = new Set<string>();
  private renameErrors: unknown[] = [];

  constructor(private app: App, private graph: GraphIndex, private options: VaultIndexerOptions = {}) {}

  start(registerEvent?: (ref: EventRef) => void): void {
    if (this.started) return;
    this.started = true;
    this.generation++;
    this.readFolders();
    this.cleanup.push(this.notes.subscribe(() => this.publish()));
    const metadata = this.app.metadataCache;
    const vault = this.app.vault;
    const listen = (ref: EventRef, off: () => void) => {
      registerEvent?.(ref);
      this.cleanup.push(off);
    };
    const changed = metadata.on('changed', file => this.enqueue(file.path));
    listen(changed, () => metadata.offref(changed));
    const resolve = metadata.on('resolve', file => this.enqueue(file.path));
    listen(resolve, () => metadata.offref(resolve));
    const resolved = metadata.on('resolved', () => {
      for (const path of this.waiting) this.enqueue(path);
      for (const path of this.newDestinations) this.repairUnresolved(path);
      this.newDestinations.clear();
    });
    listen(resolved, () => metadata.offref(resolved));
    const created = vault.on('create', file => {
      if (!isMarkdown(file)) {this.readFolders(); this.publish(); return;}
      this.enqueue(file.path);
      this.newDestinations.add(file.path);
      this.repairUnresolved(file.path);
    });
    listen(created, () => vault.offref(created));
    const deleted = vault.on('delete', file => this.handleDelete(file.path));
    listen(deleted, () => vault.offref(deleted));
    const renamed = vault.on('rename', (file, oldPath) => this.scheduleRename(file.path, oldPath));
    listen(renamed, () => vault.offref(renamed));
    this.notes.batch(() => {
      this.notes.clear();
      for (const file of vault.getMarkdownFiles()) this.refresh(file.path);
    });
    this.publish();
    this.options.onReady?.();
  }

  private readFolders(): void {
    this.folders = (this.app.vault.getAllLoadedFiles?.() ?? []).filter(file => 'children' in file).map(file => file.path);
  }

  private publish(): void {
    const records = directoryRecords(this.app.vault.getName?.() ?? '知识库', this.folders, this.notes.all());
    const ids = new Set(records.map(record => record.id));
    this.graph.batch(() => {
      for (const record of this.graph.all()) if (!ids.has(record.id)) this.graph.remove(record.id);
      for (const record of records) this.graph.upsert(record);
    });
  }

  async settled(): Promise<void> {
    await this.renameQueue;
    this.readFolders();
    const pending = [...this.pending]; this.pending.clear();
    this.notes.batch(() => {
      for (const path of this.deleted) this.handleDelete(path);
      this.deleted.clear();
      for (const path of pending) this.refresh(path);
    });
    this.publish();
    if (this.renameErrors.length) {const error = this.renameErrors[0]; this.renameErrors = []; throw error;}
  }

  stop(): void {
    for (const off of this.cleanup.splice(0)) off();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear(); this.unresolved.clear(); this.waiting.clear();
    this.newDestinations.clear();
    this.deleted.clear();
    this.renameErrors = [];
    this.started = false;
    this.generation++;
    this.renamesPending = 0;
    this.renameQueue = Promise.resolve();
  }

  refresh(path: string): void {
    if (this.renamesPending) { this.pending.add(path); return; }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !isMarkdown(file)) {
      this.forget(path);
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) this.waiting.add(path);
    else this.waiting.delete(path);
    const parsed = parseCachedNote(file.path, file.basename, cache, (link, source) => {
      const target = this.app.metadataCache.getFirstLinkpathDest(link, source);
      return target?.extension.toLowerCase() === 'md' ? target.path : null;
    });
    // Transient cache misses must not erase the last known relationships.
    if (cache || !this.notes.get(path)) this.notes.upsert(parsed.record);
    if (cache) {
      if (parsed.unresolved.length) this.unresolved.set(path, new Set(parsed.unresolved));
      else this.unresolved.delete(path);
    }
  }

  private enqueue(path: string): void {
    this.pending.add(path);
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.started || this.renamesPending) return;
      const pending = [...this.pending];
      this.pending.clear();
      this.notes.batch(() => {
        for (const path of this.deleted) this.handleDelete(path);
        this.deleted.clear();
        for (const path of pending) this.refresh(path);
      });
    }, 35);
  }

  private handleDelete(path: string): void {
    this.readFolders();
    if (this.renamesPending) { this.deleted.add(path); this.pending.add(path); return; }
    const affected = this.notes.get(path) ? [path] : this.notes.all().filter(note => note.id.startsWith(`${path}/`)).map(note => note.id);
    this.notes.batch(() => {
      for (const id of affected) {
        const referers = this.referers(id);
        this.forget(id);
        for (const source of referers) this.enqueue(source);
      }
    });
    this.publish();
  }

  private scheduleRename(newPath: string, oldPath: string): void {
    const generation = this.generation;
    this.renamesPending++;
    const rename = async () => {
      if (!this.started || generation !== this.generation) return;
      try { await this.options.onRename?.(oldPath, newPath); }
      catch (error) { this.renameErrors.push(error); this.report(error); }
      if (!this.started || generation !== this.generation) return;
      this.readFolders();
      this.remapGraph(oldPath, newPath);
      this.publish();
    };
    this.renameQueue = this.renameQueue.then(rename, rename).catch(error => this.report(error)).finally(() => {
      if (generation !== this.generation) return;
      this.renamesPending--;
      if (this.started && !this.renamesPending) {
        for (const path of this.pending) this.enqueue(path);
      }
    });
  }

  private remapGraph(oldPath: string, newPath: string): void {
    const map = (path: string) => path === oldPath || path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
    const renamed = this.notes.get(oldPath) ? [this.notes.get(oldPath)!] : this.notes.all().filter(note => note.id.startsWith(`${oldPath}/`));
    const affected = new Set(renamed.map(note => note.id));
    for (const note of renamed) for (const source of this.referers(note.id)) affected.add(source);
    const snapshots = [...affected].map(id => this.notes.get(id)).filter(note => note !== undefined);
    const unresolved = new Map([...affected].map(id => [id, this.unresolved.get(id)]));
    this.notes.batch(() => {
      for (const note of renamed) this.forget(note.id);
      for (const note of snapshots) {
        const id = map(note.id);
        this.notes.upsert({ ...note, id, title: id === note.id ? note.title : id.split('/').pop()!.replace(/\.md$/i, ''), parents: note.parents.map(map), links: note.links.map(map) });
        const missing = unresolved.get(note.id);
        if (missing) this.unresolved.set(id, missing);
        this.pending.add(id);
        if (id !== note.id) { this.newDestinations.add(id); this.repairUnresolved(id); }
      }
    });
  }

  private referers(id: string): string[] {
    return this.notes.linked(id);
  }

  private repairUnresolved(newPath: string): void {
    const withoutExtension = newPath.replace(/\.md$/i, '');
    const basename = withoutExtension.split('/').pop();
    for (const [source, links] of this.unresolved) {
      for (const link of links) {
        const normalized = link.replace(/\.md$/i, '');
        if (normalized === withoutExtension || normalized.split('/').pop() === basename) {
          this.enqueue(source);
          break;
        }
      }
    }
  }

  private forget(path: string): void {
    this.notes.remove(path);
    this.pending.delete(path); this.unresolved.delete(path); this.waiting.delete(path);
  }

  private report(error: unknown): void {
    // A reporting callback must not reject the rename queue and strand later events.
    try {
      if (this.options.onError) this.options.onError(error);
      else console.error('Brain relationship rename repair failed', error);
    } catch (reportError) { console.error('Brain error notification failed', reportError); }
  }
}

function isMarkdown(file: TAbstractFile): file is TFile {
  return 'extension' in file && typeof file.extension === 'string' && file.extension.toLowerCase() === 'md';
}
