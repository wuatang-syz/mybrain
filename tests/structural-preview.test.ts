// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {GraphIndex} from '../src/graph';
import {NativeGraphCanvas} from '../src/ui/native-graph';
import {structuralLayout} from '../src/ui/native-graph/data';
import {nodeSize} from '../src/ui/canvas/node-size';
import type {NoteRecord, Point} from '../src/model/types';
import type {NativeRenderer} from '../src/ui/native-graph/types';

class FakeGraphic {
  alpha = 1;
}

const note = (id: string, parents: string[] = []): NoteRecord => ({id, title: id, parents, links: [], issues: []});

function fixture() {
  const graph = new GraphIndex([note('Root'), note('A', ['Root']), note('B', ['Root'])]);
  const snapshot = graph.neighborhood('Root');
  const host = document.body.appendChild(document.createElement('div'));
  const overlay = host.appendChild(document.createElement('div'));
  const surface = document.createElement('canvas');
  const rect = {left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({})};
  surface.getBoundingClientRect = () => rect; host.getBoundingClientRect = () => rect;
  const circle = new FakeGraphic();
  const renderer = {interactiveEl: surface, nodes: [{id: 'A', circle}], nodeLookup: {A: {id: 'A', circle}},
    scale: 1, panX: 0, panY: 0, changed: vi.fn(), worker: {postMessage: vi.fn()}} as unknown as NativeRenderer;
  const canvas = Object.create(NativeGraphCanvas.prototype) as NativeGraphCanvas;
  const positions = {...structuralLayout(snapshot).positions};
  // The real gesture keeps a clone from drag start; restoring must use that, not the live object.
  const saved = structuredClone(positions);
  Object.assign(canvas, {snapshot, overlay, core: new Map(snapshot.nodes.filter(node => node.zone !== 'outer').map(node => [node.id, node])),
    positions, order: [], expandedGroups: new Set<string>(), hidden: new Set<string>(), pinned: new Set<string>(),
    restoredPositions: {}, destroyed: false, element: {win: {devicePixelRatio: 1}}, renderer,
    structuralDrag: {savedPositions: () => saved}});
  const preview = (id?: string, target?: string) =>
    (canvas as unknown as {previewStructuralDrop(id?: string, target?: string): void}).previewStructuralDrop(id, target);
  return {canvas, preview, positions, saved, overlay, renderer, snapshot, dispose: () => host.remove()};
}

it('opens the landing slot with a marked drop target and clears it when the gesture ends', () => {
  const f = fixture();
  const before: Record<string, Point> = structuredClone(f.saved);
  f.preview('A', 'B');
  // The grabbed node keeps following the pointer while its sibling moves into the vacated slot.
  expect(f.positions.A).toEqual(before.A);
  expect(f.positions.B).toEqual(before.A);
  const slot = before.B!, size = nodeSize(f.canvas.core.get('A')!);
  const marker = f.overlay.querySelector<HTMLElement>('.brain-drop-marker');
  expect(marker).not.toBeNull();
  expect(marker!.dataset.worldX).toBe(String(slot.x)); expect(marker!.dataset.worldY).toBe(String(slot.y));
  expect(marker!.style.left).toBe(`${slot.x}px`); expect(marker!.style.top).toBe(`${slot.y}px`);
  expect(marker!.style.width).toBe(`${size.width}px`); expect(marker!.style.height).toBe(`${size.height}px`);
  expect(marker!.childElementCount).toBe(0);
  // Repeating the same target keeps a single marker instead of stacking elements.
  f.preview('A', 'B'); expect(f.overlay.querySelectorAll('.brain-drop-marker')).toHaveLength(1);
  // Leaving the target springs the row back and drops the marker.
  f.preview('A', undefined);
  expect(f.positions.B).toEqual(before.B); expect(f.overlay.querySelector('.brain-drop-marker')).toBeNull();
  // A later drag draws a fresh marker.
  f.preview('A', 'B'); expect(f.overlay.querySelectorAll('.brain-drop-marker')).toHaveLength(1);
  f.preview(); expect(f.overlay.querySelector('.brain-drop-marker')).toBeNull();
  f.dispose();
});

it('dims the grabbed node and restores it when the gesture ends', () => {
  const f = fixture();
  const circle = f.renderer.nodeLookup.A!.circle!;
  (f.canvas as unknown as {liftStructural(id?: string): void}).liftStructural('A');
  expect(circle.alpha).toBe(.5);
  (f.canvas as unknown as {liftStructural(id?: string): void}).liftStructural();
  expect(circle.alpha).toBe(1);
  f.dispose();
});
