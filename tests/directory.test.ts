import {afterEach, describe, expect, it, vi} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {TFile, getFrontMatterInfo, parseYaml, stringifyYaml, type App, type TAbstractFile} from 'obsidian';
import {GraphIndex} from '../src/graph';
import {directoryRecords, parentPath, VAULT_ROOT} from '../src/graph/directory';
import {VaultIndexer} from '../src/obsidian/indexer';
import {DirectoryService} from '../src/obsidian/directory-service';
import {isolatedNotes} from '../src/ui/statistics';
import {rootPaths} from '../src/ui/navigation';
import {directoryGraphData} from '../src/ui/native-graph/data';
import {knowledgeMap} from '../src/graph/knowledge-map';
import {buildKnowledgeSnapshot} from '../src/world/snapshot';

const diskSamples: string[] = [];
function sample(initial: Record<string, string | null>, disk?: string) {
  type File = TAbstractFile & {children?: File[]};
  const files = new Map<string, File>(), contents = new Map<string, string>();
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = (name: string, callback: (...args: unknown[]) => void) => {
    const set = events.get(name) ?? new Set(); set.add(callback); events.set(name, set); return {name, callback};
  };
  const emit = (name: string, ...args: unknown[]) => {for (const callback of events.get(name) ?? []) callback(...args);};
  const offref = (ref: {name: string; callback: (...args: unknown[]) => void}) => events.get(ref.name)?.delete(ref.callback);
  const metadata = (file: TFile) => {
    const text = contents.get(file.path) ?? '', info = getFrontMatterInfo(text);
    const props = info.exists ? parseYaml(info.frontmatter) as Record<string, unknown> : {};
    return {frontmatter: props, links: [...text.slice(info.contentStart).matchAll(/\[\[([^\]]+)\]\]/g)].map(match => ({link: match[1]!}))};
  };
  const resolve = (link: string) => {
    const stem = link.split('#')[0]!.split('|')[0]!, exact = files.get(stem.endsWith('.md') ? stem : stem + '.md');
    return exact instanceof TFile ? exact : [...files.values()].find(file => file instanceof TFile && file.path.split('/').pop() === stem.replace(/\.md$/, '') + '.md') ?? null;
  };
  const children = () => {for (const file of files.values()) if (file.children) file.children = [...files.values()].filter(other => other !== file && (parentPath(other.path) || '/') === file.path);};
  const add = (path: string, content: string | null): File => {
    if (files.has(path)) throw new Error(`exists: ${path}`);
    const folder = parentPath(path); if (folder && !files.has(folder)) add(folder, null);
    const file = content === null ? {path, name: path.split('/').pop(), children: []} as unknown as File
      : Object.assign(new TFile(), {path, extension: path.split('.').pop(), basename: path.split('/').pop()!.replace(/\.md$/, '')});
    if (disk) {if (content === null) mkdirSync(join(disk, path)); else writeFileSync(join(disk, path), content);}
    files.set(path, file); if (content !== null) contents.set(path, content); children(); emit('create', file); return file;
  };
  files.set('/', {path: '/', children: []} as unknown as File);
  for (const [path, content] of Object.entries(initial)) add(path, content);
  const rename = vi.fn(async (file: File, to: string) => {
    if (files.has(to)) throw new Error('exists');
    const from = file.path;
    if (disk) renameSync(join(disk, from), join(disk, to));
    for (const [path, child] of [...files]) if (path === from || path.startsWith(from + '/')) {
      const target = to + path.slice(from.length); files.delete(path); child.path = target; files.set(target, child);
      if (contents.has(path)) {contents.set(target, contents.get(path)!); contents.delete(path);}
      if (child instanceof TFile) child.basename = target.split('/').pop()!.replace(/\.md$/, '');
    }
    children(); emit('rename', file, from);
  });
  const app = {vault: {configDir: '.obsidian', on, offref, getName: () => '示例知识库', getAllLoadedFiles: () => [...files.values()],
    getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile && file.extension === 'md'),
    getAbstractFileByPath: (path: string) => files.get(path), read: async (file: TFile) => disk ? readFileSync(join(disk, file.path), 'utf8') : contents.get(file.path)!,
    process: async (file: TFile, change: (text: string) => string) => {
      const next = change(contents.get(file.path)!); contents.set(file.path, next);
      if (disk) writeFileSync(join(disk, file.path), next); emit('changed', file); return next;
    }, createFolder: async (path: string) => add(path, null), create: async (path: string, content: string) => add(path, content)},
  metadataCache: {on, offref, getFileCache: metadata, getFirstLinkpathDest: resolve},
  fileManager: {generateMarkdownLink: (file: TFile) => '[[' + file.path.replace(/\.md$/i, '') + ']]', renameFile: rename, trashFile: async (file: File) => {
    if (file.children?.length) throw new Error('not empty');
    if (disk) {mkdirSync(join(disk, '.trash'), {recursive: true}); renameSync(join(disk, file.path), join(disk, '.trash', String(Date.now()) + '-' + files.size));}
    files.delete(file.path); contents.delete(file.path); children(); emit('delete', file);
  }, processFrontMatter: async (file: TFile, change: (data: Record<string, unknown>) => void) => {
    const text = contents.get(file.path)!, info = getFrontMatterInfo(text), data = info.exists ? parseYaml(info.frontmatter) as Record<string, unknown> : {};
    change(data); contents.set(file.path, `---\n${stringifyYaml(data)}---\n${text.slice(info.contentStart)}`); if (disk) writeFileSync(join(disk, file.path), contents.get(file.path)!); emit('changed', file);
  }}} as unknown as App;
  const graph = new GraphIndex();
  const indexer: VaultIndexer = new VaultIndexer(app, graph);
  const service = new DirectoryService(app, graph, indexer); indexer.start();
  return {app, files, contents, graph, indexer, service, rename, add, emit};
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of diskSamples.splice(0)) {
    const absolute = resolve(folder), allowed = resolve(tmpdir()) + sep + 'mybrain-directory-';
    if (!absolute.startsWith(allowed)) throw new Error('Unsafe sample cleanup path');
    rmSync(absolute, {recursive: true});
  }
});

