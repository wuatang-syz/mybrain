import type { NativeRenderer } from './types';

/** Keep resize and repaint in one task: a resized GPU surface is otherwise blank until the next RAF. */
export function stabilizeResize(renderer: NativeRenderer): () => void {
  const original = renderer.onResize;
  let disposed = false;
  let previous: {width: number; height: number; dpr: number; surface: NativeRenderer['px']} | undefined;
  const resize = () => {
    if (disposed) return;
    // Native onResize uses clientWidth/clientHeight, not fractional DOMRect dimensions.
    const width = renderer.containerEl.clientWidth, height = renderer.containerEl.clientHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = renderer.containerEl.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const surface = renderer.px;
    if (previous && previous.width === width && previous.height === height && previous.dpr === dpr && previous.surface === surface) return;
    original.call(renderer);
    previous = {width, height, dpr, surface};
    // Reuse the existing stage and node graphics; do not restart layout or consume worker results.
    // Native setPan has already moved the stage to keep the same world center.
    surface?.render?.();
  };
  renderer.onResize = resize;
  return () => {
    disposed = true;
    if (renderer.onResize === resize) renderer.onResize = original;
  };
}
