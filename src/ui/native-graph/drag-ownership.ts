import type {NativeRenderer} from './types';

/** PIXI can see pointerdown on document before our canvas capture handler does. */
export function isolateStructuralDrag(renderer: NativeRenderer, structural: (id: string) => boolean): () => void {
  const original = renderer.onPointerDown;
  renderer.onPointerDown = (node, event) => {
    if (structural(node.id)) {
      renderer.dragNode = null;
      return;
    }
    original?.call(renderer, node, event);
  };
  return () => {renderer.onPointerDown = original;};
}
