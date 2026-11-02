import {beforeEach, describe, expect, it} from 'vitest';
import {GraphIndex} from '../src/graph';
import {knowledgeMap, mapDrawable, mapLayout} from '../src/graph/knowledge-map';
import type {NoteRecord} from '../src/model/types';
import type {NativeNode, NativeRenderer} from '../src/ui/native-graph/types';
import {mapPaintIndex, paintNode, semanticLevel, takePaintError, toScreen, toWorld, zoomRatio} from '../src/ui/knowledge-map/paint';

const ops: string[] = [];
let failEllipse = false;
class FakeGraphics {
  x = 0; y = 0; alpha = 1; visible = true; tint = 0; zIndex = 0; eventMode = ''; cursor = '';
  scale = {x: 1, y: 1, set: (value: number) => {ops.push(`scale:${value.toFixed(2)}`);}};
  pivot = {x: 0, y: 0, set: () => {}};
  constructor() {}
  clear() {ops.push('clear'); return this;}
  lineStyle(width: number, color: number, alpha = 1) {ops.push(`line:${width}:${color}:${alpha}`); return this;}
  beginFill(color: number, alpha = 1) {ops.push(`fill:${color}:${alpha}`); return this;}
  endFill() {return this;}
  drawCircle(_x: number, _y: number, radius: number) {ops.push(`circle:${Math.round(radius)}`); return this;}
  drawEllipse(_x: number, _y: number, halfWidth: number, halfHeight: number) {
    if (failEllipse) throw new Error('ellipse unavailable');
    ops.push(`ellipse:${Math.round(halfWidth)}x${Math.round(halfHeight)}`); return this;
  }
  drawRoundedRect(_x: number, _y: number, width: number, height: number) {ops.push(`rect:${Math.round(width)}x${Math.round(height)}`); return this;}
  moveTo() {return this;}
  lineTo() {return this;}
  bezierCurveTo() {ops.push('curve'); return this;}
  addChild() {return this;}
  removeChild() {return this;}
  on() {return this;}
  off() {return this;}
  destroy(): void {}
}
class FakeText {
  x = 0; y = 0; alpha = 1; visible = true; zIndex = 0; eventMode = ''; text: string;
  style: Record<string, unknown>;
  scale = {x: 1, y: 1, set: () => {}};
  anchor = {set: (_x: number, _y: number) => {}};
  constructor(text: string, style?: Record<string, unknown>) {this.text = text; this.style = {...style};}
  addChild() {return this;}
  removeChild() {return this;}
  on() {return this;}
  off() {return this;}
  destroy(): void {}
}
const note = (id: string, parents: string[] = []): NoteRecord => ({id, title: id, parents, links: [], issues: []});
const fixture = (scale = 1, expanded: string[] = ['Topic']) => {
  const graph = new GraphIndex([note('Root'), note('Topic', ['Root']), note('A', ['Topic']), note('Deep', ['A'])]);
  const snapshot = knowledgeMap(graph, {attention: 'Root', root: 'Root'});
  const drawable = mapDrawable(snapshot, {expanded});
  const layout = mapLayout(snapshot, drawable, {version: 2, nodes: {}, cards: {}}, 1.5);
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  const cards = new Map(layout.cards.map(card => [card.id, card]));
  const index = mapPaintIndex(snapshot, nodes);
  const seed = {circle: new FakeGraphics(), text: new FakeText('')};
  const renderer = {
    scale, panX: 0, panY: 0, width: 1200, height: 800, targetScale: scale, links: [], nodes: [seed],
    containerEl: {win: {devicePixelRatio: 1}, ownerDocument: {body: {classList: {contains: () => false}}}},
  } as unknown as NativeRenderer;
  const host: Parameters<typeof paintNode>[0] = {
    renderer, snapshot, drawable, layout, nodes, cards, jumps: index.jumps,
    incoming: index.incoming,
  };
  return {host, layout, renderer};
};
const nativeNode = (id: string) => {
  const circle = new FakeGraphics(), text = new FakeText('');
  const node = {id, x: 0, y: 0, fx: 0, fy: 0, rendered: false, circle, text,
    render: () => {}, getSize: () => 65, clearGraphics: () => {}};
  return {node, circle, text};
};

beforeEach(() => {ops.length = 0; failEllipse = false; takePaintError();});