describe('directory projection', () => {
  it('keeps empty folders and same-name notes separate, with exact file link identities', () => {
    const f=sample({'Empty':null,'Topic/Topic.md':'[[Topic/Child]]','Topic/Child.md':'[[Topic/Topic]]','Ref.md':'[[Topic/Topic]]','asset.pdf':'asset'});
    expect(f.graph.get('Topic')).toMatchObject({kind:'folder',links:[]});
    expect(f.graph.get('Topic/Topic.md')).toMatchObject({kind:'note',notePath:'Topic/Topic.md'});
    expect(f.graph.linked('Topic/Child.md')).toEqual(['Topic/Topic.md']);
    expect(f.graph.linked('Ref.md')).toEqual(['Topic/Topic.md']);
    expect(f.graph.get('Empty')).toBeDefined();expect(f.graph.get('asset.pdf')).toBeUndefined();
    expect(rootPaths(f.graph,'/').get('Topic/Child.md')).toEqual(['/','Topic','Topic/Child.md']);
    expect(directoryGraphData(f.graph).nodes['Topic/Child.md']!.links['Topic/Topic.md']).toBe(true);
    const map=knowledgeMap(f.graph,{root:'/',attention:'/'});
    expect(map.cards.find(c=>c.id==='Topic')!.members).toEqual(['Topic/Child.md','Topic/Topic.md']);
    expect(buildKnowledgeSnapshot(f.graph,{root:'/',attention:'/'}).snapshot.relations.filter(e=>e.kind==='jump')).toHaveLength(2);
    expect(isolatedNotes(f.graph)).toEqual([]);f.indexer.stop();
  });
  it('counts notes as isolated even when they have directory parents', () => {
    const f=sample({'A/A.md':'','A/B.md':'','Loose.md':''});
    expect(isolatedNotes(f.graph).map(n=>n.id).sort()).toEqual(['A/A.md','A/B.md','Loose.md']);
    expect(directoryRecords('空库',[],[])).toHaveLength(1);f.indexer.stop();
  });
});

