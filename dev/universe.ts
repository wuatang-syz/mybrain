import {KnowledgeWorldCanvas} from '../src/world/canvas';
import {GraphIndex} from '../src/graph';
import {buildKnowledgeSnapshot} from '../src/world/snapshot';
import {WorldSettingsPanel} from '../src/world/panel';
import {WorldActions} from '../src/ui/world-actions';
import {levelName, newWorldState, resolveTheme, setTheme, themeConfig, themeOptions, viewKey} from '../src/world/theme';
import type {NoteRecord} from '../src/model/types';
import type {KnowledgeWorldState} from '../src/world/types';
import {createElement, BrainCircuit, CodeXml, FlaskConical, Box, House, Orbit, Sparkles, ArrowUpRight, Plus, Minus, Maximize, Search, Repeat, Settings, Pause, Play} from 'lucide';

const icons = {'brain-circuit':BrainCircuit,'code-xml':CodeXml,'flask-conical':FlaskConical,box:Box,house:House,orbit:Orbit,sparkles:Sparkles,'arrow-up-right':ArrowUpRight,plus:Plus,minus:Minus,maximize:Maximize,search:Search,repeat:Repeat,settings:Settings,pause:Pause,play:Play};
function icon(el: HTMLElement, name: string): void {const data=icons[name as keyof typeof icons]; if(data) el.append(createElement(data,{width:'18',height:'18','stroke-width':'1.5'}));}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const data = await fetch('/notes.json').then(r=>r.json()) as {root:string|null;notes:NoteRecord[]};
const graph = new GraphIndex(data.notes), root=document.getElementById('app')!, pane=document.getElementById('note-pane')!;
let level=data.root, selected:string|undefined; const trail:string[]=[]; const selections=new Map<string,string|undefined>(); const saved:KnowledgeWorldState=newWorldState();
const toolbar=document.createElement('div');toolbar.className='universe-preview-toolbar';
const home=document.createElement('button');home.textContent=graph.get(data.root??'')?.title??'全部知识';home.onclick=()=>enter(data.root);toolbar.append(home);
const crumb=document.createElement('span');toolbar.append(crumb);
const badge=document.createElement('small');badge.textContent='Brain / 知识世界';toolbar.append(badge);root.append(toolbar);
const stage=document.createElement('div');stage.className='universe-preview-stage';root.append(stage);
const footer=document.createElement('div');footer.className='universe-preview-footer';const stats=document.createElement('span');footer.append(stats);
const controls=document.createElement('div');controls.className='controls';footer.append(controls);root.append(footer);
const zoomValue=document.createElement('span');zoomValue.textContent='100%';
const control=(label:string,name:string,run:()=>void)=>{const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);icon(button,name);button.onclick=run;controls.append(button);};
control('缩小','minus',()=>canvas.zoom(-1));controls.append(zoomValue);control('放大','plus',()=>canvas.zoom(1));control('适应画布','maximize',()=>canvas.fit());
const canvas=new KnowledgeWorldCanvas(stage,{select:id=>{selected=id;render();},open:id=>{void openNote(id);},back:()=>{const previous=trail.pop();if(previous)enter(previous,false);},clear:()=>{selected=undefined;},edit:id=>{void openNote(id);},
  context:(id,e)=>{e.preventDefault();void openNote(id);},enter:id=>enter(id),save:()=>{saveView();},
  onExpanded:()=>render(),onZoom:p=>{zoomValue.textContent=`${p}%`;},error:message=>{stats.textContent=message;},
  motion:on=>{themeConfig(saved,saved.theme).appearance.motion=on;},icon},{budget:200},saved.theme);
// The preview mirrors production chrome: the top bar carries no world controls, and the theme,
// settings and motion icons hang under the search inside the world surface.
let panel:WorldSettingsPanel|undefined;
const actions=new WorldActions(canvas.element,{renderIcon:icon,
  themes:()=>themeOptions(),theme:()=>saved.theme,
  setTheme:id=>{closePanel();saveView();setTheme(saved,id);render();actions.update();},
  settingsOpen:()=>!!panel,toggleSettings:()=>{if(panel)closePanel();else openPanel();},
  motionOn:()=>canvas.motionOn,
  motionLabels:()=>{const copy=resolveTheme(saved.theme).copy;return {on:copy.motionOn,off:copy.motionOff};},
  toggleMotion:()=>{closePanel();canvas.toggleMotion();actions.update();}});
