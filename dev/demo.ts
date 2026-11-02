import { graphStatistics } from '../src/ui/statistics';
import {previewVault} from './vault';
import type { GraphNode, LayoutState, Neighborhood, RelationRequest, RelationKind } from '../src/model/types';
import { GraphCanvas } from '../src/ui/canvas';
import { NodeCreator } from '../src/ui/creator';
import { BrainToolbar } from '../src/ui/toolbar';
import { BrainRootBar } from '../src/ui/root-bar';
import { createElement, BrainCircuit, Search, Plus, Minus, ChevronRight, Ellipsis, ArrowLeft, ArrowRight, Crosshair, Flag, Undo2, Redo2, SunMoon } from 'lucide';

const icons = { 'brain-circuit': BrainCircuit, search: Search, plus: Plus, minus: Minus, 'chevron-right': ChevronRight,
  ellipsis: Ellipsis, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, crosshair: Crosshair, flag: Flag,
  'undo-2': Undo2, 'redo-2': Redo2, 'sun-moon': SunMoon };
function renderIcon(element: HTMLElement, name: string): void {
  const icon = icons[name as keyof typeof icons];
  if (icon) element.append(createElement(icon, { width: '18', height: '18', 'stroke-width': '1.6' }));
}
document.documentElement.classList.toggle('light', new URLSearchParams(location.search).get('theme') !== 'dark');

