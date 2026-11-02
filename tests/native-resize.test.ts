// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {stabilizeResize} from '../src/ui/native-graph/resize';
import type {NativeRenderer} from '../src/ui/native-graph/types';

function fixture() {
  const containerEl = document.createElement('div');
  let width = 800, height = 600, dpr = 1;
  Object.defineProperties(containerEl, {clientWidth: {get: () => width}, clientHeight: {get: () => height}});
  const win = {get devicePixelRatio() {return dpr;}};
  Object.defineProperty(containerEl, 'ownerDocument', {value: {defaultView: win}});
  const frames: string[] = [];
  const paint = vi.fn(() => frames.push('paint'));
  const original = vi.fn(() => {frames.push('clear'); renderer.width = width; renderer.height = height; renderer.changed();});
  const renderer = {containerEl, onResize: original, changed: vi.fn(), px: {render: paint},
    setData: vi.fn(), worker: {postMessage: vi.fn()}} as unknown as NativeRenderer;
  const dispose = stabilizeResize(renderer);
  return {renderer, original, paint, frames, dispose, size: (w: number, h = 600) => {width = w; height = h;}, density: (value: number) => {dpr = value;}};
}
it('repaints synchronously after every actual splitter resize without rebuilding graph data', () => {
  const f = fixture();
  for (const width of [800, 790, 780, 770]) {
    f.size(width); f.renderer.onResize();
    expect(f.frames.at(-1)).toBe('paint');
  }
  expect(f.frames).toEqual(['clear', 'paint', 'clear', 'paint', 'clear', 'paint', 'clear', 'paint']);
  expect(f.renderer.setData).not.toHaveBeenCalled();
  expect(f.renderer.worker.postMessage).not.toHaveBeenCalled();
  f.dispose();
});
it('deduplicates native and observer calls, including fractional bounding rectangles', () => {
  const f = fixture();
  f.renderer.containerEl.getBoundingClientRect = () => ({width: 800.4, height: 600.2}) as DOMRect;
  f.renderer.onResize(); f.renderer.onResize(); f.renderer.onResize();
  expect(f.original).toHaveBeenCalledOnce(); expect(f.paint).toHaveBeenCalledOnce();
  f.size(800, 610); f.renderer.onResize(); expect(f.original).toHaveBeenCalledTimes(2);
  f.dispose();
});
it('handles display density changes, GPU initialization and surface replacement at unchanged CSS dimensions', () => {
  const f = fixture(), surface = f.renderer.px;
  f.renderer.px = undefined; f.renderer.onResize();
  expect(f.paint).not.toHaveBeenCalled();
  f.renderer.px = surface; f.renderer.onResize(); expect(f.paint).toHaveBeenCalledOnce();
  f.density(2); f.renderer.onResize(); expect(f.paint).toHaveBeenCalledTimes(2);
  const render = vi.fn(); f.renderer.px = {...surface!, render}; f.renderer.onResize();
  expect(render).toHaveBeenCalledOnce(); f.dispose();
});
it('skips hidden surfaces and restores the native method on cleanup', () => {
  const f = fixture(), callback = f.renderer.onResize;
  f.size(0); f.renderer.onResize(); expect(f.original).not.toHaveBeenCalled();
  f.size(800); f.renderer.onResize(); expect(f.paint).toHaveBeenCalledOnce();
  f.dispose(); expect(f.renderer.onResize).toBe(f.original);
  callback(); expect(f.original).toHaveBeenCalledOnce();
});
