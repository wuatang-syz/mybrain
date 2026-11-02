// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {WorldSettingsPanel} from '../src/world/panel';
import {defaultThemeConfig} from '../src/world/theme';
import {cityTheme} from '../src/world/themes/city';
import {universeTheme} from '../src/world/themes/universe';
import type {WorldThemeConfig, WorldThemeDefinition} from '../src/world/types';

function open(theme: WorldThemeDefinition = universeTheme, config: WorldThemeConfig = defaultThemeConfig(theme)) {
  const canvas = document.createElement('div');
  canvas.className = 'brain-knowledge-world';
  const stage = document.createElement('div');
  stage.append(canvas); document.body.append(stage);
  const handlers = {onChange: vi.fn(), onApply: vi.fn(), onCancel: vi.fn(), onRestoreDefaults: vi.fn(), onResetLayout: vi.fn()};
  const panel = new WorldSettingsPanel({mount: canvas, theme, config, levelName: '星系',
    targets: [{id: 'ai', title: 'AI', kind: 'group'}, {id: 'note', title: 'Agent', kind: 'note'}], ...handlers});
  panel.open();
  return {panel, canvas, handlers, config};
}
const controls = (panel: WorldSettingsPanel, selector: string) => [...panel.element.querySelectorAll<HTMLElement>(selector)];

describe('world settings drawer', () => {
  it('mounts inside the canvas instead of the document body', () => {
    const {panel, canvas} = open();
    expect(panel.element.parentElement).toBe(canvas);
    expect(document.body.contains(panel.element)).toBe(true);
    expect(panel.isOpen).toBe(true);
    panel.close();
    expect(canvas.querySelector('.brain-world-settings')).toBeNull();
    expect(panel.isOpen).toBe(false);
  });
  it('groups the appearance, layout and mapping sections with accessible controls', () => {
    const {panel} = open();
    expect([...panel.element.querySelectorAll('h3')].map(node => node.textContent)).toEqual(['外观', '布局', '对象']);
    const labelled = [...panel.element.querySelectorAll('input, select')]
      .filter(control => !control.getAttribute('aria-label') && !control.closest('label'));
    expect(labelled.map(control => control.className)).toEqual([]);
    expect(controls(panel, '.brain-world-range input').length).toBeGreaterThanOrEqual(2);
  });
  it('offers the level names of the current theme as built-in shapes', () => {
    const {panel} = open();
    const options = [...panel.element.querySelectorAll('.brain-world-shape')[0]!.querySelectorAll('option')].map(option => option.textContent);
    expect(options[0]).toBe('跟随层级（自动）');
    expect(options).toContain('星系');
    expect(options).toContain('行星');
    expect(options).toContain('浮岛·基地');
    // Duplicated shapes such as 点 stay selectable because options key off the ladder index.
    expect(options.filter(text => text === '点').length).toBe(3);
    panel.setTheme(cityTheme, defaultThemeConfig(cityTheme), [], '分区');
    const city = [...panel.element.querySelectorAll('.brain-world-shape')[0]!.querySelectorAll('option')].map(option => option.textContent);
    expect(city).toContain('分区');
    expect(city).toContain('地面街区网格');
  });
  it('previews appearance edits without mutating the stored configuration', () => {
    const {panel, handlers, config} = open();
    const background = panel.element.querySelector<HTMLInputElement>('input[type="color"]')!;
    background.value = '#123456';
    background.oninput?.(new Event('input'));
    expect(handlers.onChange).toHaveBeenCalledOnce();
    const preview = handlers.onChange.mock.calls[0]![0] as WorldThemeConfig;
    expect(preview.appearance.background).toBe('#123456');
    expect(config.appearance).toEqual({});
    expect(preview).not.toBe(config);
  });
  it('shows the theme specific appearance parameters', () => {
    const universe = open();
    expect(controls(universe.panel, '.brain-world-row').map(row => row.textContent).join(' ')).toContain('辉光');
    universe.panel.close();
    const city = open(cityTheme);
    const rows = controls(city.panel, '.brain-world-row').map(row => row.textContent).join(' ');
    expect(rows).toContain('地面');
    expect(rows).toContain('建筑配色');
    city.panel.close();
  });
  it('applies the draft, cancels it and routes both resets', () => {
    const {panel, handlers} = open();
    const background = panel.element.querySelector<HTMLInputElement>('input[type="color"]')!;
    background.value = '#ff8800';
    background.oninput?.(new Event('input'));
    const apply = controls(panel, 'button').find(button => button.textContent === '应用')!;
    apply.click();
    expect((handlers.onApply.mock.calls[0]![0] as WorldThemeConfig).appearance.background).toBe('#ff8800');
    controls(panel, 'button').find(button => button.textContent === '取消')!.click();
    expect(handlers.onCancel).toHaveBeenCalledOnce();
    controls(panel, 'button').find(button => button.textContent === '恢复主题默认')!.click();
    expect(handlers.onRestoreDefaults).toHaveBeenCalledOnce();
    const reset = panel.element.querySelector<HTMLButtonElement>('.brain-world-reset-layout')!;
    expect(reset.textContent).toBe('重置「星系」布局');
    reset.click();
    expect(handlers.onResetLayout).toHaveBeenCalledOnce();
  });
  it('records per object overrides for a group or a note', () => {
    const {panel, handlers} = open();
    const picker = panel.element.querySelector<HTMLSelectElement>('.brain-world-target')!;
    picker.value = 'note:note';
    picker.onchange?.(new Event('change'));
    const color = panel.element.querySelector<HTMLInputElement>('.brain-world-section:last-of-type input[type="color"]')!;
    color.value = '#00ff00';
    color.oninput?.(new Event('input'));
    const preview = handlers.onChange.mock.calls.at(-1)![0] as WorldThemeConfig;
    expect(preview.mapping.notes.note?.color).toBe('#00ff00');
    const clear = panel.element.querySelector<HTMLButtonElement>('.brain-world-clear')!;
    clear.click();
    const cleared = handlers.onChange.mock.calls.at(-1)![0] as WorldThemeConfig;
    expect(cleared.mapping.notes.note).toBeUndefined();
  });
});