describe('directory commands and history', () => {
  it('moves real files with attachments and undoes/redoes without changing content', async () => {
    const disk=mkdtempSync(join(tmpdir(),'mybrain-directory-'));diskSamples.push(disk);
    const f=sample({'项目/项目.md':'实际正文','项目/asset.pdf':'asset','Archive':null},disk);
    await f.service.createRelative('项目','child','任务','任务正文');
    await f.service.move('项目','Archive');
    expect(readFileSync(join(disk,'Archive/项目/任务.md'),'utf8')).toBe('任务正文');
    expect(readFileSync(join(disk,'Archive/项目/asset.pdf'),'utf8')).toBe('asset');
    await f.service.undo();await f.service.undo();
    expect(readFileSync(join(disk,'项目/项目.md'),'utf8')).toBe('实际正文');
    expect(existsSync(join(disk,'项目/任务.md'))).toBe(false);
    await f.service.redo();await f.service.redo();
    expect(readFileSync(join(disk,'Archive/项目/任务.md'),'utf8')).toBe('任务正文');f.indexer.stop();
  });
  it('rejects note children and note parents without auto-creating folders', async () => {
    const f=sample({'A.md':'a','B.md':'b'});
    await expect(f.service.createRelative('A.md','child','B','')).rejects.toThrow('只有文件夹');
    await expect(f.service.apply({focus:'A.md',target:'B.md',kind:'parent'})).rejects.toThrow('只有文件夹');
    await expect(f.service.createFolder('A.md','Sub')).rejects.toThrow('只有文件夹');
    expect(f.files.has('A')).toBe(false);expect(f.rename).not.toHaveBeenCalled();f.indexer.stop();
  });
  it('creates a parent directory and restores it through multiple undo/redo cycles', async () => {
    const f=sample({'A.md':'a'});
    await f.service.createRelative('A.md','parent','Parent','');
    expect(f.contents.get('Parent/A.md')).toBe('a');
    for(let i=0;i<2;i++){await f.service.undo();expect(f.contents.get('A.md')).toBe('a');await f.service.redo();}
    expect(f.graph.parents('Parent/A.md')).toEqual(['Parent']);f.indexer.stop();
  });
  it('preflights duplicates, self moves, descendants and the vault root', async () => {
    const f=sample({'A.md':'a','B/A.md':'b','B/Sub':null});
    await expect(f.service.move('A.md','B')).rejects.toThrow('目标已存在');
    await expect(f.service.move('B','B/Sub')).rejects.toThrow('自身');
    await expect(f.service.move(VAULT_ROOT,'B')).rejects.toThrow('根节点');
    expect(f.rename).not.toHaveBeenCalled();f.indexer.stop();
  });
  it('rolls back creating a parent when its file move fails', async () => {
    const f=sample({'A.md':'a'});f.rename.mockRejectedValueOnce(new Error('disk failure'));
    await expect(f.service.createRelative('A.md','parent','Parent','')).rejects.toThrow('disk failure');
    expect(f.files.has('Parent')).toBe(false);expect(f.contents.get('A.md')).toBe('a');expect(f.service.canUndo).toBe(false);f.indexer.stop();
  });
  it('does not remove external additions when undoing a created folder', async () => {
    const f=sample({'A.md':'a'});await f.service.createRelative('A.md','parent','Parent','');f.add('Parent/other.pdf','external');
    await expect(f.service.undo()).rejects.toThrow('其他内容');
    expect(f.contents.get('Parent/A.md')).toBe('a');expect(f.contents.get('Parent/other.pdf')).toBe('external');f.indexer.stop();
  });
  it('rebinds created note identities through move and creation histories', async () => {
    const f=sample({'A':null,'B':null});await f.service.createRelative('A','child','New','body');await f.service.move('A/New.md','B');
    for(let i=0;i<2;i++){await f.service.undo();await f.service.undo();await f.service.redo();await f.service.redo();}
    expect(f.contents.get('B/New.md')).toBe('body');f.indexer.stop();
  });
  it('refuses to undo an edited or externally replaced created note', async () => {
    const f=sample({'A':null});await f.service.createRelative('A','child','New','body');
    f.contents.set('A/New.md','edited');await expect(f.service.undo()).rejects.toThrow('已被编辑');
    await f.app.fileManager.trashFile(f.files.get('A/New.md')!);f.add('A/New.md','body');await f.indexer.settled();
    await expect(f.service.undo()).rejects.toThrow('外部替换');expect(f.contents.get('A/New.md')).toBe('body');f.indexer.stop();
  });
});