function worldTargets(){const snapshot=canvas.snapshot;if(!snapshot)return [];
  return [...snapshot.groups.map(group=>({id:group.id,title:group.title,kind:'group' as const})),
    ...snapshot.notes.map(note=>({id:note.id,title:note.title,kind:'note' as const}))];}
function openPanel():void{const theme=resolveTheme(saved.theme);canvas.beginPreview();
  panel=new WorldSettingsPanel({mount:canvas.element,theme,config:clone(themeConfig(saved,theme.id)),targets:worldTargets(),levelName:levelName(theme,1),
    onChange:draft=>canvas.applyConfig(draft),
    onApply:draft=>{saved.themes[theme.id]=draft;const view=canvas.endPreview(true);if(view)saved.views[viewKey(theme.id,level)]=view;closePanel();render();},
    onCancel:()=>{closePanel();canvas.applyConfig(themeConfig(saved,theme.id));},
    onRestoreDefaults:()=>{},
    onResetLayout:()=>canvas.clearPositions()});
  panel.open();actions.update();}
function closePanel():void{canvas.endPreview(false);panel?.close();panel=undefined;actions.update();}
function enter(id:string|null,record=true):void {
  closePanel();saveView();selections.set(viewKey(saved.theme,level),selected);
  if(record&&level&&level!==id)trail.push(level);
  level=id;selected=selections.get(viewKey(saved.theme,level));render();
}
function saveView():void {if(canvas.isPreviewing)return;const state=saved;state.views[viewKey(state.theme,level)]=canvas.getView();}
function render():void {canvas.setLevel(level);const built=buildKnowledgeSnapshot(graph,{root:data.root,attention:level,selected},{expanded:canvas.expanded,budget:200});
  canvas.setLevel(level);canvas.render(built.snapshot,selected,{state:saved,themeId:saved.theme,level});
  const theme=resolveTheme(saved.theme);
  crumb.textContent=level&&level!==data.root?`/ ${graph.get(level)?.title??''}`:'';
  stats.textContent=`${theme.name} · ${built.snapshot.stats.groups} 个${theme.levels[1]?.name??'领域'} · ${built.snapshot.stats.total} 篇真实笔记`;
  actions.update();}
async function openNote(id:string):Promise<void>{const note=graph.get(id);if(!note)return;pane.replaceChildren();pane.hidden=false;
  const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>{pane.hidden=true;};pane.append(close);
  const title=document.createElement('h1');title.textContent=note.title;pane.append(title);
  const link=document.createElement('a');link.textContent='在 Obsidian 中编辑';link.href=`obsidian://open?vault=${encodeURIComponent('脑图')}&file=${encodeURIComponent(id)}`;pane.append(link);
  const content=document.createElement('pre');content.textContent=await fetch(`/note?id=${encodeURIComponent(id)}`).then(r=>r.text());pane.append(content);}
const search=document.createElement('button');search.className='preview-search';search.setAttribute('aria-label','搜索笔记');icon(search,'search');search.append('搜索笔记');canvas.element.append(search);
search.onclick=()=>{const dialog=document.createElement('dialog'),input=document.createElement('input'),results=document.createElement('div');input.placeholder='搜索整个知识库…';input.setAttribute('aria-label','搜索整个知识库');results.className='preview-results';dialog.append(input,results);
  const update=()=>{results.replaceChildren();for(const note of graph.all().filter(n=>n.title.toLowerCase().includes(input.value.toLowerCase()))){const button=document.createElement('button');button.textContent=note.title;button.onclick=()=>{if(note.id!==level&&!canvas.drawnNotes.has(note.id))enter(graph.parents(note.id)[0]??data.root);selected=note.id;render();canvas.locate(note.id);dialog.close();};results.append(button);}};
  input.oninput=update;dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);update();dialog.showModal();input.focus();};
render();
Object.assign(window,{__universe:canvas,__universeGraph:graph,__universeActions:actions});