describe('knowledge map painting', () => {
  it('draws the card ellipse, header chrome and cluster title through the topic node', () => {
    const {host, layout} = fixture();
    const topic = layout.nodes.find(node => node.role === 'topic')!;
    const painted = nativeNode(topic.id);
    paintNode(host as never, painted.node as unknown as NativeNode);
    ops.length = 0; painted.node.render();
    const card = layout.cards[0]!;
    expect(ops).toContain(`ellipse:${Math.round(card.width / 2)}x${Math.round(card.height / 2)}`);
    expect(ops).toContain(`fill:${card.color}:0.07`);
    expect(ops).toContain('circle:11');
    expect(painted.circle.tint).toBe(0xffffff);
    expect(ops.some(op => op.startsWith('line:'))).toBe(true);
    expect(painted.text.text).toBe('Topic');
    expect(painted.text.y).toBeLessThan(card.y);
    expect(painted.text.style.fill).toBe(card.color);
  });
  it('keeps the cluster title readable at far zoom instead of dropping it', () => {
    const near = fixture(1), far = fixture(.3);
    const nearTopic = near.layout.nodes.find(node => node.role === 'topic')!;
    const farTopic = far.layout.nodes.find(node => node.role === 'topic')!;
    const nearPainted = nativeNode(nearTopic.id), farPainted = nativeNode(farTopic.id);
    paintNode(near.host as never, nearPainted.node as unknown as NativeNode);
    paintNode(far.host as never, farPainted.node as unknown as NativeNode);
    nearPainted.node.render(); farPainted.node.render();
    expect(semanticLevel(near.renderer)).toBe('near');
    expect(semanticLevel(far.renderer)).toBe('far');
    expect(zoomRatio(far.renderer)).toBeCloseTo(.3);
    expect(farPainted.text.text).toBe('Topic');
    expect(Number(farPainted.text.style.fontSize)).toBeGreaterThan(Number(nearPainted.text.style.fontSize));
    expect(farPainted.text.visible).toBe(true);
  });
  it('shapes direct and deep nodes and draws structure edges from the child', () => {
    const {host, layout} = fixture();
    const direct = layout.nodes.find(node => node.role === 'direct')!;
    const deep = layout.nodes.find(node => node.role === 'deep')!;
    const directPainted = nativeNode(direct.id), deepPainted = nativeNode(deep.id);
    paintNode(host as never, directPainted.node as unknown as NativeNode);
    paintNode(host as never, deepPainted.node as unknown as NativeNode);
    ops.length = 0; directPainted.node.render();
    expect(ops).toContain(`ellipse:${Math.round(direct.width / 2)}x${Math.round(direct.height / 2)}`);
    expect(ops).toContain('curve');
    expect(directPainted.circle.tint).toBe(0xffffff);
    expect(directPainted.text.visible).toBe(true);
    ops.length = 0; deepPainted.node.render();
    expect(ops).toContain('circle:6');
    expect(deepPainted.text.visible).toBe(false);
    host.hovered = deep.id;
    deepPainted.node.render();
    expect(deepPainted.text.visible).toBe(true);
    expect(deepPainted.text.text).toBe('Deep');
  });
  it('keeps node labels at a readable screen size and hides them when far out', () => {
    const mid = fixture(.6), far = fixture(.3);
    const midDirect = mid.layout.nodes.find(node => node.role === 'direct')!;
    const farDirect = far.layout.nodes.find(node => node.role === 'direct')!;
    const midPainted = nativeNode(midDirect.id), farPainted = nativeNode(farDirect.id);
    paintNode(mid.host as never, midPainted.node as unknown as NativeNode);
    paintNode(far.host as never, farPainted.node as unknown as NativeNode);
    midPainted.node.render(); farPainted.node.render();
    // At 60% zoom the world font grows so the on-screen label stays ~13.5px.
    expect(Number(midPainted.text.style.fontSize)).toBeCloseTo(13.5 / .6, 1);
    expect(midPainted.text.visible).toBe(true);
    expect(farPainted.text.visible).toBe(false);
    far.host.hovered = farDirect.id;
    farPainted.node.render();
    expect(farPainted.text.visible).toBe(true);
  });
  it('reports a painting failure instead of blanking the canvas', () => {
    const {host, layout} = fixture();
    const topic = layout.nodes.find(node => node.role === 'topic')!;
    const painted = nativeNode(topic.id);
    paintNode(host as never, painted.node as unknown as NativeNode);
    failEllipse = true;
    painted.node.render();
    expect(takePaintError()).toBe('ellipse unavailable');
    failEllipse = false;
    painted.node.render();
    expect(takePaintError()).toBeNull();
  });
  it('converts between world and screen space with the renderer transform', () => {
    const {renderer} = fixture(2);
    renderer.panX = 40; renderer.panY = -20;
    expect(toScreen(renderer, {x: 10, y: 5})).toEqual({x: 60, y: -10});
    expect(toWorld(renderer, {x: 60, y: -10})).toEqual({x: 10, y: 5});
  });
});