describe('native link commands', () => {
  it('deduplicates recent committed links while native metadata is catching up', async () => {
    const f=sample({'A.md':'a','B.md':'b'});
    await f.service.apply({focus:'A.md',target:'B.md',kind:'jump'});
    const content=f.contents.get('A.md');
    vi.spyOn(f.app.metadataCache,'getFileCache').mockReturnValue({});
    f.indexer.refresh('A.md'); expect(f.graph.linked('A.md')).toEqual([]);
    expect(await f.service.apply({focus:'B.md',target:'A.md',kind:'jump'})).toBe(false);
    expect(f.contents.get('A.md')).toBe(content); f.indexer.stop();
  });
  it('refuses to undo a link on an externally replaced source file', async () => {
    const f=sample({'A.md':'a','B.md':'b'});
    await f.service.apply({focus:'A.md',target:'B.md',kind:'jump'});
    const content=f.contents.get('A.md')!;
    await f.app.fileManager.trashFile(f.files.get('A.md')!);f.add('A.md',content);
    await expect(f.service.undo()).rejects.toThrow('外部替换');
    expect(f.contents.get('A.md')).toBe(content);f.indexer.stop();
  });
  it('appends body links, leaves properties untouched, and shares undo history with directory moves', async () => {
    const original='---\nicon: 💡\n---\noriginal';
    const f=sample({'A.md':original,'B.md':'b','Folder':null});
    await f.service.apply({focus:'A.md',target:'B.md',kind:'jump'});
    expect(f.contents.get('A.md')).toBe(original+'\n\n[[B]]\n');expect(f.graph.linked('B.md')).toEqual(['A.md']);
    expect(await f.service.apply({focus:'B.md',target:'A.md',kind:'jump'})).toBe(false);
    await f.service.move('A.md','Folder');await f.service.undo();await f.service.undo();
    expect(f.contents.get('A.md')).toBe(original);
    await f.service.redo();expect(f.graph.linked('A.md')).toEqual(['B.md']);f.indexer.stop();
  });
  it('preserves a native directory relationship while adding a jump to a sibling', async () => {
    const f=sample({'A/B.md':'b','A/C.md':'c'});await f.service.apply({focus:'A/B.md',target:'A/C.md',kind:'jump'});
    expect(f.graph.parents('A/B.md')).toEqual(['A']);expect(f.graph.parents('A/C.md')).toEqual(['A']);
    expect(f.graph.linked('A/B.md')).toEqual(['A/C.md']);f.indexer.stop();
  });
  it('creates a jump note and reverses both the file and link as one operation', async () => {
    const f=sample({'A.md':'a'});await f.service.createRelative('A.md','jump','B','b');
    expect(f.graph.linked('A.md')).toEqual(['B.md']);await f.service.undo();
    expect(f.contents.get('A.md')).toBe('a');expect(f.files.has('B.md')).toBe(false);
    await f.service.redo();expect(f.graph.linked('A.md')).toEqual(['B.md']);f.indexer.stop();
  });
  it('rolls back a newly created jump note when writing the source fails', async () => {
    const f=sample({'A.md':'a'});vi.spyOn(f.app.vault,'process').mockRejectedValueOnce(new Error('write failed'));
    await expect(f.service.createRelative('A.md','jump','B','b')).rejects.toThrow('write failed');
    expect(f.files.has('B.md')).toBe(false);expect(f.contents.get('A.md')).toBe('a');expect(f.service.canUndo).toBe(false);f.indexer.stop();
  });
  it('preserves concurrent external content on undo conflicts', async () => {
    const f=sample({'A.md':'a','B.md':'b'});await f.service.apply({focus:'A.md',target:'B.md',kind:'jump'});
    f.contents.set('A.md','external');await expect(f.service.undo()).rejects.toThrow('外部修改');
    expect(f.contents.get('A.md')).toBe('external');expect(f.service.canUndo).toBe(true);f.indexer.stop();
  });
});
