import {describe,it,expect,vi} from 'vitest';
import BrainPlugin from '../src/main';
import {loadBrainData} from '../src/settings';
import {TFile} from 'obsidian';
import {GraphIndex} from '../src/graph';

function fixture(folder='') {
  const files=new Map<string,unknown>();
  const plugin=Object.create(BrainPlugin.prototype) as BrainPlugin;
  plugin.data=loadBrainData({settings:{newNoteFolder:folder}});
  const create=vi.fn(async(path:string)=>{const file=new TFile();Object.assign(file,{path});files.set(path,file);return file;});
  const createFolder=vi.fn(async(path:string)=>{files.set(path,{});});
  Object.assign(plugin,{app:{workspace:{getLeavesOfType:()=>[]},vault:{configDir:'.obsidian',getAbstractFileByPath:(path:string)=>files.get(path),create,createFolder}},
    graph:new GraphIndex(),ensureReady:vi.fn(),indexer:{refresh:vi.fn(),settled:vi.fn(async()=>{})}});
  return {plugin,files,create,createFolder};
}
describe('plugin note creation',()=>{
  it('waits for migration before indexing and starts only once for concurrent readers', async () => {
    const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
    let release!: () => void;
    const ready = new Promise<void>(resolve => {release = resolve;});
    const start = vi.fn(); Object.assign(plugin, {ready, started: false, destroyed: false, indexer: {start}, registerEvent: vi.fn()});
    const first = plugin.ensureReady(), second = plugin.ensureReady();
    expect(start).not.toHaveBeenCalled(); release(); await Promise.all([first, second]);
    expect(start).toHaveBeenCalledOnce();
  });
  it('creates nested vault folders and indexes a new Markdown note',async()=>{
    const {plugin,create,createFolder}=fixture('知识/学习');
    await plugin.createNote('间隔重复');
    expect(createFolder.mock.calls).toEqual([['知识'],['知识/学习']]);
    expect(create).toHaveBeenCalledWith('知识/学习/间隔重复.md','');
    expect(plugin.indexer.refresh).toHaveBeenCalledWith('知识/学习/间隔重复.md');
  });
  it('rejects traversal and existing files without writes',async()=>{
    const {plugin,files,create}=fixture();files.set('已有.md',{});
    await expect(plugin.createNote('../escape')).rejects.toThrow();
    await expect(plugin.createNote('已有')).rejects.toThrow('同名');
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a folder outside the vault or the configuration directory',async()=>{
    for(const folder of ['../outside','.obsidian/plugins']) {
      const {plugin,create}=fixture(folder);await expect(plugin.createNote('note')).rejects.toThrow();expect(create).not.toHaveBeenCalled();
    }
  });
});

describe('global root persistence', () => {
  it('keeps the vault root fixed and redirects the legacy picker command', () => {
    const {plugin} = fixture(); const openBrain = vi.fn(async () => {}); Object.assign(plugin, {openBrain});
    plugin.setGlobalRoot('Root.md'); expect(plugin.data.globalRoot).toBe('/'); expect(openBrain).toHaveBeenCalledWith('/');
    expect(loadBrainData(JSON.parse(JSON.stringify(plugin.data))).globalRoot).toBe('/');
  });
  it.each([['Folder/Root.md', 'Folder/Renamed.md'], ['Folder', 'Moved']])('remaps the fixed root and shared positions on rename %s', async (from, to) => {
    const {plugin} = fixture();
    plugin.data.globalRoot = 'Folder/Root.md';
    plugin.data.mapLayout.nodes['Folder/Root.md'] = {x: 10, y: 20};
    Object.assign(plugin, {views: () => [], scheduleSave: vi.fn(), relations: {repairRename: vi.fn(async () => {})}});
    await (plugin as unknown as {onRename(from: string, to: string): Promise<void>}).onRename(from, to);
    const expected = from === 'Folder' ? 'Moved/Root.md' : 'Folder/Renamed.md';
    expect(plugin.data.globalRoot).toBe('/');
    expect(plugin.data.mapLayout.nodes[expected]).toEqual({x: 10, y: 20});
  });
});

 describe('note deletion', () => {
  it.each([false, true])('updates the graph only after trash succeeds (failure: %s)', async failed => {
    const {plugin, files} = fixture();
    const file = new TFile(); Object.assign(file, {path: 'Gone.md', extension: 'md'}); files.set(file.path, file);
    const graph = new GraphIndex([{id: file.path, title: 'Gone', parents: [], links: [], issues: []}]);
    const trashFile = vi.fn(async () => {if (failed) throw new Error('trash failed'); graph.remove(file.path);});
    Object.assign(plugin.app, {fileManager: {trashFile}});
    Object.assign(plugin, {graph, scheduleSave: vi.fn(), refreshViews: vi.fn()});
    plugin.data.globalRoot = '/';
    if (failed) await expect(plugin.deleteNote(file.path)).rejects.toThrow('trash failed');
    else await plugin.deleteNote(file.path);
    expect(trashFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(!!graph.get(file.path)).toBe(failed);
    expect(plugin.data.globalRoot).toBe('/');
  });
});
