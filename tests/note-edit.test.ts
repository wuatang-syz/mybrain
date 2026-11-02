import {afterEach, describe, expect, it, vi} from 'vitest';
import {TFile, getFrontMatterInfo, parseYaml, type WorkspaceLeaf} from 'obsidian';
import BrainPlugin from '../src/main';
import {NewNoteModal} from '../src/ui/dialogs';
import type {NoteDetails} from '../src/ui/note-fields';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const file = Object.assign(new TFile(), {path: 'Note.md', basename: 'Note', parent: {path: '/'}});
  let content = '---\nbrain-parents: ["[[Root]]"]\ncustom: keep\ntags: [old]\n---\nOriginal';
  let save!: (name: string, details: NoteDetails) => Promise<void>;
  vi.spyOn(NewNoteModal.prototype, 'open').mockImplementation(function(this: NewNoteModal) {
    save = (this as unknown as {create: typeof save}).create;
  });
  const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
  const openNote = vi.spyOn(plugin, 'openNote').mockResolvedValue();
  const renameFile = vi.fn(async (_file: TFile, path: string) => {file.path = path;});
  Object.assign(plugin, {graph: {get: () => undefined, all: () => []}, app: {vault: {
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    read: async () => content,
    process: async (_file: TFile, update: (text: string) => string) => {content = update(content);},
  }, fileManager: {renameFile}}, indexer: {refresh: vi.fn()}, refreshViews: vi.fn()});
  return {plugin, file, renameFile, openNote, save: (name: string, details: NoteDetails) => save(name, details), read: () => content, change: (text: string) => {content = text;}};
}
describe('note editor persistence', () => {
  it('loads the edited note into the same graph companion before opening its editor', async () => {
    const f = fixture(), source = {} as WorkspaceLeaf;
    await f.plugin.editNote('Note.md', source);
    expect(f.openNote).toHaveBeenCalledExactlyOnceWith('Note.md', source);
    expect(NewNoteModal.prototype.open).toHaveBeenCalledOnce();
  });
  it('saves metadata and body while preserving relationship and custom properties', async () => {
    const f = fixture(); await f.plugin.editNote('Note.md');
    await f.save('Renamed', {icon: '📚', tags: ['学习'], body: 'Updated'});
    const info = getFrontMatterInfo(f.read());
    expect(parseYaml(info.frontmatter)).toEqual({'brain-parents': ['[[Root]]'], custom: 'keep', icon: '📚', tags: ['学习']});
    expect(f.read().slice(info.contentStart)).toBe('Updated');
    expect(f.renameFile).toHaveBeenCalledWith(f.file, 'Renamed.md');
  });
  it('rejects stale edits without overwriting newer content or renaming', async () => {
    const f = fixture(); await f.plugin.editNote('Note.md'); f.change('Changed elsewhere');
    await expect(f.save('Renamed', {icon: '', tags: [], body: 'Stale'})).rejects.toThrow('其他位置修改');
    expect(f.read()).toBe('Changed elsewhere'); expect(f.renameFile).not.toHaveBeenCalled();
  });
});
