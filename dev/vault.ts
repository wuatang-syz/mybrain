import {TFile, getFrontMatterInfo, parseYaml, type App, type TAbstractFile} from 'obsidian';
import {GraphIndex} from '../src/graph';
import {parentPath, renamePath} from '../src/graph/directory';
import {VaultIndexer} from '../src/obsidian/indexer';
import {DirectoryService} from '../src/obsidian/directory-service';

/** In-memory host adapter; previews use the production indexer and command service. */
export function previewVault(initial: Record<string, string | null>) {
  const files = new Map<string, TAbstractFile>(), contents = new Map<string, string>();
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (name: string, ...args: unknown[]) => {for (const cb of events.get(name) ?? []) cb(...args);};
  const on = (name: string, cb: (...args: unknown[]) => void) => {
    const set = events.get(name) ?? new Set(); set.add(cb); events.set(name, set); return {name, cb};
  };
  const offref = (ref: {name: string; cb: (...args: unknown[]) => void}) => events.get(ref.name)?.delete(ref.cb);
  const add = (path: string, content: string | null): TAbstractFile => {
    if (files.has(path)) throw new Error(`目标已存在：${path}`);
    const parent = parentPath(path); if (parent && !files.has(parent)) add(parent, null);
    const file = content === null ? {path, children: []} as unknown as TAbstractFile
      : Object.assign(new TFile(), {path, extension: 'md', basename: path.split('/').pop()!.replace(/\.md$/i, '')});
    files.set(path, file); if (content !== null) contents.set(path, content); emit('create', file); return file;
  };
  for (const [path, content] of Object.entries(initial)) add(path, content);
  const resolve = (link: string, source: string) => {
    const path = link.split('#')[0]!.split('|')[0]!, exact = path.endsWith('.md') ? path : path + '.md';
    return files.get(exact) ?? files.get(`${parentPath(source)}/${exact}`)
      ?? [...files.values()].find(file => file instanceof TFile && file.basename === path);
  };
  const app = {
    vault: {configDir: '.obsidian', on, offref, getName: () => '知识库', getAllLoadedFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile), getAbstractFileByPath: (path: string) => files.get(path),
      read: async (file: TFile) => contents.get(file.path)!,
      process: async (file: TFile, change: (text: string) => string) => {
        const content = change(contents.get(file.path)!); contents.set(file.path, content); emit('changed', file); return content;
      }, create: async (path: string, content: string) => add(path, content), createFolder: async (path: string) => add(path, null)},
    metadataCache: {on, offref, getFirstLinkpathDest: resolve, getFileCache: (file: TFile) => {
      const content = contents.get(file.path) ?? '', info = getFrontMatterInfo(content);
      const body = content.slice(info.contentStart).replace(/```[^]*?```/g, '').replace(/`[^`]*`/g, '');
      return {frontmatter: info.exists ? parseYaml(info.frontmatter) : {},
        links: [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => ({link: match[1]!}))};
    }},
    fileManager: {generateMarkdownLink: (file: TFile) => `[[${file.path.replace(/\.md$/i, '')}]]`,
      renameFile: async (file: TAbstractFile, to: string) => {
        const from = file.path;
        for (const [path, item] of [...files]) if (path === from || path.startsWith(from + '/')) {
          const target = renamePath(path, from, to); files.delete(path); item.path = target; files.set(target, item);
          if (contents.has(path)) {contents.set(target, contents.get(path)!); contents.delete(path);}
        }
        emit('rename', file, from);
      }, trashFile: async (file: TAbstractFile) => {files.delete(file.path); contents.delete(file.path); emit('delete', file);}},
  } as unknown as App;
  const graph = new GraphIndex(), indexer = new VaultIndexer(app, graph);
  const relations = new DirectoryService(app, graph, indexer); indexer.start();
  return {app, graph, indexer, relations, contents};
}
