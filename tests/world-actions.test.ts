// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {WorldActions, type WorldActionsOptions} from '../src/ui/world-actions';

const themes = [{id: 'universe', name: '知识宇宙'}, {id: 'city', name: '知识城市'}];

function mount(overrides: Partial<WorldActionsOptions> = {}) {
  const host = document.createElement('div');
  host.className = 'brain-knowledge-world';
  document.body.append(host);
  let theme = 'universe', motion = true, settings = false;
  const painted: string[] = [];
  const options: WorldActionsOptions = {
    renderIcon: (element, name) => {painted.push(name); element.append(document.createElement('svg'));},
    themes: () => themes, theme: () => theme,
    setTheme: vi.fn((id: string) => {theme = id;}),
    settingsOpen: () => settings, toggleSettings: vi.fn(() => {settings = !settings;}),
    motionOn: () => motion, toggleMotion: vi.fn(() => {motion = !motion;}),
    ...overrides,
  };
  const actions = new WorldActions(host, options);
  const buttons = [...actions.element.querySelectorAll<HTMLButtonElement>('.brain-world-action')];
  return {actions, host, options, buttons, painted,
    state: () => ({theme, motion, settings})};
}

describe('world icon rail', () => {
  it('stacks one icon button each for theme, settings and motion, mounted inside the canvas', () => {
    const {actions, host, buttons, painted} = mount();
    expect(actions.element.parentElement).toBe(host);
    expect(actions.element.getAttribute('aria-orientation')).toBe('vertical');
    // The rail itself carries no label: Obsidian tooltips every aria-label, and 世界操作 kept
    // surfacing between the icons. Only the buttons are labelled.
    expect(actions.element.hasAttribute('aria-label')).toBe(false);
    expect(actions.element.querySelector('.brain-world-themes')?.hasAttribute('aria-label')).toBe(false);
    expect(buttons.map(button => button.getAttribute('aria-label')))
      .toEqual(['切换世界主题（当前：知识宇宙）', '世界设置', '暂停动效']);
    expect(buttons.every(button => button.querySelector('.brain-world-action-glyph svg'))).toBe(true);
    // The world switch reads as a switch, not as a colour palette.
    expect(painted.slice(0, 3)).toEqual(['repeat', 'settings', 'pause']);
    // The rail never borrows the shared toolbar look, so the top bar stays identical everywhere.
    expect(buttons.some(button => button.classList.contains('brain-button'))).toBe(false);
    actions.destroy(); host.remove();
  });
  it('lists every theme in a menu, marks the current one and switches worlds from it', () => {
    const {actions, host, options, buttons, state} = mount();
    const [themeButton] = buttons;
    themeButton!.click();
    const list = [...actions.element.querySelectorAll<HTMLButtonElement>('.brain-world-theme-option')];
    expect(list.map(option => option.textContent)).toEqual(['知识宇宙', '知识城市']);
    expect(list.map(option => option.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(list[0]!.classList.contains('is-current')).toBe(true);
    expect(themeButton!.getAttribute('aria-expanded')).toBe('true');
    list[1]!.click();
    expect(options.setTheme).toHaveBeenCalledWith('city');
    expect(state().theme).toBe('city');
    // The list closes and the button reports the new world.
    expect(actions.element.querySelectorAll('.brain-world-theme-option')).toHaveLength(0);
    expect(themeButton!.getAttribute('aria-expanded')).toBe('false');
    actions.update();
    expect(themeButton!.getAttribute('aria-label')).toBe('切换世界主题（当前：知识城市）');
    actions.destroy(); host.remove();
  });
  it('closes the theme list on Escape, on a pointer outside and on a mode switch', () => {
    const {actions, host, buttons} = mount();
    const [themeButton] = buttons;
    themeButton!.click();
    actions.element.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(themeButton!.getAttribute('aria-expanded')).toBe('false');
    themeButton!.click();
    document.body.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    expect(themeButton!.getAttribute('aria-expanded')).toBe('false');
    themeButton!.click();
    actions.close();
    expect(themeButton!.getAttribute('aria-expanded')).toBe('false');
    actions.destroy(); host.remove();
  });
  it('reports the settings drawer with a pressed icon and toggles motion with pause and play', () => {
    const {actions, host, options, buttons, state, painted} = mount();
    const [, settingsButton, motionButton] = buttons;
    settingsButton!.click();
    expect(options.toggleSettings).toHaveBeenCalledOnce();
    expect(settingsButton!.getAttribute('aria-pressed')).toBe('true');
    expect(settingsButton!.getAttribute('aria-label')).toBe('关闭世界设置');
    settingsButton!.click();
    expect(settingsButton!.getAttribute('aria-pressed')).toBe('false');
    expect(settingsButton!.getAttribute('aria-label')).toBe('世界设置');
    expect(motionButton!.getAttribute('aria-pressed')).toBe('true');
    expect(motionButton!.getAttribute('aria-label')).toBe('暂停动效');
    motionButton!.click();
    expect(options.toggleMotion).toHaveBeenCalledOnce();
    expect(state().motion).toBe(false);
    expect(motionButton!.getAttribute('aria-pressed')).toBe('false');
    expect(motionButton!.getAttribute('aria-label')).toBe('开启动效');
    expect(painted.at(-1)).toBe('play');
    expect(motionButton!.querySelector('.brain-world-action-glyph svg')).not.toBeNull();
    actions.destroy(); host.remove();
  });
  it('leaves the canvas without its outside-click listener when the rail is destroyed', () => {
    const {actions, host} = mount();
    const removed = vi.spyOn(document, 'removeEventListener');
    actions.destroy();
    expect(host.querySelector('.brain-world-actions')).toBeNull();
    expect(removed).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    removed.mockRestore(); host.remove();
  });
});
