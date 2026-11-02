// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {defaultShortcuts, loadShortcuts, matchShortcut, normalizeShortcut, shortcutConflict, shortcutFromEvent, shortcutLabel} from '../src/shortcuts';
import {BrainView} from '../src/ui/view';
import {loadBrainData} from '../src/settings';

function key(options: KeyboardEventInit, target: HTMLElement = document.createElement('canvas')): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {cancelable: true, ...options});
  Object.defineProperty(event, 'target', {value: target});
  return event;
}
describe('configurable canvas shortcuts', () => {
  it('migrates old settings and preserves custom and explicitly disabled bindings through persistence', () => {
    const data = loadBrainData({settings: {shortcuts: {search: 'Alt+k', child: '', open: 'bad key'}}});
    expect(data.settings.shortcuts.search).toBe('Alt+k');
    expect(data.settings.shortcuts.child).toBe('');
    expect(data.settings.shortcuts.open).toBe('Mod+Enter');
    expect(loadBrainData(JSON.parse(JSON.stringify(data))).settings.shortcuts).toEqual(data.settings.shortcuts);
    expect(loadShortcuts(null)).toEqual(defaultShortcuts());
  });
  it('matches Cmd on Mac and Ctrl on Windows, with exact modifiers', () => {
    const bindings = defaultShortcuts();
    expect(matchShortcut(key({key: 'f', metaKey: true}), bindings, true)).toBe('search');
    expect(matchShortcut(key({key: 'f', ctrlKey: true}), bindings, false)).toBe('search');
    expect(matchShortcut(key({key: 'f', ctrlKey: true}), bindings, true)).toBeUndefined();
    expect(matchShortcut(key({key: 'f', ctrlKey: true, altKey: true}), bindings, false)).toBeUndefined();
    expect(shortcutLabel('Mod+ArrowDown', true)).toBe('Cmd + ↓');
  });
  it('detects platform-equivalent conflicts and rejects invalid bindings', () => {
    expect(shortcutConflict(defaultShortcuts(), 'child', 'Ctrl+f', false)).toBe('搜索笔记');
    expect(shortcutConflict(defaultShortcuts(), 'child', 'Meta+f', true)).toBe('搜索笔记');
    expect(shortcutConflict(defaultShortcuts(), 'search', 'Mod+f', false)).toBeUndefined();
    expect(shortcutConflict(defaultShortcuts(), 'child', '', false)).toBeUndefined();
    for (const invalid of ['Mod+Ctrl+k', 'Escape', 'Tab', 'Enter', 'Ctrl+Ctrl+k', 2]) expect(normalizeShortcut(invalid)).toBeUndefined();
    expect(normalizeShortcut('Shift+Mod+k')).toBe('Mod+Shift+k');
  });
  it('does not intercept editable descendants, dialogs, IME or previously handled keys', () => {
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable=""><span></span></div>',
      '<div role="textbox"><span></span></div>', '<div role="dialog"><button></button></div>']) {
      const host = document.createElement('div'); host.innerHTML = html;
      const target = host.querySelector('span, button') ?? host.firstElementChild!;
      expect(matchShortcut(key({key: 'f', ctrlKey: true}, target as HTMLElement), defaultShortcuts(), false)).toBeUndefined();
    }
    expect(matchShortcut(key({key: 'f', isComposing: true}), defaultShortcuts(), false)).toBeUndefined();
    const handled = key({key: 'f'}); handled.preventDefault();
    expect(matchShortcut(handled, defaultShortcuts(), false)).toBeUndefined();
    expect(matchShortcut(key({key: 'f'}, document.createElement('button')), defaultShortcuts(), false)).toBeUndefined();
    expect(shortcutFromEvent(key({key: 'Process', keyCode: 229}), false)).toBeUndefined();
  });
  it('uses changed bindings immediately and does not retain cleared shortcuts or repeat writes', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const bindings = defaultShortcuts(), runShortcut = vi.fn();
    Object.assign(view, {brain: {data: {settings: {shortcuts: bindings}}}, runShortcut});
    bindings.child = 'Alt+c';
    view.handleShortcut(key({key: 'ArrowDown', ctrlKey: true}));
    expect(runShortcut).not.toHaveBeenCalled();
    view.handleShortcut(key({key: 'c', altKey: true}));
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('child');
    runShortcut.mockClear(); bindings.child = '';
    view.handleShortcut(key({key: 'c', altKey: true}));
    view.handleShortcut(key({key: 'n', ctrlKey: true, shiftKey: true, repeat: true}));
    expect(runShortcut).not.toHaveBeenCalled();
    view.handleShortcut(key({key: '=', repeat: true}));
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('zoomIn');
  });
  it('dispatches view operations and blocks them while a mutation or composer is active', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const canvas = {fit: vi.fn(), zoom: vi.fn(), toggleReferences: vi.fn(), referencesShown: vi.fn(() => false), createRelative: vi.fn()};
    const brain = {newNote: vi.fn(), runHistory: vi.fn()};
    Object.assign(view, {canvas, brain});
    view.runShortcut('fit'); view.runShortcut('zoomIn'); view.runShortcut('zoomOut'); view.runShortcut('create'); view.runShortcut('undo');
    expect(canvas.fit).toHaveBeenCalledOnce(); expect(canvas.zoom.mock.calls).toEqual([[1], [-1]]);
    Object.assign(view, {busy: true}); view.runShortcut('child');
    Object.assign(view, {busy: false, creator: {}}); view.runShortcut('child');
    expect(canvas.createRelative).not.toHaveBeenCalled();
  });
});
