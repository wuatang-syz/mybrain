import {fuzzyScore} from './creator';
import {noteFields, type NoteDetails} from './note-fields';
import { App, FuzzySuggestModal, Modal, Setting, type FuzzyMatch } from 'obsidian';
import type { GraphNode, NoteRecord, RelationKind } from '../model/types';

export class NotePicker extends FuzzySuggestModal<Pick<NoteRecord, 'id' | 'title'>> {
  constructor(app: App, private readonly items: Pick<NoteRecord, 'id' | 'title'>[], private readonly choose: (id: string) => void,
    placeholder = '搜索笔记标题或路径…') { super(app); this.setPlaceholder(placeholder); }
  getItems(): Pick<NoteRecord, 'id' | 'title'>[] { return this.items; }
  getItemText(item: Pick<NoteRecord, 'id' | 'title'>): string { return `${item.title}  ${item.id}`; }
  renderSuggestion(match: FuzzyMatch<Pick<NoteRecord, 'id' | 'title'>>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({text: item.title, cls: 'brain-picker-title'});
    const folder = item.id.includes('/') ? item.id.slice(0, item.id.lastIndexOf('/')) : '';
    if (folder) element.createDiv({text: folder, cls: 'brain-picker-folder'});
    element.title = item.id;
  }
  onChooseItem(item: Pick<NoteRecord, 'id' | 'title'>): void { this.choose(item.id); }
}

export class NewNoteModal extends Modal {
  private name = '';
  private pending = false;
  constructor(app: App, private readonly create: (name: string, details: NoteDetails) => Promise<void>, private readonly initial?: NoteDetails & {name: string}, private readonly candidates: Pick<NoteRecord, 'id' | 'title'>[] = [], private readonly selectExisting?: (id: string) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.initial ? '编辑笔记' : '新建笔记');
    this.modalEl.addClass('brain-new-note-modal');
    const input = this.contentEl.createEl('input', {type: 'text', cls: 'brain-new-note-input', attr: {placeholder: '笔记名称', 'aria-label': '笔记名称'}});
    input.value = this.name = this.initial?.name ?? '';
    const details = noteFields(this.contentEl, this.initial);
    const matches = this.contentEl.createDiv({cls: 'brain-note-matches'});
    const error = this.contentEl.createDiv({cls: 'brain-issue'});
    const submit = async () => {
      if (this.pending) return;
      this.pending = true;
      try { await this.create(this.name, details()); this.close(); }
      catch (err) { error.setText(err instanceof Error ? err.message : String(err)); }
      finally { this.pending = false; }
    };
    this.contentEl.addEventListener('brain-submit', () => {void submit();});
    input.addEventListener('input', () => {
      this.name = input.value; matches.empty();
      if (!this.name.trim() || !this.selectExisting) return;
      this.candidates.map(note => ({note, score: fuzzyScore(this.name.trim(), `${note.title} ${note.id}`)}))
        .filter(item => item.score !== null).sort((a, b) => b.score! - a.score!).slice(0, 6).forEach(({note}) => {
          const button = matches.createEl('button', {text: note.title, cls: 'brain-note-match'});
          button.type = 'button'; button.onclick = () => {this.close(); this.selectExisting?.(note.id);};
        });
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) {event.preventDefault(); void submit();} });
    const actions = this.contentEl.createDiv({cls: 'brain-new-note-actions'});
    actions.createEl('button', {text: '取消'}).onclick = () => this.close();
    actions.createEl('button', {text: this.initial ? '保存' : '创建', cls: 'mod-cta'}).onclick = () => { void submit(); };
    input.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}

export const relationLabels: Record<RelationKind, string> = {parent: '父级', child: '子级', jump: '跳转关联'};
export function relationSentence(focus: string, target: string, kind: RelationKind): string {
  return kind === 'jump' ? `将“${target}”与“${focus}”设为跳转关联` : `将“${target}”设为“${focus}”的${relationLabels[kind]}`;
}
export class RelationModal extends Modal {
  constructor(app: App, private readonly focus: string, private readonly target: string,
    private readonly kinds: RelationKind[], private readonly select: (kind: RelationKind) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('定义关系');
    this.contentEl.createEl('p', {text: '父子关系调整真实目录；跳转关联添加笔记内部链接。'});
    for (const kind of this.kinds) {
      new Setting(this.contentEl).setName(relationSentence(this.focus, this.target, kind)).addButton(button =>
        button.setButtonText('建立关系')
          .onClick(() => {this.close(); this.select(kind);}));
    }
  }
  onClose(): void { this.contentEl.empty(); }
}
export function showOverflow(app: App, nodes: GraphNode[], choose: (id: string) => void): void {
  new NotePicker(app, nodes, choose, '搜索当前主题的更多节点…').open();
}
