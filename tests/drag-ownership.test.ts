// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {isolateStructuralDrag} from '../src/ui/native-graph/drag-ownership';
import {StructuralDrag} from '../src/ui/native-graph/sorting';
import {GraphIndex} from '../src/graph';
import type {NativeNode, NativeRenderer, PixiEvent} from '../src/ui/native-graph/types';

it('prevents an earlier PIXI pointerdown from leaving a native drag attached after sorting', () => {
  const element = document.createElement('canvas'); document.body.append(element);
  const a = {id: 'A'} as NativeNode, outer = {id: 'Outer'} as NativeNode;
  const nativeDown = vi.fn(function(this: NativeRenderer, node: NativeNode) {this.dragNode = node;});
  const renderer = {dragNode: null, onPointerDown: nativeDown} as unknown as NativeRenderer;
  const core = new Set(['Root', 'A', 'B']);
  const cleanup = isolateStructuralDrag(renderer, id => core.has(id));
  const snapshot = new GraphIndex(['Root', 'A', 'B'].map(id => ({id, title: id, parents: id === 'Root' ? [] : ['Root'], links: [], issues: []}))).neighborhood('Root');
  const positions = {A: {x: 100, y: 100}, B: {x: 300, y: 100}};
  const finish = vi.fn();
  // This listener runs before the canvas's capture listener, as PIXI does in Obsidian.
  const pixiDown = () => renderer.onPointerDown?.(a, {} as PixiEvent);
  document.addEventListener('pointerdown', pixiDown, true);
  const sorter = new StructuralDrag({element, snapshot: () => snapshot,
    nodes: () => new Map(snapshot.nodes.map(n => [n.id, n])), positions: () => positions,
    world: e => ({x: e.clientX, y: e.clientY}), enabled: () => true,
    draw: vi.fn(), hint: vi.fn(), focus: vi.fn(), finish, click: vi.fn(), suppressClick: vi.fn(),
    preview: vi.fn(), lift: vi.fn()});
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, {clientX: x, clientY: 100, bubbles: true, button: 0});
    Object.defineProperty(event, 'pointerId', {value: 1});
    (type === 'pointerdown' ? element : window).dispatchEvent(event);
  };
  try {
    pointer('pointerdown', 100); pointer('pointermove', 300); pointer('pointerup', 300);
    expect(finish).toHaveBeenCalledExactlyOnceWith('A', 'B');
    expect(nativeDown).not.toHaveBeenCalled(); expect(renderer.dragNode).toBeNull();
    pointer('pointermove', 500); expect(renderer.dragNode).toBeNull();
    renderer.onPointerDown?.(outer, {} as PixiEvent);
    expect(nativeDown).toHaveBeenCalledExactlyOnceWith(outer, {}); expect(renderer.dragNode).toBe(outer);
    renderer.onPointerDown?.(a, {} as PixiEvent); expect(renderer.dragNode).toBeNull();
    core.delete('A'); renderer.onPointerDown?.(a, {} as PixiEvent); expect(renderer.dragNode).toBe(a);
  } finally {sorter.destroy(); cleanup(); document.removeEventListener('pointerdown', pixiDown, true); element.remove();}
  expect(renderer.onPointerDown).toBe(nativeDown);
});
