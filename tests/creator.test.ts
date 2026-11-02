// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createPreview } from '../src/ui/canvas';
import { fuzzyScore, linkQuery, NodeCreator, type CreatorRequest } from '../src/ui/creator';

describe('createPreview', () => {
  it('describes the pending creation for the hint', () => {
    expect(createPreview('学习方法', 'child')).toBe('创建新笔记，设为「学习方法」的子级');
    expect(createPreview('学习方法', 'sibling')).toBe('创建新笔记，与「学习方法」归入同一父级');
  });
});

describe('fuzzyScore', () => {
  it('matches case-insensitively and rewards consecutive runs', () => {
    expect(fuzzyScore('', '任意')).toBe(0);
    expect(fuzzyScore('间隔', '间隔重复')).not.toBeNull();
    expect(fuzzyScore('JG', '间隔')).toBeNull();
    expect(fuzzyScore('间隔', '间隔重复')).toBeGreaterThan(fuzzyScore('隔间', '间隔重复') ?? -1);
    expect(fuzzyScore('learning', 'Learning Methods')).not.toBeNull();
    expect(fuzzyScore('lm', 'Learning Methods')).not.toBeNull();
  });
});

describe('linkQuery', () => {
  it('extracts the text after the last [[ and stops at ]]', () => {
    expect(linkQuery('间隔重复')).toBeUndefined();
    expect(linkQuery('[[学习')).toBe('学习');
    expect(linkQuery('请参见 [[知识/学习方法]]')).toBe('知识/学习方法');
    expect(linkQuery('[[a]] 还有 [[b')).toBe('b');
    expect(linkQuery('[[')).toBe('');
  });
});

describe('NodeCreator', () => {
  const notes = [
    {id: '知识/学习方法.md', title: '学习方法'},
    {id: '知识/间隔重复.md', title: '间隔重复'},
    {id: '记忆/记忆机制.md', title: '记忆机制'},
  ];

  function mount(kind: 'parent' | 'child' | 'sibling' = 'child') {
    const container = document.createElement('div');
    document.body.append(container);
    const confirm = vi.fn();
    const cancel = vi.fn();
    const creator = new NodeCreator(container, {
      anchor: {x: 200, y: 200}, sourceTitle: '学习方法', kind, notes, confirm, cancel,
    });
    return {container, creator, confirm, cancel};
  }
  const type = (creator: NodeCreator, value: string) => {
    const input = creator.element.querySelector<HTMLInputElement>('.brain-creator-input')!;
    input.value = value;
    input.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const keydown = (creator: NodeCreator, key: string) => {
    const input = creator.element.querySelector<HTMLInputElement>('.brain-creator-input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
  };
  const items = (creator: NodeCreator) => [...creator.element.querySelectorAll<HTMLElement>('.brain-creator-item')];

  it('creates a new note on Enter with a plain name', () => {
    const {creator, confirm, cancel} = mount();
    type(creator, '番茄工作法');
    keydown(creator, 'Enter');
    expect(confirm).toHaveBeenCalledWith({name: '番茄工作法', details: {icon: '', tags: [], body: ''}});
    expect(cancel).not.toHaveBeenCalled();
    expect(creator.element.isConnected).toBe(false);
  });

  it('offers existing notes once the input contains [[ and submits the selection', () => {
    const {creator, confirm} = mount();
    type(creator, '[[间隔');
    expect(items(creator).map(item => item.dataset.noteId)).toEqual(['知识/间隔重复.md']);
    keydown(creator, 'Enter');
    expect(confirm).toHaveBeenCalledWith({existing: '知识/间隔重复.md'});
  });

  it('matches plain names without brackets and lets the user choose an existing note', () => {
    const {creator, confirm} = mount();
    type(creator, '间隔');
    expect(items(creator).map(item => item.dataset.noteId)).toEqual(['知识/间隔重复.md']);
    keydown(creator, 'ArrowDown'); keydown(creator, 'Enter');
    expect(confirm).toHaveBeenCalledWith({existing: '知识/间隔重复.md'});
  });

  it('navigates matches with the arrow keys', () => {
    const {creator, confirm} = mount();
    type(creator, '[[');
    expect(items(creator)).toHaveLength(3);
    keydown(creator, 'ArrowDown');
    expect(items(creator)[1]!.classList.contains('is-selected')).toBe(true);
    keydown(creator, 'Enter');
    expect(confirm).toHaveBeenCalledWith({existing: '知识/间隔重复.md'});
  });

  it('refuses to create from an unmatched link query instead of guessing', () => {
    const {creator, confirm} = mount();
    type(creator, '[[不存在的笔记');
    expect(items(creator)).toHaveLength(0);
    keydown(creator, 'Enter');
    expect(confirm).not.toHaveBeenCalled();
    expect(creator.element.querySelector('.brain-creator-message')!.textContent).toContain('没有匹配');
  });

  it('chooses an existing note by clicking it', () => {
    const {creator, confirm} = mount();
    type(creator, '[[学习');
    const item = items(creator)[0]!;
    item.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, cancelable: true}));
    expect(confirm).toHaveBeenCalledWith({existing: '知识/学习方法.md'});
  });

  it('omits the chooser when a sibling has a single parent and still files it there', () => {
    const container = document.createElement('div');
    const confirm = vi.fn();
    const creator = new NodeCreator(container, {
      anchor: {x: 10, y: 10}, sourceTitle: '学习方法', kind: 'sibling',
      notes, confirm, cancel: () => {},
    });
    expect(creator.element.querySelector('.brain-creator-parents')).toBeNull();
    type(creator, '阅读系统');
    keydown(creator, 'Enter');
    expect(confirm).toHaveBeenCalledWith({name: '阅读系统', details: {icon: '', tags: [], body: ''}});
    creator.destroy();
  });

  it('cancels on Escape and cleans up its DOM', () => {
    const {creator, container, cancel} = mount();
    keydown(creator, 'Escape');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.brain-creator')).toBeNull();
  });

  it('ignores an empty Enter submission', () => {
    const {creator, confirm} = mount();
    keydown(creator, 'Enter');
    expect(confirm).not.toHaveBeenCalled();
    expect(creator.element.isConnected).toBe(true);
  });

  it('uses the source directory for sibling link picks without a parent override', () => {
    const {creator, confirm} = mount('sibling');
    type(creator, '[[间隔');
    keydown(creator, 'Enter');
    const request = confirm.mock.calls[0]![0] as CreatorRequest;
    expect(request.existing).toBe('知识/间隔重复.md');
    expect(request).not.toHaveProperty('parent');
  });
});
