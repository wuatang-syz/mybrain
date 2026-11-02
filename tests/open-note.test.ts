import {describe, expect, it, vi} from 'vitest';
import {TFile} from 'obsidian';
import {GraphIndex} from '../src/graph';
import BrainPlugin from '../src/main';

describe('opening an existing note', () => {
  it('reveals an existing tab without opening, unpinning, or splitting it', async () => {
    const file = Object.assign(new TFile(), {path: 'Note.md'});
    const leaf = {getViewState: () => ({state: {file: 'Note.md'}}), openFile: vi.fn(), setPinned: vi.fn()};
    const workspace = {getLeavesOfType: () => [leaf], revealLeaf: vi.fn(async () => {}), getLeaf: vi.fn(), createLeafBySplit: vi.fn()};
    const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
    Object.assign(plugin, {graph: new GraphIndex(), app: {vault: {getAbstractFileByPath: () => file}, workspace}});
    await plugin.openNote('Note.md');
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    expect(leaf.openFile).not.toHaveBeenCalled(); expect(leaf.setPinned).not.toHaveBeenCalled();
    expect(workspace.getLeaf).not.toHaveBeenCalled(); expect(workspace.createLeafBySplit).not.toHaveBeenCalled();
  });
  it('coalesces repeated clicks while opening a note', async () => {
    let finish!: () => void;
    const file = Object.assign(new TFile(), {path: 'Note.md'});
    const leaf = {getViewState: () => ({type:'empty'}), openFile: vi.fn(() => new Promise<void>(resolve => {finish = resolve;})), setPinned: vi.fn(), view: {containerEl: {closest: () => null}}};
    const workspace = {getLeavesOfType: () => [], revealLeaf: vi.fn(async () => {}), getLeaf: vi.fn(() => leaf)};
    const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
    Object.assign(plugin, {graph: new GraphIndex(), views: () => [], app: {vault: {getAbstractFileByPath: () => file}, workspace}});
    const first = plugin.openNote('Note.md'), second = plugin.openNote('Note.md');
    await Promise.resolve();
    expect(workspace.getLeaf).toHaveBeenCalledOnce(); expect(leaf.openFile).toHaveBeenCalledOnce();
    finish(); await Promise.all([first, second]);
  });
});
