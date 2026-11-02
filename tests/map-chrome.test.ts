// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {BrainRootBar} from '../src/ui/root-bar';
import {BrainToolbar} from '../src/ui/toolbar';
import {BrainView} from '../src/ui/view';
import {GraphIndex} from '../src/graph';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {observe(): void {} unobserve(): void {} disconnect(): void {}} as unknown as typeof ResizeObserver;
}

const nodes = ['Root.md', 'A.md', 'B.md', 'Loose.md'];
const graphOf = () => ({
  get: (id: string) => nodes.includes(id) ? {id, title: id} : undefined,
  children: (id: string) => id === 'Root.md' ? ['A.md'] : id === 'A.md' ? ['B.md'] : [],
  jumps: () => [],
});

describe('knowledge map chrome', () => {
  it('keeps the live canvas attached across center changes and repeated selection renders', () => {
    const content = document.createElement('div'), stage = document.createElement('div'), status = document.createElement('div');
    Object.assign(status, {empty: () => status.replaceChildren(), createSpan: ({text}: {text: string}) => {const span = document.createElement('span'); span.textContent = text; status.append(span); return span;}});
    const canvasElement = document.createElement('canvas'); stage.append(canvasElement); content.append(stage, status); document.body.append(content);
    const observer = new MutationObserver(() => {}); observer.observe(content, {childList: true});
    const graph = new GraphIndex(['Root.md', 'A.md', 'B.md'].map((id, i, ids) => ({id, title: id,
      parents: i ? [ids[i - 1]!] : [], links: [], issues: []})));
    const mapCanvas = {element: canvasElement, expanded: new Set(), drawnNotes: new Set<string>(), snapshot: undefined,
      setBudget: vi.fn(), setLevel: vi.fn(), applyConfig: vi.fn(), endPreview: vi.fn(), beginPreview: vi.fn(), getView: vi.fn(() => ({camera: {x:0,y:32,z:42},target:{x:0,y:0,z:0},positions:{},expanded:[]})), render: vi.fn(), fit: vi.fn()};
    const view = Object.create(BrainView.prototype) as BrainView;
    Object.assign(view, {contentEl: content, stage, mapStage: stage, status, mapCanvas, mode: 'map',
      brain: {graph, data: {globalRoot: 'Root.md', mapAttention: 'Root.md', mapSelected: null, settings: {maxNodes: 200}}, scheduleSave: vi.fn()},
      syncFooter: vi.fn(), syncMapRootBar: vi.fn(), positionSearch: vi.fn()});
    const internal = view as unknown as {enterMapLevel(id: string): void; renderMap(): void};
    for (const id of ['A.md', 'B.md', 'Root.md']) {internal.enterMapLevel(id); internal.renderMap();}
    expect(mapCanvas.render).toHaveBeenCalledTimes(6);
    expect(mapCanvas.render.mock.calls.map(args => args[0].level?.id ?? null)).toEqual(['A.md', 'A.md', 'B.md', 'B.md', 'Root.md', 'Root.md']);
    expect(observer.takeRecords().flatMap(record => [...record.removedNodes])).not.toContain(stage);
    expect(canvasElement.isConnected).toBe(true);
    observer.disconnect(); content.remove();
  });
  it('anchors the shared search inside the map canvas and returns it to the toolbar', () => {
    const content = document.createElement('div'); content.className = 'brain-view';
    const toolbar = new BrainToolbar(content, {vault: '知识库', renderIcon: vi.fn(), run: vi.fn(), switchMode: vi.fn()});
    const map = document.createElement('div'); map.className = 'brain-map-native'; content.append(map);
    const view = Object.create(BrainView.prototype) as BrainView;
    Object.assign(view, {contentEl: content, toolbar});
    const internal = view as unknown as {positionSearch(host: HTMLElement): void};
    internal.positionSearch(map);
    expect(toolbar.buttons.search.parentElement).toBe(map);
    expect(toolbar.buttons.search.classList.contains('brain-graph-search')).toBe(true);
    toolbar.restoreSearch();
    expect(toolbar.buttons.search.classList.contains('brain-graph-search')).toBe(false);
    expect(toolbar.buttons.search.nextElementSibling).toBe(content.querySelector('.brain-modes'));
  });
  it('shows the map level in the top bar and switches levels from the breadcrumb', () => {
    const host = document.createElement('div'), details = document.createElement('details');
    const menu = details.appendChild(document.createElement('div')); menu.className = 'brain-more-menu';
    document.body.append(host, details);
    const rootBar = new BrainRootBar(host, menu, {home: vi.fn(), choose: vi.fn()});
    const enterMapLevel = vi.fn(), revealMapNote = vi.fn();
    const view = Object.create(BrainView.prototype) as BrainView;
    Object.assign(view, {brain: {data: {globalRoot: 'Root.md'}, graph: graphOf()}, rootBar, enterMapLevel, revealMapNote, render: vi.fn()});
    const internal = view as unknown as {syncMapRootBar(attention: string | null): void};
    internal.syncMapRootBar('B.md');
    expect(host.querySelector('.brain-root-home')?.textContent).toBe('Root.md');
    const parts = [...host.querySelectorAll<HTMLButtonElement>('button.brain-path-part')];
    expect(parts.map(part => part.textContent)).toEqual(['A.md', 'B.md']);
    expect(parts[1]!.getAttribute('aria-current')).toBe('page');
    parts[0]!.click();
    expect(enterMapLevel).toHaveBeenCalledWith('A.md');
    parts[1]!.click();
    expect(revealMapNote).toHaveBeenCalledWith('B.md', true);
    internal.syncMapRootBar('Loose.md');
    expect([...host.querySelectorAll('button.brain-path-part')].map(part => part.textContent)).toEqual(['Loose.md']);
    rootBar.destroy(); host.remove(); details.remove();
  });
  it('hangs the world theme, settings and motion icons under the search inside the canvas', () => {
    const content = document.createElement('div'); content.className = 'brain-view';
    const toolbar = new BrainToolbar(content, {vault: '知识库', renderIcon: vi.fn(), run: vi.fn(), switchMode: vi.fn()});
    const stage = document.createElement('div'), status = document.createElement('div');
    Object.assign(status, {empty: () => status.replaceChildren(), createSpan: ({text}: {text: string}) => {
      const span = document.createElement('span'); span.textContent = text; status.append(span); return span;
    }});
    content.append(toolbar.element, stage, status);
    const graph = new GraphIndex(['Root.md', 'A.md'].map((id, index) => ({id, title: id,
      parents: index ? ['Root.md'] : [], links: [], issues: []})));
    const canvasElement = document.createElement('div'); stage.append(canvasElement);
    const mapCanvas = {element: canvasElement, expanded: new Set<string>(), drawnNotes: new Set<string>(), snapshot: undefined,
      setBudget: vi.fn(), setLevel: vi.fn(), applyConfig: vi.fn(), endPreview: vi.fn(), beginPreview: vi.fn(), getView: vi.fn(() => ({camera: {x:0,y:32,z:42},target:{x:0,y:0,z:0},positions:{},expanded:[]})), setTheme: vi.fn(), clearPositions: vi.fn(),
      render: vi.fn(), fit: vi.fn(), motionOn: true, toggleMotion: vi.fn()};
    const view = Object.create(BrainView.prototype) as BrainView;
    Object.assign(view, {contentEl: content, stage, mapStage: stage, status, mapCanvas, mode: 'map', toolbar,
      brain: {graph, data: {globalRoot: 'Root.md', mapAttention: 'Root.md', mapSelected: null, settings: {maxNodes: 200},
        knowledgeWorld: undefined}, scheduleSave: vi.fn()},
      syncFooter: vi.fn(), syncMapRootBar: vi.fn(), positionSearch: vi.fn()});
    const internal = view as unknown as {renderMap(): void; setWorldTheme(id: string): void; toggleWorldPanel(): void;
      worldState(): {theme: string; themes: Record<string, unknown>}};
    internal.renderMap();
    // The shared top bar stays free of world controls; every view renders the same four slots.
    expect(toolbar.element.querySelector('.brain-world-actions')).toBeNull();
    expect([...toolbar.element.children]).toEqual([toolbar.rootHost, toolbar.buttons.search,
      toolbar.element.querySelector('.brain-modes'), toolbar.element.querySelector('.brain-more')]);
    const rail = canvasElement.querySelector<HTMLElement>('.brain-world-actions')!;
    expect(rail).not.toBeNull();
    expect([...rail.querySelectorAll<HTMLButtonElement>('.brain-world-action')].map(button => button.getAttribute('aria-label')))
      .toEqual(['切换世界主题（当前：知识宇宙）', '世界设置', '暂停动效']);
    rail.querySelectorAll<HTMLButtonElement>('.brain-world-action')[0]!.click();
    const options = [...rail.querySelectorAll<HTMLButtonElement>('.brain-world-theme-option')];
    expect(options.map(option => option.textContent)).toEqual(['知识宇宙', '知识城市']);
    options[1]!.click();
    expect(internal.worldState().theme).toBe('city');
    // The world canvas performs the resource swap itself; the host only passes the target theme.
    expect(mapCanvas.render.mock.calls.at(-1)![2].themeId).toBe('city');
    expect(mapCanvas.setLevel).toHaveBeenCalledWith('Root.md');
    // The canvas element is never replaced: theme switching swaps scene resources only.
    expect(stage.firstElementChild).toBe(canvasElement);
    const buttons = [...rail.querySelectorAll<HTMLButtonElement>('.brain-world-action')];
    buttons[1]!.click();
    expect(canvasElement.querySelector('.brain-world-settings')).not.toBeNull();
    expect(document.body.querySelector('.brain-world-settings')).toBeNull();
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
    // Applying the drawer closes it and keeps the single canvas mounted.
    canvasElement.querySelector<HTMLButtonElement>('.brain-world-settings-footer .mod-cta')!.click();
    expect(canvasElement.querySelector('.brain-world-settings')).toBeNull();
    expect(stage.firstElementChild).toBe(canvasElement);
    // The motion icon mirrors the canvas flag and asks the canvas to flip it.
    buttons[2]!.click();
    expect(mapCanvas.toggleMotion).toHaveBeenCalledOnce();
    expect(buttons[2]!.getAttribute('aria-label')).toBe('暂停动效');
    mapCanvas.motionOn = false;
    internal.renderMap();
    const motion = [...rail.querySelectorAll<HTMLButtonElement>('.brain-world-action')][2]!;
    expect(motion.getAttribute('aria-pressed')).toBe('false');
    expect(motion.getAttribute('aria-label')).toBe('开启动效');
  });
});
