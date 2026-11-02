import {VAULT_ROOT} from './graph/directory';
import {renderLicense} from './licensing/ui';
import {loadMindMapSettings, type MindMapSettings} from './mind-map-settings';
import { App, PluginSettingTab, Setting } from 'obsidian';
import type BrainPlugin from './main';
import type { LayoutState, MapLayoutState, Point } from './model/types';
import { loadShortcuts, type ShortcutBindings } from './shortcuts';
import { renderShortcutSettings } from './ui/shortcut-settings';
import {migrateLegacyUniverse, sanitizeWorldState} from './world/theme';
import {sanitizeUniverse} from './world/legacy-universe';
import type {KnowledgeWorldState} from './world/types';

export interface BrainSettings { maxNodes: number; newNoteFolder: string; followActive: boolean; shortcuts: ShortcutBindings; mindMap: MindMapSettings }
export interface BrainData {
  licenseToken?: string;
  version: 4;
  globalRoot: string | null;
  mapLayout: MapLayoutState;
  /** Versioned knowledge world: theme, per theme configuration and per theme + level views. */
  knowledgeWorld: KnowledgeWorldState;
  /** Current map level, represented by the central observatory in the universe. */
  mapAttention: string | null;
  mapSelected: string | null;
  settings: BrainSettings;
  focus: string | null;
  history: string[];
  historyIndex: number;
  layouts: Record<string, LayoutState>;
}
export function loadBrainData(raw: unknown): BrainData {
  const data = raw && typeof raw === 'object' ? raw as Partial<BrainData> : {};
  const knowledgeWorld = sanitizeWorldState(data.knowledgeWorld);
  // The legacy three-dimensional state moves into the universe view once, and only when missing.
  migrateLegacyUniverse(knowledgeWorld, data.mapLayout?.universe);
  const migrating = data.version !== 4;
  return {
    version: 4,
    licenseToken: typeof data.licenseToken === 'string' && data.licenseToken.length <= 8192 ? data.licenseToken : '',
    globalRoot: VAULT_ROOT,
    mapLayout: sanitizeMapLayout(data.mapLayout),
    knowledgeWorld,
    mapAttention: typeof data.mapAttention === 'string' ? data.mapAttention : VAULT_ROOT,
    mapSelected: typeof data.mapSelected === 'string' ? data.mapSelected : null,
    settings: {
      maxNodes: Math.max(20, Math.min(200, Number(data.settings?.maxNodes) || 200)),
      newNoteFolder: typeof data.settings?.newNoteFolder === 'string' ? data.settings.newNoteFolder : '',
      followActive: data.settings?.followActive === true,
      shortcuts: loadShortcuts(data.settings?.shortcuts),
      mindMap: loadMindMapSettings(data.settings?.mindMap),
    },
    focus: typeof data.focus === 'string' ? data.focus : VAULT_ROOT,
    history: Array.isArray(data.history) ? data.history.filter((id): id is string => typeof id === 'string').slice(-100) : [],
    historyIndex: Number.isInteger(data.historyIndex) ? Number(data.historyIndex) : -1,
    layouts: sanitizeLayouts(migrating ? undefined : data.layouts),
  };
}
export function emptyMapLayout(): MapLayoutState {
  return {version: 2, nodes: {}, cards: {}};
}
/**
 * Card layouts are versioned: anything written before the card rewrite is dropped instead of
 * dragging the scattered old coordinates into the new packing.
 */
