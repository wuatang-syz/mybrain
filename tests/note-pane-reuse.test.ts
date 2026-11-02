import {describe, expect, it, vi} from 'vitest';
import {TFile, type WorkspaceLeaf} from 'obsidian';
import BrainPlugin from '../src/main';
import {GraphIndex} from '../src/graph';

interface Group {
  parent: {children: Group[]; recomputeChildrenDimensions(): void};
  width: number;
  setDimension(percent: number): void;
  activeLeaf?: WorkspaceLeaf;
}
function makeLeaf(parent: Group, type = 'empty', file?: string) {
  const state = {type, file, pinned: false};
  return {parent, state, getViewState: () => ({type: state.type, pinned: state.pinned, state: {file: state.file}}),
    setPinned: vi.fn((value: boolean) => {state.pinned = value;}),
    openFile: vi.fn(async (note: TFile) => {state.type = 'markdown'; state.file = note.path;}),
    view: {containerEl: {closest: () => null}}};
}
function fixture(rightType?: 'markdown' | 'empty') {
  const root = {children: [] as Group[], recomputeChildrenDimensions: vi.fn()};
  const group = () => {
    const item: Group = {parent: root, width: 50, setDimension: vi.fn((value: number) => {item.width = value;})};
    return item;
  };
  const left = group();root.children.push(left);
  const source = makeLeaf(left, 'obsidian-brain-view');
  const sourceLeaf = source as unknown as WorkspaceLeaf;
  const leaves: WorkspaceLeaf[] = [sourceLeaf];
  const makeRight = (type: 'markdown' | 'empty' = 'empty') => {
    const tabs = group();root.children.push(tabs);
    const note = makeLeaf(tabs, type, type === 'markdown' ? 'C.md' : undefined);
    const leaf = note as unknown as WorkspaceLeaf;tabs.activeLeaf = leaf;leaves.push(leaf);
    return note;
  };
  const right = rightType ? makeRight(rightType) : undefined;
  const workspace = {
    getLeavesOfType: vi.fn((type: string) => leaves.filter(leaf => leaf.getViewState().type === type)),
    iterateRootLeaves: (visit: (leaf: WorkspaceLeaf) => void) => {for (const leaf of [...leaves]) visit(leaf);},
    createLeafBySplit: vi.fn(() => makeRight() as unknown as WorkspaceLeaf),
    getLeaf: vi.fn(), revealLeaf: vi.fn(async () => {}),
  };
  const files = new Map(['A.md', 'B.md', 'C.md'].map(path => [path, Object.assign(new TFile(), {path})]));
  const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
  Object.assign(plugin, {graph: new GraphIndex(), app: {workspace, vault: {getAbstractFileByPath: (path: string) => files.get(path)}}});
  return {plugin, root, left, sourceLeaf, leaves, right, makeRight, workspace, files};
}

