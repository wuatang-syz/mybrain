import type {WorkspaceLeaf} from 'obsidian';

interface SplitItem {
  parent?: {children: SplitItem[]; recomputeChildrenDimensions?(): void};
  activeLeaf?: WorkspaceLeaf;
  setDimension?(percent: number): void;
}
export function findCompanionNote(source: WorkspaceLeaf, leaves: WorkspaceLeaf[], preferred?: WorkspaceLeaf): WorkspaceLeaf | undefined {
  const left = (source as unknown as {parent?: SplitItem}).parent;
  const siblings = left?.parent?.children;
  if (!left || !siblings) return;
  const index = siblings.indexOf(left);
  if (index < 0) return;
  const right = siblings[index + 1];
  if (!right) return;
  const candidates = leaves.filter(leaf => (leaf as unknown as {parent?: SplitItem}).parent === right);
  if (preferred && candidates.includes(preferred)) return preferred;
  const editable = candidates.filter(leaf => ['markdown', 'empty'].includes(leaf.getViewState().type ?? 'markdown'));
  const pool = editable.length ? editable : candidates;
  return pool.find(leaf => leaf === right.activeLeaf) ?? pool.find(leaf => !leaf.getViewState().pinned) ?? pool[0];
}
/** Guarded native split API: initialize once, never override a later user resize. */
export function initializeNoteSplit(source: WorkspaceLeaf, note: WorkspaceLeaf): boolean {
  const left = (source as unknown as {parent?: SplitItem}).parent;
  const right = (note as unknown as {parent?: SplitItem}).parent;
  if (!left || !right || left === right || left.parent !== right.parent || left.parent?.children.length !== 2) return false;
  if (!left.setDimension || !right.setDimension) return false;
  left.setDimension(60); right.setDimension(40); left.parent.recomputeChildrenDimensions?.();
  return true;
}