function sanitizeMapLayout(raw: unknown): MapLayoutState {
  const layout = emptyMapLayout();
  if (!raw || typeof raw !== 'object') return layout;
  const candidate = raw as Partial<MapLayoutState>;
  if (candidate.version !== 2) return layout;
  const points = (source: unknown, limit: number): Record<string, Point> => {
    const result: Record<string, Point> = {};
    if (!source || typeof source !== 'object') return result;
    for (const [id, point] of Object.entries(source as Record<string, Point>).slice(-limit)) {
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) result[id] = {x: point.x, y: point.y};
    }
    return result;
  };
  layout.nodes = points(candidate.nodes, 200);
  layout.cards = points(candidate.cards, 200);
  layout.universe = sanitizeUniverse(candidate.universe);
  const viewport = candidate.viewport;
  if (viewport && Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.scale)) {
    layout.viewport = {...viewport, scale: Math.max(.05, Math.min(3, viewport.scale))};
  }
  return layout;
}
function sanitizeLayouts(raw: unknown, minimumScale = .15): Record<string, LayoutState> {
  const layouts: Record<string, LayoutState> = {};
  if (!raw || typeof raw !== 'object') return layouts;
  for (const [key, value] of Object.entries(raw).slice(-30)) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Partial<LayoutState>;
    const positions: LayoutState['positions'] = {};
    for (const [id, point] of Object.entries(candidate.positions ?? {}).slice(0, 200)) {
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) positions[id] = {x: point.x, y: point.y};
    }
    const viewport = candidate.viewport;
    layouts[key] = {positions, pinned: Array.isArray(candidate.pinned) ? candidate.pinned.filter(id => typeof id === 'string' && id in positions) : []};
    if (Array.isArray(candidate.order)) layouts[key].order = [...new Set(candidate.order.filter((id): id is string => typeof id === 'string'))].slice(0, 200);
    if (candidate.windows && typeof candidate.windows === 'object') {
      layouts[key].windows = {};
      for (const zone of ['parent', 'child', 'sibling', 'jump'] as const) {
        const offset = candidate.windows[zone];
        if (typeof offset === 'number' && Number.isFinite(offset)) layouts[key].windows[zone] = Math.max(0, offset);
      }
      if (candidate.windowVersion === 3) layouts[key].windowVersion = 3;
      // Older child offsets used a leading-edge default; adopt centered columns once.
      else delete layouts[key].windows.child;
    }
    if (viewport && Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.scale)) {
      layouts[key].viewport = {...viewport, scale: Math.max(minimumScale, Math.min(3, viewport.scale))};
    }
  }
  return layouts;
}
export class BrainSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly brain: BrainPlugin) { super(app, brain); }
  display(): void {
    this.containerEl.empty();
    renderLicense(this.containerEl, this.brain);
    if (!this.brain.licensed) return;
    new Setting(this.containerEl).setName('知识库根节点')
      .setDesc('自动使用知识库名称；父子层级与真实文件夹一致。')
      .addButton(button => button.setButtonText('返回根节点').onClick(() => this.brain.chooseGlobalRoot()));
    new Setting(this.containerEl).setName('画布节点上限').setDesc('最多 200 个，超出部分可从画布的节点列表中搜索。')
      .addSlider(slider => slider.setLimits(20, 200, 20).setValue(this.brain.data.settings.maxNodes).setDynamicTooltip()
        .onChange(value => {this.brain.data.settings.maxNodes = value; this.brain.scheduleSave(); this.brain.refreshViews();}));
    new Setting(this.containerEl).setName('新笔记文件夹').setDesc('相对于当前知识库；留空时放在根目录。')
      .addText(text => text.setPlaceholder('例如：知识').setValue(this.brain.data.settings.newNoteFolder)
        .onChange(value => {this.brain.data.settings.newNoteFolder = value.trim(); this.brain.scheduleSave();}));
    new Setting(this.containerEl).setName('跟随当前笔记').setDesc('在编辑器打开笔记时，同时切换图谱中心。')
      .addToggle(toggle => toggle.setValue(this.brain.data.settings.followActive).onChange(value => {
        this.brain.data.settings.followActive = value; this.brain.scheduleSave(); this.brain.refreshViews();
      }));
    this.containerEl.createEl('p', {text: '父子关系来自真实文件夹；跳转关系来自 Obsidian 内部链接，新增关联写入笔记正文。'});
    renderShortcutSettings(this.containerEl, this.brain, () => this.display());
  }
}