const sample = previewVault({
  '学习方法/主动回忆.md': '# 主动回忆\n\n[[知识管理/卡片笔记]]',
  '学习方法/刻意练习.md': '# 刻意练习\n\n[[学习方法/主动回忆]]',
  '学习方法/学习方法.md': '# 学习方法\n\n文件夹和同名笔记分别显示。',
  '知识管理/卡片笔记.md': '# 卡片笔记',
  '灵感碎片.md': '# 灵感碎片',
  '空文件夹': null,
});
const {graph, relations, contents} = sample;
const root = document.getElementById('app')!;
root.className = 'brain-view';
let focus = '学习方法';
const globalRoot = '/';
let snapshot: Neighborhood | undefined;
let selectedNoteId: string | undefined;
let history = [focus], cursor = 0;
const layouts = new Map<string, LayoutState>();
let currentDocument: string | undefined;
let followActive = false;
const toolbar = new BrainToolbar(root, { vault: '知识库', renderIcon, run: action => {
  if (action === 'back' || action === 'next') travel(action === 'back' ? -1 : 1);
  else if (action === 'search') pick(graph.all().map(note => ({...note, zone: 'outer', groupParents: []})), chooseFocus);
  else if (action === 'create') createNote();
  else if (action === 'follow') { followActive = !followActive; if (followActive && currentDocument) chooseFocus(currentDocument); render(); }
  else void relations[action]().catch(showError);
}});
function createNote(): void {
  const dialog = makeDialog('新建笔记'); dialog.classList.add('brain-new-note-modal'); const input = document.createElement('input'); input.placeholder = '笔记名称';
  dialog.append(input); const create = document.createElement('button'); create.textContent = '创建';
  create.onclick = () => {
    const title = input.value.trim();
    void relations.createRelative('/', 'child', title, `# ${title}\n`).then(() => dialog.close()).catch(showError);
  }; dialog.append(create); input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); create.click(); } }); input.focus();
}
const theme = document.createElement('button'); theme.className = 'brain-button'; theme.type = 'button';
theme.setAttribute('aria-label', '切换浅色或深色'); theme.title = '切换浅色或深色'; renderIcon(theme, 'sun-moon');
theme.onclick = () => document.documentElement.classList.toggle('light'); toolbar.element.append(theme);
const rootBar = new BrainRootBar(toolbar.rootHost, toolbar.menu, {
  home: () => { if (globalRoot) chooseFocus(globalRoot); },
  choose: () => chooseFocus('/'),
  renderIcon,
});
const workspace = document.createElement('div'); workspace.className = 'demo-workspace'; root.append(workspace);
const stage = document.createElement('div'); stage.className = 'brain-stage'; workspace.append(stage);
const editor = document.createElement('aside'); editor.className = 'demo-editor'; editor.hidden = true; workspace.append(editor);
const status = document.createElement('div'); status.className = 'brain-status'; status.setAttribute('role', 'status'); root.append(status);
function makeDialog(title: string): HTMLDialogElement {
  const dialog = document.createElement('dialog'); dialog.className = 'demo-dialog';
  const heading = document.createElement('h2'); heading.textContent = title; dialog.append(heading);
  const close = document.createElement('button'); close.textContent = '关闭'; close.className = 'demo-close'; close.onclick = () => dialog.close(); dialog.append(close);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); return dialog;
}
function pick(nodes: GraphNode[], select: (id: string) => void, title = '选择笔记'): void {
  const dialog = makeDialog(title); const input = document.createElement('input'); input.placeholder = '搜索标题或路径'; dialog.append(input);
  const list = document.createElement('div'); list.className = 'demo-list'; dialog.append(list);
  const render = () => {
    list.replaceChildren(); for (const note of nodes.filter(node => `${node.title} ${node.id}`.includes(input.value))) {
      const item = document.createElement('button'); item.textContent = `${note.title} · ${note.id}`;
      item.onclick = () => {dialog.close(); select(note.id);}; list.append(item);
    }
  }; input.oninput = render; render(); input.focus();
}
function openNote(id: string): void {
  if (graph.get(id)?.kind !== 'note') {chooseFocus(id); return;}
  currentDocument = id; editor.hidden = false; editor.replaceChildren();
  const close = document.createElement('button'); close.textContent = '收起'; close.onclick = () => {editor.hidden = true; currentDocument = undefined;}; editor.append(close);
  const title = document.createElement('h2'); title.textContent = graph.get(id)!.title; editor.append(title);
  const label = document.createElement('p'); label.textContent = '示例笔记 · 内部链接写入正文'; editor.append(label);
  const pre = document.createElement('pre'); pre.textContent = contents.get(id) ?? ''; editor.append(pre);
  if (followActive && focus !== id) chooseFocus(id);
}
function chooseFocus(id: string): void {
  if (id === focus) return; layouts.set(focus, canvas.getLayout()); focus = id; selectedNoteId = undefined;
  history = [...history.slice(0, cursor + 1), id]; cursor = history.length - 1; render();
}
function travel(step: number): void {
  const next = history[cursor + step]; if (!next) return; layouts.set(focus, canvas.getLayout()); cursor += step; focus = next; render();
}
function chooseRelation(source: string, target: string): void {
  const dialog = makeDialog('定义关系');
  for (const [kind, label] of [['parent', '父级'], ['child', '子级'], ['jump', '跳转关联']] as const) {
    if ((kind === 'parent' && graph.get(target)?.kind !== 'folder') || (kind === 'child' && graph.get(source)?.kind === 'note') || (kind === 'jump' && (graph.get(source)?.kind !== 'note' || graph.get(target)?.kind !== 'note'))) continue;
    const item = document.createElement('button'); item.textContent = `将“${graph.get(target)!.title}”设为“${graph.get(source)!.title}”的${label}`;
    item.onclick = () => {dialog.close(); void apply({focus: source, target, kind});}; dialog.append(item);
  }
}
function showError(error: unknown): void { status.textContent = error instanceof Error ? error.message : String(error); }
async function apply(request: RelationRequest): Promise<void> {
  try {await relations.apply(request); render();} catch (error) {showError(error);}
}
const canvas = new GraphCanvas(stage, {
  renderIcon,
  onNewNote: createNote,
  onFocus: chooseFocus, onOpen: openNote, onDrop: request => {void apply(request);}, onConnect: chooseRelation,
  onCreate: (source, kind, point) => {
    const parents = kind === 'sibling' ? graph.parents(source).map(id => ({id, title: graph.get(id)?.title ?? id})) : [];
    if (kind === 'sibling' && !parents.length) { status.textContent = '请先为中心笔记建立父级，再整理同级。'; return; }
    const rect = stage.getBoundingClientRect();
    const creator = new NodeCreator(stage, {
      anchor: {x: point.x - rect.left, y: point.y - rect.top},
      sourceTitle: graph.get(source)?.title ?? source, kind,
      notes: graph.all().filter(note => note.id !== source && note.kind !== 'root' && (kind !== 'parent' || note.kind === 'folder') && (kind !== 'jump' || note.kind === 'note')).map(note => ({id: note.id, title: note.title})),
      confirm: request => {
        creator.destroy();
        const operation = request.existing
          ? relations.apply({focus: source, target: request.existing, kind})
          : relations.createRelative(source, kind, request.name ?? '', request.details?.body ?? '');
        void operation.then(() => chooseFocus(source)).catch(showError);
      },
      cancel: () => creator.destroy(),
    });
  },
  onLayout: state => {
    layouts.set(focus, state);
  }, onOverflow: nodes => pick(nodes, chooseFocus),
  onContext: (id, event) => {
    event.preventDefault(); const dialog = makeDialog(graph.get(id)!.title);
    const open = document.createElement('button'); open.textContent = '打开笔记'; open.onclick = () => {dialog.close(); openNote(id);}; dialog.append(open);
    if (id !== focus) {
      for (const kind of ['parent', 'child', 'jump'] as RelationKind[]) {
        const item = document.createElement('button'); item.textContent = `设为中心的${{parent: '父级', child: '子级', jump: '关联'}[kind]}`;
        item.onclick = () => {dialog.close(); void apply({focus, target: id, kind});}; dialog.append(item);
      }
      for (const parent of graph.parents(focus)) {
        const item = document.createElement('button'); item.textContent = `设为同级：归入 ${graph.get(parent)!.title}`;
        item.onclick = () => { dialog.close(); void apply({focus, target: id, kind: 'sibling'}); }; dialog.append(item);
      }
    }
  },
});
function render(): void {
  snapshot = graph.neighborhood(focus, 200, selectedNoteId, globalRoot);
  canvas.render(snapshot, layouts.get(focus));
  rootBar.update({path: globalRoot, title: globalRoot ? graph.get(globalRoot)?.title : undefined});
  canvas.select(selectedNoteId, false);
  toolbar.buttons.undo.disabled = !relations.canUndo; toolbar.buttons.redo.disabled = !relations.canRedo;
  toolbar.buttons.back.disabled = cursor <= 0; toolbar.buttons.next.disabled = cursor >= history.length - 1;
  toolbar.buttons.follow.setAttribute('aria-pressed', String(followActive));
  status.textContent = graphStatistics(graph);
  status.title = '交互演示 · 数据仅存于当前会话';
  if (currentDocument) openNote(currentDocument);
}
relations.subscribe(() => render());
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault(); toolbar.buttons.search.click();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault(); void (event.shiftKey ? relations.redo() : relations.undo()).catch(showError);
  }
});
render();
