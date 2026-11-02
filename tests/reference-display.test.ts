// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {decorateEdge} from '../src/ui/native-graph/edges';
import {DEFAULT_MIND_MAP, type MindMapSettings} from '../src/mind-map-settings';
import type {CanvasCallbacks, GraphEdge, GraphNode} from '../src/model/types';
import type {NativeLink, NativeNode, NativeRenderer} from '../src/ui/native-graph/types';

class TestGraphics {
  visible = true;
  eventMode = '';
  cursor = '';
  zIndex = 0;
  clear = vi.fn(() => this);
  lineStyle = vi.fn(() => this);
  moveTo = vi.fn(() => this);
  lineTo = vi.fn(() => this);
  bezierCurveTo = vi.fn(() => this);
  on = vi.fn(() => this);
  destroy = vi.fn();
}
function fixture(structural?: GraphEdge['kind'], outerOnly = false, settings: MindMapSettings = {...DEFAULT_MIND_MAP}) {
  const a = {id: 'A', x: 0, y: 0, getSize: () => 10, circle: new TestGraphics()} as unknown as NativeNode;
  const b = {id: 'B', x: 300, y: 100, getSize: () => 10, circle: new TestGraphics()} as unknown as NativeNode;
  const c = {id: 'C'} as NativeNode;
  const nativeLine = {visible: true}, nativeArrow = {visible: true};
  const render = vi.fn(() => {nativeLine.visible = true; nativeArrow.visible = true;});
  const link = {source: a, target: b, line: nativeLine, arrow: nativeArrow, render, clearGraphics: vi.fn()} as unknown as NativeLink;
  const drawings: TestGraphics[] = [];
  const worker = {postMessage: vi.fn()};
  const renderer = {containerEl: document.createElement('div'), nodeLookup: {A: a, B: b, C: c},
    nodes: [a, b, c], links: [link], scale: 1, nodeScale: 1, highlightNode: null,
    hanger: {addChild: (graphic: TestGraphics) => drawings.push(graphic)}, worker, setData: vi.fn()} as unknown as NativeRenderer;
  const core = new Map<string, GraphNode>(outerOnly ? [] : [['A', {id: 'A', title: 'A', zone: 'focus', groupParents: [], issues: []}]]);
  const edges: GraphEdge[] = structural ? [{source: 'A', target: 'B', kind: structural}] : [];
  const cleanup = decorateEdge(renderer, link, core, edges, {} as CanvasCallbacks, {settings: () => settings});
  return {a, b, c, link, render, renderer, core, drawings, nativeLine, nativeArrow, cleanup, worker};
}

describe('permanent jump display', () => {
 it.each(['hierarchy','jump'] as const)('keeps %s visible without hover and applies line preferences', kind => {
  const f=fixture(kind,false,{...DEFAULT_MIND_MAP,lineWidth:200,lineOpacity:50});
  for(const node of [null,f.c,f.a]){f.renderer.highlightNode=node;f.link.render();expect(f.drawings[0]?.visible).toBe(true);}
  expect(f.drawings[0]?.lineStyle).toHaveBeenLastCalledWith(3,kind==='jump'?0x9a88b7:0x79aaa8,.425);
  expect(f.nativeLine.visible).toBe(false);expect(f.nativeArrow.visible).toBe(false);
  expect(f.worker.postMessage).not.toHaveBeenCalled();
 });
 it('treats native internal references as jumps and keeps them visible after pointer leave', () => {
  const f=fixture();f.link.render();expect(f.drawings[0]?.visible).toBe(true);
  f.renderer.highlightNode=f.c;f.link.render();expect(f.drawings[0]?.visible).toBe(true);
  expect(f.drawings[0]?.lineStyle).toHaveBeenLastCalledWith(1.5,0x9a88b7,.85);
  f.cleanup();expect(f.link.render).toBe(f.render);expect(f.drawings[0]?.destroy).toHaveBeenCalledOnce();
 });
 it('does not duplicate reciprocal links or reveal filtered endpoints', () => {
  const f=fixture();f.cleanup();decorateEdge(f.renderer,f.link,f.core,[],{} as CanvasCallbacks,{duplicate:true});
  f.link.render();expect(f.drawings).toHaveLength(0);
  const g=fixture();g.b.circle!.visible=false;g.link.render();expect(g.drawings[0]?.visible).toBe(false);
 });
 it('paints the child trunk only for its owner', () => {
  for(const drawTrunk of [true,false]){
   const f=fixture('hierarchy');f.cleanup();f.core.set('B',{id:'B',title:'B',zone:'child',groupParents:['A'],issues:[]});
   decorateEdge(f.renderer,f.link,f.core,[{source:'A',target:'B',kind:'hierarchy'}],{} as CanvasCallbacks,{route:()=>({x:300,y:140,drawStem:true,drawTrunk})});
   f.link.render();expect(f.drawings[0]?.lineTo).toHaveBeenCalledTimes(drawTrunk?1:0);expect(f.drawings[0]?.bezierCurveTo).toHaveBeenCalledOnce();
  }
 });
 it.each(['hierarchy','jump'] as const)('keeps ordinary %s curves interactive with the correct edge menu and emphasis', kind => {
  const f=fixture('jump');f.cleanup();
  f.core.set('B',{id:'B',title:'B',zone:kind==='jump'?'jump':'sibling',groupParents:[],issues:[]});
  const edge:GraphEdge={source:'A',target:'B',kind}, onEdgeContext=vi.fn();
  const cleanup=decorateEdge(f.renderer,f.link,f.core,[edge],{onEdgeContext} as unknown as CanvasCallbacks,{
   selected:()=> 'B',
  });
  f.link.render();
  const [branch]=f.drawings;
  expect(f.drawings).toHaveLength(1);expect(branch?.eventMode).toBe('static');
  expect(branch?.bezierCurveTo).toHaveBeenCalledOnce();expect(branch?.lineTo).not.toHaveBeenCalled();
  expect(branch?.lineStyle).toHaveBeenLastCalledWith(1.8,kind==='jump'?0x9a88b7:0x79aaa8,1);
  const event={stopPropagation:vi.fn(),nativeEvent:new MouseEvent('contextmenu')};
  const handlers=vi.mocked(branch!.on).mock.calls as unknown as [string,(event:unknown)=>void][];
  const handler=handlers.find(call=>call[0]==='rightclick')!;
  handler[1](event);expect(onEdgeContext).toHaveBeenCalledWith(edge,event.nativeEvent);
  cleanup();expect(branch?.destroy).toHaveBeenCalledOnce();
 });
});
