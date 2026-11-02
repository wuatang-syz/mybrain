// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {BrainFooterControls} from '../src/ui/footer-controls';
import {BrainRootBar} from '../src/ui/root-bar';
import {BrainToolbar} from '../src/ui/toolbar';

const options = {vault: '知识库', renderIcon: vi.fn(), run: vi.fn()};
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {observe(): void {} unobserve(): void {} disconnect(): void {}} as unknown as typeof ResizeObserver;
}

describe('shared toolbar', () => {
  it('keeps note creation inside the more menu and out of the top row', () => {
    const host = document.createElement('div');
    const toolbar = new BrainToolbar(host, {...options, switchMode: vi.fn()});
    const create = toolbar.buttons.create;
    expect(create.textContent).toContain('新建笔记');
    expect(create.closest('.brain-more-menu')).toBe(toolbar.menu);
    expect(create.parentElement).toBe(toolbar.menu);
    expect([...toolbar.element.querySelectorAll(':scope > button')]).not.toContain(create);
    expect([...toolbar.element.children]).toEqual([toolbar.rootHost, toolbar.buttons.search, toolbar.element.querySelector('.brain-modes'), toolbar.element.querySelector('.brain-more')]);
  });
  it('returns the borrowed search control to its slot before the mode switch', () => {
    const host = document.createElement('div');
    const toolbar = new BrainToolbar(host, {...options, switchMode: vi.fn()});
    const graphControls = document.createElement('div');
    graphControls.className = 'graph-controls';
    document.body.append(graphControls);
    graphControls.append(toolbar.buttons.search);
    toolbar.buttons.search.classList.add('brain-graph-search');
    toolbar.restoreSearch();
    expect(toolbar.buttons.search.classList.contains('brain-graph-search')).toBe(false);
    expect(toolbar.buttons.search.nextElementSibling).toBe(toolbar.element.querySelector('.brain-modes'));
    graphControls.remove();
  });
});

describe('root bar', () => {
  it('does not expose a manual root switcher', () => {
    const host = document.createElement('div');
    const details = document.createElement('details');
    const menu = details.appendChild(document.createElement('div'));
    menu.className = 'brain-more-menu';
    host.append(details); document.body.append(host);
    const renderIcon = vi.fn((element: HTMLElement) => {element.append(document.createElement('svg'));});
    const choose = vi.fn();
    const rootBar = new BrainRootBar(host, menu, {home: vi.fn(), choose, renderIcon});
    expect(menu.querySelector('.brain-button')).toBeNull();
    expect(choose).not.toHaveBeenCalled();
    rootBar.destroy(); host.remove();
  });
});

describe('shared footer controls', () => {
  it('renders one zoom strip with the readout and reports every action', () => {
    const view = document.createElement('div');
    view.className = 'brain-view';
    const zoomOut = vi.fn(), zoomIn = vi.fn(), fit = vi.fn();
    const footer = new BrainFooterControls(view, {
      zoomOut, zoomIn, fit,
    });
    view.append(footer.element);
    const buttons = [...footer.element.querySelectorAll('button')];
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['缩小', '放大', '适应画布']);
    expect(footer.element.querySelector('.brain-zoom-value')?.textContent).toBe('100%');
    for (const button of buttons) button.click();
    expect(zoomOut).toHaveBeenCalledOnce(); expect(zoomIn).toHaveBeenCalledOnce(); expect(fit).toHaveBeenCalledOnce();
    footer.setZoom(137.4); expect(footer.element.querySelector('.brain-zoom-value')?.textContent).toBe('137%');
    footer.destroy(); expect(view.querySelector('.brain-footer-controls')).toBeNull();
  });
  it('omits the mode-specific toggle when the mode has none', () => {
    const view = document.createElement('div');
    const footer = new BrainFooterControls(view, {zoomOut: vi.fn(), zoomIn: vi.fn(), fit: vi.fn()});
    expect([...footer.element.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['缩小', '放大', '适应画布']);
  });
});
