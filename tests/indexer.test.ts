import type { App } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphIndex } from '../src/graph';
import type { NoteMetadata } from '../src/graph/parse';
import { VaultIndexer, type VaultIndexerOptions } from '../src/obsidian/indexer';

class Events {
  refs = new Set<{ name: string; callback: (...args: unknown[]) => void }>();
  on = (name: string, callback: (...args: unknown[]) => void) => {
    const ref = { name, callback }; this.refs.add(ref); return ref;
  };
  offref = (ref: { name: string; callback: (...args: unknown[]) => void }) => { this.refs.delete(ref); };
  emit(name: string, ...args: unknown[]): void {
    for (const ref of [...this.refs]) if (ref.name === name) ref.callback(...args);
  }
}

function fixture(initial: Record<string, NoteMetadata | null>, options: VaultIndexerOptions = {}) {
  vi.useFakeTimers();
  const files = new Map<string, { path: string; extension: string; basename: string }>();
  const caches = new Map<string, NoteMetadata | null>(Object.entries(initial));
  const file = (path: string) => ({ path, extension: path.split('.').pop()!, basename: path.split('/').pop()!.replace(/\.md$/i, '') });
  for (const path of Object.keys(initial)) files.set(path, file(path));
  const vaultEvents = new Events(), cacheEvents = new Events();
  const getMarkdownFiles = vi.fn(() => [...files.values()]);
  const getFileCache = vi.fn((item: { path: string }) => caches.get(item.path) ?? null);
  const app = {
    vault: { on: vaultEvents.on, offref: vaultEvents.offref, getMarkdownFiles, getAbstractFileByPath: (path: string) => files.get(path) },
    metadataCache: {
      on: cacheEvents.on, offref: cacheEvents.offref, getFileCache,
      getFirstLinkpathDest: (link: string, source: string) => {
        const normalized = link.replace(/\.md$/i, '');
        const folder = source.split('/').slice(0, -1).join('/');
        return files.get(`${normalized}.md`) ?? files.get(`${folder}/${normalized}.md`)
          ?? [...files.values()].find(item => item.basename === normalized);
      },
    },
  } as unknown as App;
  const graph = new GraphIndex();
  const indexer = new VaultIndexer(app, graph, options);
  const rename = (from: string, to: string) => {
    const moved = [...files.keys()].filter(path => path === from || path.startsWith(`${from}/`));
    for (const path of moved) {
      const next = to + path.slice(from.length);
      files.delete(path); files.set(next, file(next));
      caches.set(next, caches.get(path) ?? null); caches.delete(path);
    }
    vaultEvents.emit('rename', files.get(to) ?? { path: to }, from);
  };
  const update = (path: string, cache: NoteMetadata | null) => {
    caches.set(path, cache); cacheEvents.emit('changed', files.get(path));
  };
  const create = (path: string, cache: NoteMetadata | null = {}) => {
    files.set(path, file(path)); caches.set(path, cache); vaultEvents.emit('create', files.get(path));
  };
  const remove = (path: string) => {
    for (const id of [...files.keys()]) if (id === path || id.startsWith(`${path}/`)) { files.delete(id); caches.delete(id); }
    vaultEvents.emit('delete', { path });
  };
  return { indexer, graph, files, caches, vaultEvents, cacheEvents, getMarkdownFiles, getFileCache, rename, update, create, remove };
}

const parent = (link: string): NoteMetadata => ({links: [{link}]});
const flush = async () => { await vi.advanceTimersByTimeAsync(40); };
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

afterEach(() => { vi.useRealTimers(); });

