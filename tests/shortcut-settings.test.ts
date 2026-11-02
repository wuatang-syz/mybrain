// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
import type BrainPlugin from '../src/main';
import {defaultShortcuts} from '../src/shortcuts';
vi.mock('obsidian', () => ({
  Platform: {isMacOS: false},
  Setting: class {
    el: HTMLElement;
    constructor(container: HTMLElement) {this.el = container.appendChild(document.createElement('section'));}
    setName(name: string) {this.el.setAttribute('aria-label', name); return this;}
    setHeading() {return this;}
    setDesc() {return this;}
    addButton(callback: (component: unknown) => void) {
      const el = this.el.appendChild(document.createElement('button'));
      const component = {setButtonText: (text: string) => {el.textContent = text; return component;}, onClick: (fn: () => void) => {el.onclick = fn; return component;}};
      callback(component); return this;
    }
    addText(callback: (component: unknown) => void) {
      const inputEl = this.el.appendChild(document.createElement('input'));
      const component = {inputEl, setValue: (value: string) => {inputEl.value = value; return component;}};
      callback(component); return this;
    }
  },
}));
import {renderShortcutSettings} from '../src/ui/shortcut-settings';

beforeEach(() => {
  document.body.replaceChildren();
  Object.assign(HTMLElement.prototype, {
    createEl(this: HTMLElement, tag: string, options: {text?: string}) {const el = document.createElement(tag); el.textContent = options.text ?? ''; this.append(el); return el;},
    createDiv(this: HTMLElement, options: {attr: Record<string, string>}) {const el = document.createElement('div'); for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, value); this.append(el); return el;},
    setText(this: HTMLElement, text: string) {this.textContent = text;},
  });
});
it('records, rejects conflicts, clears and restores bindings through the settings controls', () => {
  const brain = {data: {settings: {shortcuts: defaultShortcuts()}}, scheduleSave: vi.fn(), refreshViews: vi.fn()} as unknown as BrainPlugin;
  const redisplay = vi.fn();
  renderShortcutSettings(document.body, brain, redisplay);
  const row = document.querySelector<HTMLElement>('section[aria-label="搜索笔记"]')!;
  const input = row.querySelector('input')!;
  const press = (key: string, options: KeyboardEventInit) => {
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...options}));
  };
  press('k', {altKey: true});
  expect(brain.data.settings.shortcuts.search).toBe('Alt+k');
  expect(input.value).toBe('Alt + K');
  press('ArrowDown', {ctrlKey: true});
  expect(brain.data.settings.shortcuts.search).toBe('Alt+k');
  expect(row.nextElementSibling?.textContent).toContain('新增子级');
  press('Escape', {});
  expect(brain.data.settings.shortcuts.search).toBe('Alt+k');
  row.querySelectorAll('button')[0]!.click();
  expect(brain.data.settings.shortcuts.search).toBe('');
  expect(input.value).toBe('未设置');
  row.querySelectorAll('button')[1]!.click();
  expect(brain.data.settings.shortcuts.search).toBe('Mod+f');
  brain.data.settings.shortcuts.child = '';
  document.querySelector<HTMLButtonElement>('section[aria-label="恢复全部默认快捷键"] button')!.click();
  expect(brain.data.settings.shortcuts).toEqual(defaultShortcuts());
  expect(redisplay).toHaveBeenCalledOnce();
  expect(brain.scheduleSave).toHaveBeenCalledTimes(4);
});
