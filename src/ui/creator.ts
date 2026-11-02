import {noteFields, type NoteDetails} from './note-fields';
import type { NoteId, Point, RelationKind } from '../model/types';

export interface CreatorRequest { existing?: NoteId; name?: string; details?: NoteDetails }
export interface CreatorOptions {
  /** Position relative to the container's top-left corner, where the card should appear. */
  anchor: Point;
  sourceTitle: string;
  kind: RelationKind | 'sibling';
  /** Candidate notes offered when the input starts a link with "[[". */
  notes: { id: NoteId; title: string }[];
  confirm: (request: CreatorRequest) => void;
  cancel: () => void;
}

const kindLabels: Record<RelationKind | 'sibling', string> = { parent: '父级', child: '子级', jump: '跳转关联', sibling: '同级' };
const MAX_MATCHES = 8;

/** Case-insensitive subsequence score; consecutive and prefix matches rank higher. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, streak = 0, last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) { streak = 0; continue; }
    score += ti === last + 1 ? 2 + streak++ : 1;
    if (ti === 0) score += 3;
    last = ti;
    qi++;
  }
  return qi === q.length ? score : null;
}

/** The link query is the text after the last "[[", truncated at "]]". */
export function linkQuery(value: string): string | undefined {
  const marker = value.lastIndexOf('[[');
  if (marker === -1) return undefined;
  return value.slice(marker + 2).split(']]')[0]!.trim();
}

/** A small in-canvas composer: type a name to create, or "[[" to pick an existing note. */
export class NodeCreator {
  readonly element: HTMLDivElement;
  private readonly details: () => NoteDetails;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private matches: { id: NoteId; title: string }[] = [];
  private selected = 0;
  private done = false;

  constructor(private readonly container: HTMLElement, private readonly options: CreatorOptions) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'brain-creator';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', '创建笔记');
    const title = doc.createElement('div');
    title.className = 'brain-creator-title';
    title.textContent = options.kind === 'sibling'
      ? `创建新笔记，与「${options.sourceTitle}」归入同一父级`
      : `创建新笔记，设为「${options.sourceTitle}」的${kindLabels[options.kind]}`;
    if (options.kind === 'parent') title.textContent = `新建父文件夹，并移入「${options.sourceTitle}」`;
    this.element.append(title);
    this.input = doc.createElement('input');
    this.input.type = 'text';
    this.input.className = 'brain-creator-input';
    this.input.placeholder = '想法名称';
    this.input.setAttribute('aria-label', `新笔记名称，或以 [[ 开头搜索已有笔记，设为${kindLabels[options.kind]}`);
    this.list = doc.createElement('div');
    this.list.className = 'brain-creator-list';
    this.message = doc.createElement('div');
    this.message.className = 'brain-creator-message';
    this.element.append(this.input, this.list);
    this.details = noteFields(this.element);
    this.element.append(this.message);
    const hint = doc.createElement('div');
    hint.className = 'brain-creator-hint';
    hint.textContent = 'Enter 确认 · Esc 取消';
    this.element.append(hint);
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', event => this.onKeydown(event));
    // Pointerdown fires before blur, so choosing a match never counts as abandoning the field.
    this.list.addEventListener('pointerdown', event => {
      const item = (event.target as Element).closest<HTMLElement>('[data-note-id]');
      if (!item) return;
      event.preventDefault();
      this.finish({ existing: item.dataset.noteId });
    });
    this.element.addEventListener('focusout', event => { if (!this.done && !this.element.contains(event.relatedTarget as Node | null)) { this.done = true; this.destroy(); options.cancel(); } });
    this.element.addEventListener('brain-submit', () => this.submit());
    const save = doc.createElement('button'); save.type = 'button'; save.className = 'mod-cta'; save.textContent = '创建'; save.onclick = () => this.submit(); this.element.append(save);
    container.append(this.element);
    const rect = container.getBoundingClientRect();
    Object.assign(this.element.style, {
      left: `${Math.max(8, Math.min(Math.max(8, rect.width - 480), options.anchor.x - 180))}px`,
      top: `${Math.max(8, Math.min(Math.max(8, rect.height - 380), options.anchor.y + 18))}px`,
    });
    this.input.focus();
  }

  destroy(): void {
    this.done = true;
    this.element.remove();
  }

  private onInput(): void {
    const query = linkQuery(this.input.value) ?? this.input.value.trim();
    this.message.textContent = '';
    if (!query && linkQuery(this.input.value) === undefined) { this.matches = []; this.renderList(); return; }
    this.matches = this.options.notes
      .map(note => ({ note, score: fuzzyScore(query, `${note.title} ${note.id}`) }))
      .filter((item): item is { note: { id: NoteId; title: string }; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MATCHES)
      .map(item => item.note);
    this.selected = linkQuery(this.input.value) !== undefined ? 0 : -1;
    this.renderList();
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!this.matches.length) return;
      event.preventDefault();
      this.selected = (this.selected + (event.key === 'ArrowDown' ? 1 : -1) + this.matches.length) % this.matches.length;
      this.renderList();
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); this.submit(); }
  }

  private submit(): void {
    const value = this.input.value.trim();
    if (this.matches.length && this.selected >= 0) { this.finish({ existing: this.matches[this.selected]!.id }); return; }
    if (linkQuery(this.input.value) !== undefined) {
      this.message.textContent = '没有匹配的笔记；调整关键词，或删掉 [[ 直接输入新名称。';
      return;
    }
    if (value) this.finish({ name: value, details: this.details() });
  }

  private finish(request: CreatorRequest): void {
    if (this.done) return;
    this.done = true;
    this.destroy();
    this.options.confirm(request);
  }

  private close(): void {
    if (this.done) return;
    this.done = true;
    this.destroy();
    this.options.cancel();
  }


  private renderList(): void {
    this.list.replaceChildren();
    if (!this.matches.length) { this.list.classList.remove('is-active'); return; }
    this.list.classList.add('is-active');
    this.matches.forEach((note, index) => {
      const item = this.list.ownerDocument.createElement('button');
      item.type = 'button';
      item.className = `brain-creator-item${index === this.selected ? ' is-selected' : ''}`;
      item.dataset.noteId = note.id;
      const title = this.list.ownerDocument.createElement('span');
      title.textContent = note.title;
      const path = this.list.ownerDocument.createElement('span');
      path.className = 'brain-creator-path';
      path.textContent = note.id;
      item.append(title, path);
      this.list.append(item);
    });
  }
}