describe('one companion note per graph', () => {
  it('reuses the existing right editor after reload even if the requested note is already open elsewhere', async () => {
    const f = fixture('markdown'), elsewhere = makeLeaf(f.left, 'markdown', 'A.md');
    f.leaves.push(elsewhere as unknown as WorkspaceLeaf);
    await f.plugin.openNote('A.md', f.sourceLeaf);
    expect(f.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(f.right!.state.file).toBe('A.md');
    expect(f.workspace.revealLeaf).toHaveBeenCalledWith(f.right);
    expect(elsewhere.openFile).not.toHaveBeenCalled();expect(elsewhere.setPinned).not.toHaveBeenCalled();
    expect(f.left.width).toBe(60);expect(f.right!.parent.width).toBe(40);
    await f.plugin.openNote('B.md', f.sourceLeaf);
    expect(f.right!.state.file).toBe('B.md');expect(f.root.children).toHaveLength(2);
  });
  it('creates one split for rapid graph and world requests and keeps the manual ratio afterward', async () => {
    const f = fixture();
    await Promise.all([f.plugin.openNote('A.md', f.sourceLeaf), f.plugin.openMapNote('B.md', f.sourceLeaf)]);
    expect(f.workspace.createLeafBySplit).toHaveBeenCalledOnce();
    expect(f.root.children).toHaveLength(2);expect(f.leaves).toHaveLength(2);
    const right = f.leaves[1]! as unknown as ReturnType<typeof makeLeaf>;
    expect(right.openFile.mock.calls.map(([file]) => file.path)).toEqual(['A.md', 'B.md']);
    expect(f.left.width).toBe(60);expect(right.parent.width).toBe(40);
    f.left.width = 55;right.parent.width = 45;
    await f.plugin.openNote('C.md', f.sourceLeaf);
    expect(f.left.width).toBe(55);expect(right.parent.width).toBe(45);
    expect(f.left.setDimension).toHaveBeenCalledOnce();
  });
  it('reuses an empty right pane instead of creating a third pane', async () => {
    const f = fixture('empty');await f.plugin.openNote('A.md', f.sourceLeaf);
    expect(f.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(f.right!.state.file).toBe('A.md');expect(f.root.children).toHaveLength(2);
  });
  it('reuses a pinned companion rather than multiplying tabs', async () => {
    const f = fixture('markdown');f.right!.state.pinned = true;
    await f.plugin.openNote('A.md', f.sourceLeaf);
    expect(f.right!.state.pinned).toBe(false);expect(f.right!.state.file).toBe('A.md');
    expect(f.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });
  it('does not reopen the same note or reset its editor when clicked repeatedly', async () => {
    const f = fixture('markdown');
    await Promise.all([f.plugin.openNote('A.md', f.sourceLeaf), f.plugin.openNote('A.md', f.sourceLeaf)]);
    await f.plugin.openNote('A.md', f.sourceLeaf);
    expect(f.right!.openFile).toHaveBeenCalledOnce();
    expect(f.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });
  it('preserves the final choice in an A → B → A burst', async () => {
    const f = fixture('markdown');
    await Promise.all([f.plugin.openNote('A.md', f.sourceLeaf), f.plugin.openNote('B.md', f.sourceLeaf), f.plugin.openNote('A.md', f.sourceLeaf)]);
    expect(f.right!.openFile.mock.calls.map(([file]) => file.path)).toEqual(['A.md', 'B.md', 'A.md']);
    expect(f.right!.state.file).toBe('A.md');
  });
  it('waits for the previous file to finish loading before opening the next', async () => {
    const f = fixture('markdown');let finish!: () => void;
    const normal = f.right!.openFile.getMockImplementation()!;
    f.right!.openFile.mockImplementationOnce(async file => {await new Promise<void>(resolve => {finish = resolve;});await normal(file);});
    const a = f.plugin.openNote('A.md', f.sourceLeaf), b = f.plugin.openNote('B.md', f.sourceLeaf);
    await Promise.resolve();expect(f.right!.openFile).toHaveBeenCalledOnce();
    finish();await Promise.all([a, b]);expect(f.right!.state.file).toBe('B.md');
  });
  it('recreates a closed companion once and never overwrites a companion moved into the graph tab group', async () => {
    const f = fixture('markdown');await f.plugin.openNote('A.md', f.sourceLeaf);
    f.right!.parent = f.left;f.root.children.splice(1);
    await f.plugin.openNote('B.md', f.sourceLeaf);
    expect(f.workspace.createLeafBySplit).toHaveBeenCalledOnce();
    expect(f.right!.state.file).toBe('A.md');expect(f.root.children).toHaveLength(2);
    const newRight = f.leaves[f.leaves.length-1]!;
    f.leaves.splice(f.leaves.indexOf(newRight), 1);f.root.children.splice(1);
    await f.plugin.openNote('C.md', f.sourceLeaf);
    expect(f.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);expect(f.root.children).toHaveLength(2);
  });
  it('continues after an open failure without creating another split', async () => {
    const f = fixture('markdown');f.right!.openFile.mockRejectedValueOnce(new Error('File load failed'));
    const result = await Promise.allSettled([f.plugin.openNote('A.md', f.sourceLeaf), f.plugin.openNote('B.md', f.sourceLeaf)]);
    expect(result.map(item=>item.status)).toEqual(['rejected','fulfilled']);
    expect(f.right!.state.file).toBe('B.md');expect(f.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });
  it('drops queued opens after their graph has been closed', async () => {
    const f = fixture();const opening = f.plugin.openNote('A.md', f.sourceLeaf);
    f.leaves.splice(f.leaves.indexOf(f.sourceLeaf),1);await opening;
    expect(f.workspace.createLeafBySplit).not.toHaveBeenCalled();expect(f.workspace.revealLeaf).not.toHaveBeenCalled();
  });
});
