// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {moveInOrder, orderedSnapshot, sameSortGroup, StructuralDrag} from '../src/ui/native-graph/sorting';
import {GraphIndex} from '../src/graph';
import {loadBrainData} from '../src/settings';
import {foldGroups} from '../src/ui/canvas/groups';

const snapshot = () => new GraphIndex(['Root', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => ({id, title: id,
  parents: id === 'Root' ? [] : ['Root'], links: [], issues: []}))).neighborhood('Root');

describe('structural ordering', () => {
  it('inserts nodes in either direction and keeps new notes and hidden group members', () => {
    expect(moveInOrder(['A', 'B', 'C'], 'A', 'C')).toEqual(['B', 'C', 'A']);
    expect(moveInOrder(['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'A', 'B']);
    const original = snapshot(), ordered = orderedSnapshot(original, ['G', 'B', 'A']);
    expect(ordered.nodes.slice(0, 3).map(n => n.id)).toEqual(['G', 'B', 'A']);
    expect(original.nodes.map(n => n.id)).not.toEqual(ordered.nodes.map(n => n.id));
    expect(foldGroups(ordered, new Set()).snapshot.nodes.some(n => n.id === 'G')).toBe(true);
    expect(foldGroups(ordered, new Set(['child:Root'])).snapshot.nodes).toEqual(ordered.nodes);
  });
  it('persists ordering separately from shared peripheral positions and sanitizes invalid data', () => {
    const data = loadBrainData({version: 4, layouts: {Root: {positions: {}, pinned: [], order: ['C', 'A', 'C', 42]}}});
    const state = loadBrainData(JSON.parse(JSON.stringify(data))).layouts.Root!;
    expect(state.order).toEqual(['C', 'A']);
  });
  it('does not allow reordering between relation zones or different sibling parents', () => {
    const s = snapshot(), a = s.nodes.find(n => n.id === 'A')!;
    expect(sameSortGroup(s, a, {...a, id: 'B'})).toBe(true);
    expect(sameSortGroup(s, a, {...a, zone: 'parent'})).toBe(false);
    expect(sameSortGroup(s, {...a, zone: 'focus'}, {...a, zone: 'focus'})).toBe(false);
    s.parents = [{id: 'P', title: 'P'}, {id: 'Q', title: 'Q'}];
    expect(sameSortGroup(s, {...a, zone: 'sibling', groupParents: ['P']}, {...a, zone: 'sibling', groupParents: ['Q']})).toBe(false);
  });
});

function fixture(scale = 1) {
  const s = snapshot(), element = document.createElement('canvas'); document.body.append(element);
  const positions = {Root: {x: 0, y: 0}, A: {x: 100, y: 100}, B: {x: 300, y: 100}};
  const finish = vi.fn(), click = vi.fn(), suppressClick = vi.fn(), preview = vi.fn(), lift = vi.fn();
  const focus = vi.fn();
  const sorter = new StructuralDrag({element, snapshot: () => s,
    nodes: () => new Map(s.nodes.filter(n => n.id === 'Root' || n.id === 'A' || n.id === 'B').map(n => [n.id, n])), positions: () => positions,
    world: event => ({x: event.clientX / scale, y: event.clientY / scale}), enabled: () => true,
    draw: vi.fn(), hint: vi.fn(), focus, finish, click, suppressClick, preview, lift});
  const pointer = (type: string, x: number, y: number, id = 1) => {
    const event = new MouseEvent(type, {clientX: x * scale, clientY: y * scale, button: 0, bubbles: true, cancelable: true});
    Object.defineProperty(event, 'pointerId', {value: id});
    (type === 'pointerdown' ? element : window).dispatchEvent(event);
  };
  return {sorter, pointer, positions, finish, click, suppressClick, focus, preview, lift, element, dispose: () => {sorter.destroy(); element.remove();}};
}
it('opens the pending slot with a lifted node while dragging and clears both on release or cancel', () => {
  const f = fixture();
  f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
  expect(f.preview).toHaveBeenLastCalledWith('A', 'B'); expect(f.lift).toHaveBeenLastCalledWith('A');
  f.pointer('pointerup', 300, 100);
  expect(f.preview).toHaveBeenLastCalledWith(); expect(f.lift).toHaveBeenLastCalledWith();
  const g = fixture();
  g.pointer('pointerdown', 100, 100); g.pointer('pointermove', -400, 520);
  expect(g.preview).toHaveBeenLastCalledWith('A', undefined); expect(g.finish).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  expect(g.preview).toHaveBeenLastCalledWith(); expect(g.lift).toHaveBeenLastCalledWith();
  expect(g.positions.A).toEqual({x: 100, y: 100}); g.dispose(); f.dispose();
});
it('commits a new order and restores automatic geometry instead of saving a free position', () => {
  const f = fixture(); f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
  expect(f.positions.A).toEqual({x: 300, y: 100});
  expect(f.sorter.savedPositions()?.A).toEqual({x: 100, y: 100});
  f.pointer('pointerup', 300, 100);
  expect(f.finish).toHaveBeenCalledExactlyOnceWith('A', 'B');
  expect(f.positions.A).toEqual({x: 100, y: 100}); expect(f.positions.B).toEqual({x: 300, y: 100});
  expect(f.sorter.savedPositions()).toBeUndefined(); expect(f.click).not.toHaveBeenCalled();
  expect(f.suppressClick).toHaveBeenCalled(); f.dispose();
});
it.each([.25, 1, 2])('uses the final release target while preserving geometry at scale %s', scale => {
  const f = fixture(scale);
  f.pointer('pointerdown', 108, 104); f.pointer('pointermove', -200, -150); f.pointer('pointerup', 300, 100);
  expect(f.positions.A).toEqual({x: 100, y: 100});
  expect(f.finish).toHaveBeenCalledExactlyOnceWith('A', 'B'); expect(f.click).not.toHaveBeenCalled(); f.dispose();
});
it.each(['blur', 'pointercancel', 'destroy'])('restores positions without saving on %s', action => {
  const f = fixture(); f.pointer('pointerdown', 100, 100); f.pointer('pointermove', -300, 400);
  if (action === 'destroy') f.sorter.destroy();
  else if (action === 'pointercancel') f.pointer(action, -300, 400);
  else window.dispatchEvent(new Event(action));
  f.pointer('pointerup', -300, 400);
  expect(f.positions.A).toEqual({x: 100, y: 100}); expect(f.finish).not.toHaveBeenCalled(); f.dispose();
});
it('ignores other pointers including cancellation, and preserves clicks below the drag threshold', () => {
  const f = fixture(); f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 102, 100);
  f.pointer('pointercancel', 300, 100, 2); f.pointer('pointerup', 300, 100, 2); f.pointer('pointerup', 102, 100);
  expect(f.click).toHaveBeenCalledExactlyOnceWith('A'); expect(f.finish).not.toHaveBeenCalled();
  expect(f.positions.A).toEqual({x: 100, y: 100}); f.dispose();
});
it('does not cancel when focusing the graph blurs a descendant canvas', () => {
  const f = fixture();
  f.focus.mockImplementation(() => f.element.dispatchEvent(new FocusEvent('blur')));
  f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100); f.pointer('pointerup', 300, 100);
  expect(f.finish).toHaveBeenCalledExactlyOnceWith('A', 'B'); expect(f.positions.A).toEqual({x: 100, y: 100});
  f.dispose();
});
it('does not reorder on blank space or the focus and keeps the center anchored', () => {
  const f = fixture();
  for (const target of [{x: -500, y: 400}, {x: 0, y: 0}]) {
    f.pointer('pointerdown', 100, 100); f.pointer('pointermove', target.x, target.y); f.pointer('pointerup', target.x, target.y);
    expect(f.positions.A).toEqual({x: 100, y: 100});
  }
  f.pointer('pointerdown', 0, 0); f.pointer('pointermove', 300, 100); f.pointer('pointerup', 300, 100);
  expect(f.positions.Root).toEqual({x: 0, y: 0}); expect(f.finish).not.toHaveBeenCalled(); f.dispose();
});
it('keeps clicks, excludes connector hits and cancels a drag with Escape', () => {
  const f = fixture(); f.pointer('pointerdown', 100, 100); f.pointer('pointerup', 100, 100);
  expect(f.click).toHaveBeenCalledExactlyOnceWith('A');
  f.pointer('pointerdown', 100, 76); f.pointer('pointermove', 300, 100); f.pointer('pointerup', 300, 100);
  expect(f.finish).not.toHaveBeenCalled();
  f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); f.pointer('pointerup', 300, 100);
  expect(f.finish).not.toHaveBeenCalled(); expect(f.positions.A).toEqual({x: 100, y: 100}); f.dispose();
});
