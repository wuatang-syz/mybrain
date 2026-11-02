// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PeripheralDrag} from '../src/ui/native-graph/peripheral-drag';
import type {Graphics, NativeNode, NativeRenderer} from '../src/ui/native-graph/types';
import type {GraphNode} from '../src/model/types';

function fixture(scale = 1, dpr = 1) {
  vi.useFakeTimers(); vi.stubGlobal('devicePixelRatio', dpr);
  const element = document.createElement('canvas'); document.body.append(element);
  element.getBoundingClientRect = () => ({left: 0, top: 0, right: 800, bottom: 600}) as DOMRect;
  const source = {id: 'Outer.md', x: 100, y: 100, fx: null, fy: null, getSize: () => 10} as NativeNode;
  const target = {id: 'Root.md', x: 300, y: 100, fx: 300, fy: 100, getSize: () => 100} as NativeNode;
  const renderer = {interactiveEl: element, nodes: [source, target], nodeLookup: {[source.id]: source, [target.id]: target},
    scale, nodeScale: 1, changed: vi.fn(), worker: {postMessage: vi.fn()}} as unknown as NativeRenderer;
  const core = new Map<string, GraphNode>([[target.id, {id: target.id, title: 'Root', zone: 'focus', groupParents: [], issues: []}]]);
  const connect = vi.fn(), moved = vi.fn(), click = vi.fn(), hint = vi.fn(), suppressClick = vi.fn();
  const drag = new PeripheralDrag({renderer, core: () => core, isNote: id => id.endsWith('.md'),
    world: event => ({x: event.clientX * dpr / scale, y: event.clientY * dpr / scale}), enabled: () => true,
    focus: vi.fn(), hint, suppressClick, click, moved, connect});
  const pointer = (type: string, x: number, y: number, id = 1) => {
    const event = new MouseEvent(type, {clientX: x * scale / dpr, clientY: y * scale / dpr, button: 0, bubbles: true, cancelable: true});
    Object.defineProperty(event, 'pointerId', {value: id});
    (type === 'pointerdown' ? element : window).dispatchEvent(event);
  };
  return {source, target, renderer, connect, moved, click, hint, suppressClick, pointer, drag,
    dispose: () => {drag.destroy(); element.remove();}};
}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('peripheral body drag', () => {
  it.each([[1, 1], [.5, 2]])('connects after dwelling, returning the source to its original position (scale %s, DPR %s)', (scale, dpr) => {
    const f = fixture(scale, dpr);
    f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
    vi.advanceTimersByTime(299); expect(f.hint).not.toHaveBeenCalledWith('松开连接 · Esc 取消');
    vi.advanceTimersByTime(1); expect(f.hint).toHaveBeenLastCalledWith('松开连接 · Esc 取消');
    f.pointer('pointerup', 300, 100);
    expect(f.connect).toHaveBeenCalledExactlyOnceWith('Outer.md', 'Root.md');
    expect(f.source).toMatchObject({x: 100, y: 100, fx: null, fy: null});
    expect(f.moved).not.toHaveBeenCalled(); expect(f.click).not.toHaveBeenCalled(); f.dispose();
  });
  it('moves normally on quick release and on blank space without creating a relation', () => {
    const f = fixture();
    f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
    vi.advanceTimersByTime(200); f.pointer('pointerup', 300, 100);
    expect(f.connect).not.toHaveBeenCalled(); expect(f.moved).toHaveBeenCalledExactlyOnceWith('Outer.md');
    expect(f.source).toMatchObject({x: 300, y: 100, fx: 300, fy: 100});
    vi.advanceTimersByTime(500); expect(f.hint).toHaveBeenLastCalledWith(''); f.dispose();
  });
  it('disarms when leaving a target, requires a fresh dwell, and rechecks the release position', () => {
    const f = fixture(); f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
    vi.advanceTimersByTime(300); f.pointer('pointermove', 500, 200);
    f.pointer('pointermove', 300, 100); vi.advanceTimersByTime(200); f.pointer('pointerup', 300, 100);
    expect(f.connect).not.toHaveBeenCalled(); f.dispose();
    const g = fixture(); g.pointer('pointerdown', 100, 100); g.pointer('pointermove', 300, 100);
    vi.advanceTimersByTime(300); g.pointer('pointerup', 600, 300);
    expect(g.connect).not.toHaveBeenCalled();
    expect(g.source).toMatchObject({x: 600, y: 300}); g.dispose();
  });
  it.each(['Escape', 'blur', 'pointercancel', 'destroy'])('cancels and restores pinned coordinates on %s', action => {
    const f = fixture(); f.source.fx = 100; f.source.fy = 100;
    f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
    vi.advanceTimersByTime(300);
    if (action === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    else if (action === 'destroy') f.drag.destroy();
    else if (action === 'pointercancel') f.pointer(action, 300, 100);
    else window.dispatchEvent(new Event(action));
    f.pointer('pointerup', 300, 100); vi.advanceTimersByTime(500);
    expect(f.source).toMatchObject({x: 100, y: 100, fx: 100, fy: 100});
    expect(f.connect).not.toHaveBeenCalled(); expect(f.moved).not.toHaveBeenCalled(); f.dispose();
  });
  it('preserves clicking, ignores other pointers, and does not take over the existing connector or structural body', () => {
    const f = fixture();
    f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100, 2);
    f.pointer('pointerup', 300, 100, 2); f.pointer('pointerup', 100, 100);
    expect(f.click).toHaveBeenCalledExactlyOnceWith('Outer.md');
    for (const x of [122, 300]) {
      f.pointer('pointerdown', x, 100); f.pointer('pointermove', 300, 100);
      vi.advanceTimersByTime(500); f.pointer('pointerup', 300, 100);
    }
    expect(f.connect).not.toHaveBeenCalled(); expect(f.moved).not.toHaveBeenCalled(); f.dispose();
  });
  it('rejects a target that moves away or is removed during the dwell', () => {
    const f = fixture(); f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
    f.renderer.nodes = [f.source]; vi.advanceTimersByTime(400); f.pointer('pointerup', 300, 100);
    expect(f.connect).not.toHaveBeenCalled(); f.dispose();
  });
  it('shows the line and target outline only after dwelling and removes both when leaving', () => {
    class Graphic {
      visible = true;
      clear = vi.fn(() => this); lineStyle = vi.fn(() => this);
      moveTo = vi.fn(() => this); lineTo = vi.fn(() => this);
      drawRoundedRect = vi.fn(() => this); destroy = vi.fn();
    }
    const f = fixture(), addChild = vi.fn();
    f.source.circle = new Graphic() as unknown as Graphics;
    f.renderer.hanger = {addChild} as unknown as NativeRenderer['hanger'];
    f.pointer('pointerdown', 100, 100); f.pointer('pointermove', 300, 100);
    vi.advanceTimersByTime(299); expect(addChild).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const preview = addChild.mock.calls[0]![0] as Graphic;
    expect(preview.moveTo).toHaveBeenCalledWith(100, 100);
    expect(preview.lineTo).toHaveBeenCalledWith(300, 100);
    expect(preview.drawRoundedRect).toHaveBeenCalledOnce();
    f.pointer('pointermove', 500, 200); expect(preview.destroy).toHaveBeenCalledOnce(); f.dispose();
  });
});