describe('VaultIndexer', () => {
  it('reports readiness once the first full scan has been applied', () => {
    const ready = vi.fn();
    const { indexer, graph } = fixture({'A.md': null, 'B.md': parent('A')}, {onReady: ready});
    indexer.start();
    expect(ready).toHaveBeenCalledOnce();
    expect(graph.get('A.md')?.title).toBe('A');
    expect(graph.get('B.md')?.parents).toEqual(['/']);
    expect(graph.get('B.md')?.links).toEqual(['A.md']);
    // Readiness is reported once per start, so pruning never re-runs on every cache update.
    indexer.start();
    expect(ready).toHaveBeenCalledOnce();
  });
  it('scans metadata once at startup and refreshes only changed notes thereafter', async () => {
    const f = fixture({ 'A.md': parent('P'), 'P.md': {}, 'B.md': {} });
    const register = vi.fn();
    f.indexer.start(register); f.indexer.start(register);
    expect(f.getMarkdownFiles).toHaveBeenCalledTimes(1);
    expect(f.getFileCache).toHaveBeenCalledTimes(3);
    expect(register).toHaveBeenCalledTimes(6);
    f.getFileCache.mockClear();
    f.update('A.md', parent('B')); f.update('A.md', parent('B'));
    await flush();
    expect(f.graph.linked('A.md')).toEqual(['B.md']);
    expect(f.graph.children('P.md')).toEqual([]);
    expect(f.getFileCache).toHaveBeenCalledTimes(1);
    expect(f.getMarkdownFiles).toHaveBeenCalledTimes(1);
    f.indexer.stop();
    expect(f.vaultEvents.refs.size + f.cacheEvents.refs.size).toBe(0);
  });

  it('retains prior relationships on transient cache misses and retries waiting notes only', async () => {
    const f = fixture({ 'A.md': parent('P'), 'P.md': {}, 'Waiting.md': null });
    f.indexer.start(); f.getFileCache.mockClear();
    f.update('A.md', null); await flush();
    expect(f.graph.linked('A.md')).toEqual(['P.md']);
    f.caches.set('Waiting.md', parent('P')); f.caches.set('A.md', parent('P'));
    f.cacheEvents.emit('resolved'); await flush();
    expect(f.graph.linked('Waiting.md')).toEqual(['P.md']);
    expect(f.graph.get('Waiting.md')?.issues).toEqual([]);
    expect(f.getFileCache).toHaveBeenCalledTimes(3);
    expect(f.getMarkdownFiles).toHaveBeenCalledTimes(1);
    f.indexer.stop();
  });

  it('repairs unresolved links after creation and deletion without rereading unrelated notes', async () => {
    const f = fixture({ 'A.md': parent('New'), 'Unrelated.md': {} });
    f.indexer.start();
    expect(f.graph.linked('A.md')).toEqual([]);
    f.create('Folder/New.md'); await flush();
    expect(f.graph.linked('A.md')).toEqual(['Folder/New.md']);
    f.remove('Folder/New.md'); await flush();
    expect(f.graph.linked('A.md')).toEqual([]);
    expect(f.graph.linked('A.md')).toEqual([]);
    f.create('Folder/New.md'); await flush();
    expect(f.graph.linked('A.md')).toEqual(['Folder/New.md']);
    expect(f.getMarkdownFiles).toHaveBeenCalledTimes(1);
    expect(f.getFileCache.mock.calls.filter(([file]) => file.path === 'Unrelated.md')).toHaveLength(1);
    f.indexer.stop();
  });

  it('waits for rename repair before replacing old graph evidence or applying cache events', async () => {
    const wait = gate();
    const onRename = vi.fn(() => wait.promise);
    const f = fixture({ 'A.md': {}, 'Reference.md': parent('A'), 'Other.md': {} }, { onRename });
    f.indexer.start(); f.getFileCache.mockClear();
    f.rename('A.md', 'B.md'); await Promise.resolve();
    f.update('Reference.md', parent('B')); await flush();
    expect(f.graph.get('A.md')).toBeDefined();
    expect(f.graph.get('B.md')).toBeUndefined();
    expect(f.graph.linked('Reference.md')).toEqual(['A.md']);
    expect(f.getFileCache).not.toHaveBeenCalled();
    wait.release(); await flush();
    expect(f.graph.get('A.md')).toBeUndefined();
    expect(f.graph.linked('Reference.md')).toEqual(['B.md']);
    expect(f.getFileCache.mock.calls.map(([file]) => file.path).sort()).toEqual(['B.md', 'Reference.md']);
    f.indexer.stop();
  });

  it('serializes rapid consecutive renames with the preceding graph available to each callback', async () => {
    const wait = gate();
    const evidence: string[][] = [];
    let calls = 0;
    const f = fixture({ 'A.md': {}, 'Ref.md': parent('A') }, { onRename: async (from, to) => {
      evidence.push([from, to, ...f.graph.linked('Ref.md')]);
      if (++calls === 1) await wait.promise;
    } });
    f.indexer.start();
    f.rename('A.md', 'B.md'); f.rename('B.md', 'C.md');
    f.update('Ref.md', parent('C')); await flush();
    expect(evidence).toEqual([['A.md', 'B.md', 'A.md']]);
    wait.release(); await flush();
    expect(evidence).toEqual([['A.md', 'B.md', 'A.md'], ['B.md', 'C.md', 'B.md']]);
    expect(f.graph.linked('Ref.md')).toEqual(['C.md']);
    expect(f.graph.all().map(note => note.id).sort()).toEqual(['/', 'C.md', 'Ref.md']);
    f.indexer.stop();
  });

  it('replays folder deletion that arrived during an asynchronous rename', async () => {
    const wait = gate();
    const f = fixture({ 'A.md': {}, 'Folder/Child.md': {}, 'Ref.md': parent('Folder/Child') }, { onRename: () => wait.promise });
    f.indexer.start();
    f.rename('A.md', 'B.md'); f.remove('Folder'); await flush();
    expect(f.graph.get('Folder/Child.md')).toBeDefined();
    wait.release(); await flush(); await flush();
    expect(f.graph.get('Folder/Child.md')).toBeUndefined();
    expect(f.graph.linked('Ref.md')).toEqual([]);
    f.indexer.stop();
  });

  it('reports repair failure and continues accepting later rename events', async () => {
    const error = new Error('Concurrent property edit');
    const onError = vi.fn();
    const onRename = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const f = fixture({ 'A.md': {} }, { onRename, onError });
    f.indexer.start();
    f.rename('A.md', 'B.md'); await flush();
    f.rename('B.md', 'C.md'); await flush();
    expect(onError).toHaveBeenCalledWith(error);
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(f.graph.get('C.md')).toBeDefined();
    f.indexer.stop();
  });

  it('does not let an unfinished prior lifecycle block or mutate a restarted index', async () => {
    const wait = gate();
    const f = fixture({ 'A.md': {}, 'Removed.md': {} }, { onRename: () => wait.promise });
    f.indexer.start(); f.rename('A.md', 'B.md'); await Promise.resolve();
    f.indexer.stop(); f.remove('Removed.md');
    f.indexer.start();
    expect(f.graph.get('B.md')).toBeDefined();
    expect(f.graph.get('Removed.md')).toBeUndefined();
    f.update('B.md', { frontmatter: { 'brain-jumps': 'invalid' } }); await flush();
    expect(f.graph.get('B.md')?.issues).toHaveLength(0);
    wait.release(); await flush();
    expect(f.graph.get('A.md')).toBeUndefined();
    expect(f.graph.get('B.md')?.issues).toHaveLength(0);
    f.indexer.stop();
  });
});
