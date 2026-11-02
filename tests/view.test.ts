import {describe, expect, it, vi} from 'vitest';
import {GraphIndex} from '../src/graph';
import {BrainView} from '../src/ui/view';

describe('creation navigation', () => {
  it.each([true, false])('centers the drag source only when the relationship succeeds (%s)', async success => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const focus = vi.fn();
    const apply = vi.fn(async () => success);
    Object.assign(view, {brain: {createNote: vi.fn(async () => ({path: 'New.md'})), report: vi.fn()}, apply, focus});
    const internal = view as unknown as {createFrom(source: string, kind: 'child', request: {existing: string}): Promise<void>};
    await internal.createFrom('Source.md', 'child', {existing: 'New.md'});
    expect(apply).toHaveBeenCalledWith({focus: 'Source.md', target: 'New.md', kind: 'child'});
    if (success) expect(focus).toHaveBeenCalledExactlyOnceWith('Source.md');
    else expect(focus).not.toHaveBeenCalled();
  });
  it('focuses a newly created standalone note so it remains visible', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const focus = vi.fn(), select = vi.fn(), render = vi.fn();
    Object.assign(view, {brain: {graph: new GraphIndex()}, focusId: 'Current.md', focus, render, canvas: {select}});
    view.selectNote('New.md');
    expect(focus).toHaveBeenCalledWith('New.md', false);
    expect(render).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith('New.md');
  });
});

 describe('outer navigation', () => {
  it('opens a visible or overflow outer note instead of replacing the center', () => {
    for (const field of ['nodes', 'overflow']) {
      const view = Object.create(BrainView.prototype) as BrainView;
      const openNote = vi.fn(async () => undefined), captureLayout = vi.fn();
      const source = {};
      Object.assign(view, {leaf: source, focusId: 'Center.md', neighborhood: {[field]: [{id: 'Outer.md', zone: 'outer'}]}, brain: {openNote, graph: new GraphIndex()}, captureLayout});
      view.focus('Outer.md');
      expect(openNote).toHaveBeenCalledExactlyOnceWith('Outer.md', source);
      expect(captureLayout).not.toHaveBeenCalled();
    }
  });
});

 it('does not reopen an outer note while following file-open events', () => {
  const view = Object.create(BrainView.prototype) as BrainView;
  const openNote = vi.fn(async () => undefined);
  Object.assign(view, {focusId: 'Center.md', neighborhood: {nodes: [{id: 'Outer.md', zone: 'outer'}]}, brain: {openNote, graph: new GraphIndex()}});
  view.focus('Outer.md', false);
  expect(openNote).not.toHaveBeenCalled();
 });
