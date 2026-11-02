import {VAULT_ROOT, joinPath, parentPath} from '../graph/directory';
import {renderLicense} from '../licensing/ui';
import {DirectoryDialog} from './directory-dialog';
import {directoryGraphData} from './native-graph/data';
import {loadMindMapSettings, type MindMapSettings} from '../mind-map-settings';
import {MindMapPanel} from './mind-map-panel';
import { assertNativeView, type NativeRegistry, type NativeView } from './native-graph/types';
import { graphStatistics, isolatedNotes } from './statistics';
import { ItemView, Menu, Platform, setIcon, stringifyYaml, type WorkspaceLeaf } from 'obsidian';
import type BrainPlugin from '../main';
import type { GraphEdge, LayoutState, Neighborhood, Point, RelationKind, RelationRequest } from '../model/types';
import { NativeGraphCanvas } from './native-graph';
import { KnowledgeWorldCanvas } from '../world/canvas';
import { buildKnowledgeSnapshot } from '../world/snapshot';
import { WorldSettingsPanel, type WorldPanelTarget } from '../world/panel';
import { levelName, newWorldState, removeWorldRefs, renameWorldRefs, resolveTheme, setTheme, themeConfig, themeOptions, viewKey } from '../world/theme';
import type { KnowledgeWorldState, WorldThemeConfig } from '../world/types';
import { NodeCreator, type CreatorRequest } from './creator';
import { NotePicker, RelationModal, showOverflow } from './dialogs';
import { rootPaths } from './navigation';
import { BrainToolbar, type BrainMode } from './toolbar';
import { BrainRootBar } from './root-bar';
import { BrainFooterControls } from './footer-controls';
import { WorldActions } from './world-actions';
import { matchShortcut, shortcutLabel, type ShortcutAction } from '../shortcuts';

export const VIEW_TYPE = 'obsidian-brain-view';
export class BrainView extends ItemView {
  private mode: BrainMode = 'mind';
  private mindPanel?: MindMapPanel;
  private mindSettingsButton?: HTMLButtonElement;
  private mapCanvas?: KnowledgeWorldCanvas;
  private mapStage?: HTMLElement;
  private worldPanel?: WorldSettingsPanel;
  private worldActions?: WorldActions;
  /** Live configuration preview while the settings drawer is open; only 应用 writes it. */
  private worldDraft?: WorldThemeConfig;
  private worldVisits: (string | null)[] = [];
  private worldVisitCursor = -1;
  private worldSelections = new Map<string, string | null>();
  private mapHistory: string[] = [];
  private mapCursor = -1;
  private graphClickTimer?: number;
  private graphView?: NativeView;
  private canvas: NativeGraphCanvas | undefined;
  private information?: HTMLElement;
  private informationTimer?: number;
  private status: HTMLElement | undefined;
  private stage: HTMLElement | undefined;
  private toolbar: BrainToolbar | undefined;
  private rootBar: BrainRootBar | undefined;
  private footer: BrainFooterControls | undefined;
  private neighborhood: Neighborhood | undefined;
  private focusId: string | null = null;
  private history: string[] = [];
  private cursor = -1;
  private unsubscribe: (() => void) | undefined;
  private frame: number | undefined;
  private closed = false;
  private displayedFocus: string | null = null;
  private busy = false;
  private undoButton: HTMLButtonElement | undefined;
  private redoButton: HTMLButtonElement | undefined;
  private backButton: HTMLButtonElement | undefined;
  private nextButton: HTMLButtonElement | undefined;
  private followButton: HTMLButtonElement | undefined;
  private creator: NodeCreator | undefined;
  private selectedNoteId?: string;

  constructor(leaf: WorkspaceLeaf, private readonly brain: BrainPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Brain'; }
  getIcon(): string { return 'brain-circuit'; }
  async onOpen(): Promise<void> {
    if (!this.brain.licensed) {this.contentEl.empty(); renderLicense(this.contentEl, this.brain); return;}
    this.closed = false;
    this.contentEl.empty(); this.contentEl.addClass('brain-view');
    this.toolbar = new BrainToolbar(this.contentEl, { vault: this.app.vault.getName(), renderIcon: setIcon, switchMode: graph => this.switchMode(graph), run: action => {
      if (action === 'back' || action === 'next') this.travel(action === 'back' ? -1 : 1);
      else if (action === 'search') this.search();
      else if (action === 'create') this.brain.newNote(this);
      else if (action === 'follow') {
        this.brain.data.settings.followActive = !this.brain.data.settings.followActive;
        this.brain.scheduleSave(); this.refresh();
      } else void this.brain.runHistory(action);
    }});
    const buttons = this.toolbar.buttons;
    this.backButton = buttons.back; this.nextButton = buttons.next; this.followButton = buttons.follow;
    this.undoButton = buttons.undo; this.redoButton = buttons.redo;
    const folderButton = this.toolbar.menu.createEl('button', {text: '新建文件夹', cls: 'brain-button'});
    folderButton.onclick = () => this.newFolder(this.mode === 'map' ? this.mapAttention() ?? VAULT_ROOT : this.focusId ?? VAULT_ROOT);
    const isolatedButton = this.toolbar.menu.createEl('button', {text: '查看孤立笔记', cls: 'brain-button'});
    isolatedButton.onclick = () => {
      const notes = isolatedNotes(this.brain.graph);
      if (notes.length) this.search(notes, '搜索孤立笔记…');
      else this.showInformation('当前没有孤立笔记。');
    };
    this.rootBar = new BrainRootBar(this.toolbar.rootHost, this.toolbar.menu, {
      home: () => {
        if (this.mode === 'map') { this.enterMapLevel(this.brain.data.globalRoot ?? this.mapAttention() ?? ''); return; }
        this.switchMode('mind'); if (this.brain.data.globalRoot) this.focus(this.brain.data.globalRoot);
      },
      choose: () => this.brain.chooseGlobalRoot(),
      renderIcon: setIcon,
    });
    this.stage = this.contentEl.createDiv({cls: 'brain-stage'});
    this.status = this.contentEl.createDiv({cls: 'brain-status', attr: {'role': 'status', 'aria-live': 'polite'}});
    this.footer = new BrainFooterControls(this.contentEl, {
      zoomOut: () => this.zoomCanvas(-1), zoomIn: () => this.zoomCanvas(1), fit: () => this.fitCanvas(),
    });
    this.information = this.contentEl.createDiv({cls: 'brain-information', attr: {role: 'status', 'aria-live': 'polite'}});
    // A restored view must not hold up the layout-ready event that starts migration.
    if (!this.app.workspace.layoutReady) {
      void this.initializeView().catch(error => this.brain.report(error));
      return;
    }
    await this.initializeView();
  }
  private async initializeView(): Promise<void> {
    await this.brain.ensureReady();
    if (this.closed) return;
    this.focusId = this.brain.data.focus;
    this.history = this.brain.data.history.filter(id => this.brain.graph.get(id));
    this.cursor = Math.min(this.history.length - 1, Math.max(-1, this.brain.data.historyIndex));
    if (!this.focusId || !this.brain.graph.get(this.focusId)) {
      const active = this.app.workspace.getActiveFile();
      const root = this.brain.data.globalRoot;
      this.focusId = root && this.brain.graph.get(root) ? root : active && this.brain.graph.get(active.path) ? active.path : this.brain.graph.all()[0]?.id ?? null;
    }
    if (this.focusId && this.history[this.cursor] !== this.focusId) {this.history = [this.focusId]; this.cursor = 0;}
    this.unsubscribe = this.brain.graph.subscribe(() => this.refresh());
    this.registerDomEvent(this.contentEl, 'keydown', event => this.handleShortcut(event), {capture: true});
    this.render();
  }
  handleShortcut(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.mindPanel) {
      event.preventDefault(); event.stopPropagation(); this.closeMindPanel(); return;
    }
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable=true], .brain-world-settings, .brain-mind-settings')) return;
    const action = matchShortcut(event, this.brain.data.settings.shortcuts, Platform.isMacOS);
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat || action === 'zoomIn' || action === 'zoomOut') this.runShortcut(action);
  }
  runShortcut(action: ShortcutAction): void {
    if (this.busy || this.creator) return;
    if (this.mode === 'map') {
      if (action === 'fit') {this.mapCanvas?.fit(); return;}
      if (action === 'zoomIn' || action === 'zoomOut') {this.mapCanvas?.zoom(action === 'zoomIn' ? 1 : -1); return;}
      if (action === 'open') {const id = this.brain.data.mapSelected; if (id) this.selectMapNote(id, true); return;}
      if (['parent', 'child', 'jump', 'sibling'].includes(action)) return;
    }
    switch (action) {
      case 'search': this.search(); break;
      case 'create': this.brain.newNote(this); break;
      case 'back': this.travel(-1); break;
      case 'next': this.travel(1); break;
      case 'home': {
        const root = this.brain.data.globalRoot;
        if (root && this.brain.graph.get(root)) this.focus(root);
        else this.brain.chooseGlobalRoot();
        break;
      }
      case 'open': if (this.focusId) void this.brain.openNote(this.focusId, this.leaf).catch(error => this.brain.report(error)); break;
      case 'undo': case 'redo': void this.brain.runHistory(action); break;
      case 'follow':
        this.brain.data.settings.followActive = !this.brain.data.settings.followActive;
        this.brain.scheduleSave(); this.refresh(); break;
      case 'fit': this.fitCanvas(); break;
      case 'zoomIn': this.zoomCanvas(1); break;
      case 'zoomOut': this.zoomCanvas(-1); break;
      case 'parent': this.canvas?.createRelative('top'); break;
      case 'child': this.canvas?.createRelative('bottom'); break;
      case 'jump': this.canvas?.createRelative('left'); break;
      case 'sibling': this.canvas?.createRelative('right'); break;
    }
  }
  /** Zoom and fit are owned by the shared footer, so every mode routes through here. */
  private zoomCanvas(direction: 1 | -1): void {
    if (this.mode === 'map') this.mapCanvas?.zoom(direction);
    else this.canvas?.zoom(direction);
  }
  private fitCanvas(): void {
    if (this.mode === 'map') this.mapCanvas?.fit();
    else this.canvas?.fit();
  }
  private updateMindSettings(settings: MindMapSettings): void {
    this.brain.data.settings.mindMap = loadMindMapSettings(settings);
    this.brain.scheduleSave();
    for (const view of this.brain.views()) view.syncMindSettings();
  }
  private syncMindSettings(): void {
    if (this.mode !== 'mind') return;
    const settings = loadMindMapSettings(this.brain.data.settings.mindMap);
    this.canvas?.applySettings(settings); this.mindPanel?.update(settings);
  }
  private closeMindPanel(): void {
    const wasOpen = !!this.mindPanel;
    this.mindPanel?.destroy(); this.mindPanel = undefined;
    this.mindSettingsButton?.setAttribute('aria-expanded', 'false');
    if (wasOpen) this.mindSettingsButton?.focus({preventScroll: true});
  }
  private mountMindSettings(): void {
    if (!this.stage || this.mode !== 'mind') return;
    if (this.mindSettingsButton?.isConnected) return;
    this.closeMindPanel();
    const button = this.stage.ownerDocument.createElement('button');
    button.type = 'button'; button.className = 'brain-button brain-mind-settings-button';
    button.setAttribute('aria-label', '导图设置'); button.setAttribute('aria-expanded', 'false'); button.title = '导图设置';
    setIcon(button, 'sliders-horizontal');
    button.onclick = () => {
      if (this.mindPanel) {this.closeMindPanel(); return;}
      this.closeCreator();
      this.mindPanel = new MindMapPanel(this.stage!, loadMindMapSettings(this.brain.data.settings.mindMap),
        settings => this.updateMindSettings(settings), () => this.closeMindPanel());
      button.setAttribute('aria-expanded', 'true');
    };
    this.stage.append(button); this.mindSettingsButton = button;
  }
  private undoHint(): string {
    const key = this.brain.data.settings.shortcuts.undo;
    return key ? `可在画布按 ${shortcutLabel(key, Platform.isMacOS)} 撤销。` : '可在更多操作中撤销。';
  }
  private isOuter(id: string): boolean {
    const visible = [...(this.neighborhood?.nodes ?? []), ...(this.neighborhood?.overflow ?? [])].find(node => node.id === id);
    if (visible) return visible.zone === 'outer';
    return false;
  }
  focus(id: string, openOuter = true): void {
    if (this.mode === 'map') {this.revealMapNote(id, openOuter); return;}
    if (this.isOuter(id)) {
      if (openOuter) void this.brain.openNote(id, this.leaf).catch(error => this.brain.report(error));
      return;
    }
    if (!this.brain.graph.get(id) || id === this.focusId) return;
    this.captureLayout();
    this.selectedNoteId = undefined;
    this.focusId = id;
    this.history = this.history.slice(0, this.cursor + 1); this.history.push(id);
    if (this.history.length > 100) this.history.shift();
    this.cursor = this.history.length - 1;
    this.saveNavigation(); this.refresh();
  }
  private travel(step: number): void {
    if (this.mode === 'map') {
      if (this.worldVisits?.length > 1) {
        const nextVisit = this.worldVisitCursor + step;
        if (nextVisit >= 0 && nextVisit < this.worldVisits.length) {this.worldVisitCursor = nextVisit; this.navigateWorld(this.worldVisits[nextVisit]!, false);}
        return;
      }
      let next = this.mapCursor + step;
      while (next >= 0 && next < this.mapHistory.length && !this.brain.graph.get(this.mapHistory[next]!)) next += step;
      if (next < 0 || next >= this.mapHistory.length) return;
      this.mapCursor = next;
      this.revealMapNote(this.mapHistory[next]!, true, {focus: true}); return;
    }
    let next = this.cursor + step;
    while (next >= 0 && next < this.history.length && (!this.brain.graph.get(this.history[next]!) || this.isOuter(this.history[next]!))) next += step;
    if (next < 0 || next >= this.history.length) return;
    this.captureLayout(); this.selectedNoteId = undefined; this.cursor = next; this.focusId = this.history[next]!;
    this.saveNavigation(); this.refresh();
  }
  private saveNavigation(): void {
    this.brain.data.focus = this.focusId; this.brain.data.history = [...this.history]; this.brain.data.historyIndex = this.cursor;
    this.brain.scheduleSave();
  }
  private captureLayout(): void {
    if (this.canvas && this.displayedFocus) this.saveLayout(this.displayedFocus, this.canvas.getLayout());
  }
  private saveLayout(id: string, state: LayoutState): void {
    delete this.brain.data.layouts[id]; this.brain.data.layouts[id] = state;
    const oldest = Object.keys(this.brain.data.layouts)[0];
    if (Object.keys(this.brain.data.layouts).length > 30 && oldest) delete this.brain.data.layouts[oldest];
    this.brain.scheduleSave();
  }
  refresh(): void {
    if (this.closed || this.frame !== undefined) return;
    this.frame = this.contentEl.win.requestAnimationFrame(() => {this.frame = undefined; this.render();});
  }
  private render(): void {
    if (this.closed || !this.stage || !this.status) return;
    if (this.mode === 'map') {this.renderMap(); return;}
    if (this.mode === 'graph') {
      if (this.undoButton) this.undoButton.disabled = !this.brain.relations.canUndo || this.busy;
      if (this.redoButton) this.redoButton.disabled = !this.brain.relations.canRedo || this.busy;
      this.positionSearch(this.graphView?.containerEl); this.graphView?.dataEngine.render(); this.rootBar?.update({path: VAULT_ROOT, title: this.brain.graph.get(VAULT_ROOT)?.title}); this.status.setText(graphStatistics(this.brain.graph)); return;}
    if (this.focusId) this.focusId = this.existingAncestor(this.focusId);
    const root = this.brain.data.globalRoot;
    const paths = rootPaths(this.brain.graph, root);
    const path = this.focusId ? paths.get(this.focusId) : undefined;
    this.rootBar?.setPath((path ?? (root ? [root] : [])).map(id => ({id, title: this.brain.graph.get(id)?.title ?? id})), this.focusId, id => this.focus(id));
    this.rootBar?.update({path: root, title: root ? this.brain.graph.get(root)?.title : undefined});
    this.undoButton!.disabled = !this.brain.relations.canUndo || this.busy;
    this.redoButton!.disabled = !this.brain.relations.canRedo || this.busy;
    this.backButton!.disabled = this.cursor <= 0;
    this.nextButton!.disabled = this.cursor >= this.history.length - 1;
    this.followButton!.setAttribute('aria-pressed', String(this.brain.data.settings.followActive));
    for (const [action, button] of Object.entries(this.toolbar?.buttons ?? {})) {
      const key = this.brain.data.settings.shortcuts[action as ShortcutAction];
      button.removeAttribute('title');
      button.setAttribute('aria-label', `${button.textContent ?? ''}${key ? `（${shortcutLabel(key, Platform.isMacOS)}）` : ''}`);
    }
    if (!this.focusId) {
      this.canvas?.destroy(); this.canvas = undefined; this.displayedFocus = null;
        this.stage.empty();
      const empty = this.stage.createDiv({cls: 'brain-empty'});
      setIcon(empty.createDiv({cls: 'brain-empty-icon'}), 'brain-circuit');
      empty.createEl('h2', {text: '从一个想法开始'});
      const actions = empty.createDiv({cls: 'brain-empty-actions'});
      actions.createEl('button', {text: '选择笔记', cls: 'mod-cta'}).onclick = () => this.search();
      actions.createEl('button', {text: '新建笔记'}).onclick = () => this.brain.newNote(this);
      this.status.setText(graphStatistics(this.brain.graph)); this.mountMindSettings(); return;
    }
    if (!this.canvas) {
      this.stage.empty();
      try { this.canvas = new NativeGraphCanvas(this.stage, this.app, this.leaf, {
        renderIcon: setIcon,
        onEdit: id => {void this.brain.editNote(id, this.leaf).catch(error => this.brain.report(error));},
        onFocus: id => this.focus(id), onOpen: id => {void this.brain.openNote(id, this.leaf).catch(error => this.brain.report(error));},
        onDrop: request => {void this.apply(request);}, onConnect: (source, target) => this.connect(source, target),
        onCreate: (source, kind, point) => this.openCreator(source, kind, point),
        onNewNote: () => this.brain.newNote(this),
        onEdgeContext: (edge, event) => this.edgeContext(edge, event),
        onContext: (id, event) => this.context(id, event),
        onLayout: state => {const id = this.canvas?.getFocus(); if (id) this.saveLayout(id, state);},
        onZoom: percent => this.footer?.setZoom(percent),
        onOverflow: nodes => showOverflow(this.app, nodes, id => this.focus(id)),
      }); } catch (error) {
        this.stage.empty();
        const unavailable = this.stage.createDiv({cls: 'brain-empty'});
        unavailable.createEl('h2', {text: '原生图谱暂不可用'});
        unavailable.createEl('p', {text: error instanceof Error ? error.message : String(error)});
        unavailable.createEl('button', {text: '重试'}).onclick = () => this.render();
        this.status.setText('Brain 需要 Obsidian 原生图谱支持。');
        return;
      }
    }
    this.mountMindSettings();
    this.syncMindSettings();
    this.positionSearch(this.canvas?.element);
    const snapshot = this.brain.graph.neighborhood(this.focusId, this.brain.data.settings.maxNodes, this.selectedNoteId, root);
    this.neighborhood = snapshot;
    this.rootBar?.update({path: root, title: root ? this.brain.graph.get(root)?.title : undefined});
    const changed = this.displayedFocus !== this.focusId;
    const state = changed ? this.brain.data.layouts[this.focusId] : this.canvas.getLayout();
    this.displayedFocus = this.focusId;
    this.canvas.render(snapshot, state);
    this.canvas.select(this.selectedNoteId, false);
    this.status.empty();
    const counts = this.status.createSpan({text: graphStatistics(this.brain.graph)});
    counts.onmouseenter = () => this.showInformation('统计整个知识库；孤立笔记没有连接其他笔记的入链或出链，目录父子关系不影响判定。');
    const issues = snapshot.nodes.flatMap(node => node.issues.map(issue => `${node.title}：${issue}`));
    if (issues.length) {
      const issue = this.status.createEl('button', {text: `${issues.length} 条链接提示`, cls: 'brain-issue'});
      issue.onclick = () => this.showInformation(issues.slice(0, 12).join('\n'), 12000);
    }
  }
  /** Missing or unreadable world data falls back to a fresh default state instead of failing. */
  private worldState(): KnowledgeWorldState {
    const data = this.brain.data;
    if (!data.knowledgeWorld) data.knowledgeWorld = newWorldState();
    return data.knowledgeWorld;
  }
  private worldThemeId(): string { return resolveTheme(this.worldState().theme).id; }
  /** Saves the camera, positions and expansion of the theme and level on screen. */
  private saveWorldView(): void {
    const canvas = this.mapCanvas;
    if (!canvas || canvas.isPreviewing) return;
    const state = this.worldState(), level = this.brain.data.mapAttention ?? null;
    canvas.setLevel(level);
    state.views[viewKey(this.worldThemeId(), level)] = canvas.getView();
    this.brain.scheduleSave();
  }
  /**
   * World chrome lives inside the world canvas, stacked under the shared search icon. The top bar
   * therefore keeps the same components in all three views: root slot, search, modes, more.
   */
  private buildWorldActions(): void {
    const canvas = this.mapCanvas;
    if (!canvas) return;
    if (this.worldActions?.element.parentElement !== canvas.element) {
      this.worldActions?.destroy();
      this.worldActions = new WorldActions(canvas.element, {
        renderIcon: setIcon,
        themes: () => themeOptions(),
        theme: () => this.worldThemeId(),
        setTheme: id => this.setWorldTheme(id),
        settingsOpen: () => !!this.worldPanel?.isOpen,
        toggleSettings: () => this.toggleWorldPanel(),
        motionOn: () => this.mapCanvas?.motionOn ?? true,
        motionLabels: () => {
          const copy = resolveTheme(this.worldThemeId()).copy;
          return {on: copy.motionOn, off: copy.motionOff};
        },
        // The canvas owns the flag; the shared 外观 · 动效 record stays the saved truth.
        toggleMotion: () => {this.closeWorldPanel(); this.mapCanvas?.toggleMotion();},
      });
    }
    this.worldActions.update();
  }
  private destroyWorldActions(): void {
    this.worldActions?.destroy(); this.worldActions = undefined;
  }
  private setWorldTheme(id: string): void {
    const state = this.worldState(), next = resolveTheme(id).id;
    if (state.theme === next) return;
    this.closeWorldPanel(); this.saveWorldView();
    setTheme(state, next);
    this.brain.scheduleSave();
    this.render();
  }
  private worldPanelTargets(): WorldPanelTarget[] {
    const snapshot = this.mapCanvas?.snapshot;
    if (!snapshot) return [];
    return [
      ...snapshot.groups.map(group => ({id: group.id, title: group.title, kind: 'group' as const})),
      ...snapshot.notes.map(note => ({id: note.id, title: note.title, kind: 'note' as const})),
    ];
  }
  private toggleWorldPanel(): void {
    if (this.worldPanel?.isOpen) { this.closeWorldPanel(); return; }
    const canvas = this.mapCanvas;
    if (!canvas) return;
    const theme = resolveTheme(this.worldThemeId()), state = this.worldState();
    const stored = themeConfig(state, theme.id);
    canvas.beginPreview();
    this.worldPanel = new WorldSettingsPanel({
      mount: canvas.element,
      theme,
      config: JSON.parse(JSON.stringify(stored)) as WorldThemeConfig,
      targets: this.worldPanelTargets(),
      levelName: levelName(theme, 1),
      // Live preview only; nothing is written to the knowledge data before 应用.
      onChange: draft => { this.worldDraft = draft; this.mapCanvas?.applyConfig(draft); },
      onApply: draft => {
        this.worldDraft = undefined;
        this.worldState().themes[theme.id] = draft;
        const view = canvas.endPreview(true);
        if (view) this.worldState().views[viewKey(theme.id, this.brain.data.mapAttention)] = view;
        this.worldPanel?.close();
        this.worldPanel = undefined;
        this.brain.scheduleSave();
        this.render();
      },
      onCancel: () => {this.closeWorldPanel();},
      onRestoreDefaults: () => { /* Reset remains inside the panel draft until applied. */ },
      onResetLayout: () => {canvas.clearPositions();},
    });
    this.worldPanel.open();
  }
  private closeWorldPanel(): void {
    this.mapCanvas?.endPreview(false);
    this.worldPanel?.close();
    this.worldPanel = undefined;
    this.worldDraft = undefined;
    this.worldActions?.update();
  }
  /** The current map level is the central observatory and the top breadcrumb. */
  private existingAncestor(id: string): string {
    while (!this.brain.graph.get(id) && id !== VAULT_ROOT) id = parentPath(id) || VAULT_ROOT;
    return id;
  }
  private mapAttention(): string | null {
    const saved = this.brain.data.mapAttention;
    if (saved) return this.existingAncestor(saved);
    const root = this.brain.data.globalRoot;
    return root && this.brain.graph.get(root) ? root : null;
  }
  /** Shortest hierarchy parent: the level where a note becomes a card of its own. */
  private mapParent(id: string): string | null {
    const parents = this.brain.graph.parents(id);
    if (!parents.length) return null;
    const root = this.brain.data.globalRoot;
    const paths = root ? rootPaths(this.brain.graph, root) : new Map<string, string[]>();
    const depth = (path?: string[]) => path ? path.length : Number.MAX_SAFE_INTEGER;
    return parents.slice().sort((a, b) => depth(paths.get(a)) - depth(paths.get(b)) || (a < b ? -1 : a > b ? 1 : 0))[0]!;
  }
  private navigateWorld(id: string | null, record = true): void {
    if (id && !this.brain.graph.get(id)) return;
    this.closeWorldPanel();
    const current = this.brain.data.mapAttention ?? null;
    this.saveWorldView();
    this.worldSelections ??= new Map();
    this.worldSelections.set(viewKey(this.worldThemeId(), current), this.brain.data.mapSelected ?? null);
    this.worldVisits ??= [];
    if (record && current !== id) {
      if (!this.worldVisits.length) {this.worldVisits.push(current); this.worldVisitCursor = 0;}
      this.worldVisits = this.worldVisits.slice(0, this.worldVisitCursor + 1); this.worldVisits.push(id);
      if (this.worldVisits.length > 100) this.worldVisits.shift(); this.worldVisitCursor = this.worldVisits.length - 1;
    }
    this.brain.data.mapAttention = id;
    this.brain.data.mapSelected = this.worldSelections.get(viewKey(this.worldThemeId(), id)) ?? null;
    this.brain.scheduleSave(); this.render();
  }
  private enterMapLevel(id: string): void {this.navigateWorld(id);}
  private openMapCard(id: string): void {this.navigateWorld(id);}
  private backWorld(): void {
    if (this.worldVisitCursor > 0) {this.travel(-1); return;}
    const current = this.mapAttention();
    if (current) this.navigateWorld(this.mapParent(current) ?? this.brain.data.globalRoot);
  }
  /**
   * Selects a note from any entry point. When the note does not live in the current level the map
   * switches to the level that contains it, so search, the context menu and file-open follow all
   * land somewhere visible.
   */
  private revealMapNote(id: string, open: boolean, options: {focus?: boolean} = {}): void {
    if (!this.brain.graph.get(id)) return;
    const attention = this.mapAttention();
    const visible = id === attention || !!this.mapCanvas?.drawnNotes.has(id);
    let dirty = false;
    if (!visible) {
      const parent = this.mapParent(id);
      if (parent !== attention) {this.navigateWorld(parent); dirty = true;}
    }
    const changed = this.brain.data.mapSelected !== id;
    this.brain.data.mapSelected = id;
    if (changed) {
      this.mapHistory = (this.mapHistory ?? []).slice(0, (this.mapCursor ?? -1) + 1); this.mapHistory.push(id);
      if (this.mapHistory.length > 100) this.mapHistory.shift(); this.mapCursor = this.mapHistory.length - 1;
      dirty = true;
    }
    if (dirty) {this.brain.scheduleSave(); this.render();}
    if (options.focus) {if (!this.mapCanvas?.locate(id)) this.mapCanvas?.fit();}
    if (open) void this.brain.openMapNote(id, this.leaf).catch(error => this.brain.report(error));
  }
  private selectMapNote(id: string, open: boolean): void {
    if (!this.brain.graph.get(id)) return;
    const changed = this.brain.data.mapSelected !== id;
    this.brain.data.mapSelected = id;
    if (changed) {
      this.mapHistory = (this.mapHistory ?? []).slice(0, (this.mapCursor ?? -1) + 1); this.mapHistory.push(id);
      if (this.mapHistory.length > 100) this.mapHistory.shift(); this.mapCursor = this.mapHistory.length - 1;
      this.brain.scheduleSave(); this.render();
    }
    if (open) void this.brain.openMapNote(id, this.leaf).catch(error => this.brain.report(error));
  }
  private renderMap(): void {
    if (!this.stage || !this.status) return;
    if (!this.mapStage) this.mapStage = this.contentEl.createDiv({cls: 'brain-stage brain-map-stage'});
    // Keep the live WebGL canvas connected when changing the attention note.
    if (this.mapStage.nextElementSibling !== this.status) this.status.before(this.mapStage);
    const selected = this.brain.data.mapSelected && this.brain.graph.get(this.brain.data.mapSelected) ? this.brain.data.mapSelected : null;
    if (this.brain.data.mapSelected !== selected) this.brain.data.mapSelected = selected;
    this.followButton?.setAttribute('aria-pressed', String(this.brain.data.settings.followActive));
    if (this.undoButton) this.undoButton.disabled = !this.brain.relations.canUndo || this.busy;
    if (this.redoButton) this.redoButton.disabled = !this.brain.relations.canRedo || this.busy;
    if (this.backButton) this.backButton.disabled = this.mapCursor <= 0;
    if (this.nextButton) this.nextButton.disabled = this.mapCursor >= this.mapHistory.length - 1;
    const attention = this.mapAttention();
    if (this.brain.data.mapAttention !== attention) {this.brain.data.mapAttention = attention; this.brain.scheduleSave();}
    this.syncMapRootBar(attention);
    if (!this.brain.graph.all().length) {
      this.closeWorldPanel();
      this.destroyWorldActions();
      this.mapCanvas?.destroy(); this.mapCanvas = undefined; this.toolbar?.restoreSearch(); this.mapStage.empty();
      const empty = this.mapStage.createDiv({cls: 'brain-empty'});
      empty.createEl('h2', {text: '从一个想法开始'});
      empty.createEl('button', {text: '新建笔记', cls: 'mod-cta'}).onclick = () => this.brain.newNote(this);
      this.status.empty(); this.status.createSpan({text: '知识世界'});
      return;
    }
    if (!this.mapCanvas) {
      this.mapStage.empty();
      try {
        const state = this.worldState(), themeId = this.worldThemeId();
        this.mapCanvas = new KnowledgeWorldCanvas(this.mapStage, {
          select: id => this.selectMapNote(id, false),
          open: id => this.selectMapNote(id, true),
          clear: () => {this.brain.data.mapSelected = null; this.brain.scheduleSave();},
          back: () => this.backWorld(),
          edit: id => {void this.brain.editNote(id, this.leaf).catch(error => this.brain.report(error));},
          context: (id, event) => this.context(id, event),
          enter: id => this.openMapCard(id),
          save: () => this.saveWorldView(),
          onExpanded: () => this.renderMap(),
          error: message => this.showInformation(`知识世界绘制失败：${message}`, 12000),
          onZoom: percent => this.footer?.setZoom(percent),
          motion: on => {themeConfig(state, this.worldThemeId()).appearance.motion = on; this.brain.scheduleSave();},
          icon: setIcon,
        }, {budget: this.brain.data.settings.maxNodes}, themeId,
          JSON.parse(JSON.stringify(themeConfig(state, themeId))) as WorldThemeConfig);
      } catch (error) {
        this.mapStage.empty();
        const unavailable = this.mapStage.createDiv({cls: 'brain-empty'});
        unavailable.createEl('h2', {text: '知识世界暂不可用'});
        unavailable.createEl('p', {text: error instanceof Error ? error.message : String(error)});
        unavailable.createEl('button', {text: '重试'}).onclick = () => this.renderMap();
        return;
      }
    }
    this.buildWorldActions();
    const theme = resolveTheme(this.worldThemeId());
    this.mapCanvas.setBudget(this.brain.data.settings.maxNodes);
    this.positionSearch(this.mapCanvas?.element);
    this.mapCanvas.setLevel(attention ?? null);
    const built = buildKnowledgeSnapshot(this.brain.graph, {attention, root: this.brain.data.globalRoot, selected},
      {expanded: this.mapCanvas.expanded, budget: this.brain.data.settings.maxNodes});
    this.mapCanvas.setLevel(attention ?? null);
    this.mapCanvas.render(built.snapshot, this.brain.data.mapSelected ?? undefined,
      {state: this.worldState(), themeId: theme.id, level: attention ?? null});
    if (this.worldDraft) this.mapCanvas.applyConfig(this.worldDraft);
    const scope = attention ? this.brain.graph.get(attention)?.title ?? attention : '全部知识';
    const stats = built.snapshot.stats;
    const counts = stats.hidden > 0
      ? `显示 ${stats.drawn} / ${stats.total} 个节点 · 另有 ${stats.hidden} 个可展开`
      : `${stats.total} 个节点`;
    this.status.empty();
    this.status.createSpan({text: `${scope} · ${stats.groups} 个${levelName(theme, 1)} · ${counts} · ${graphStatistics(this.brain.graph)}`});
  }
  private switchMode(mode: BrainMode): void {
    this.closeMindPanel();
    this.mindSettingsButton?.remove(); this.mindSettingsButton = undefined;
    if (!this.stage) return;
    this.closeCreator();
    this.closeWorldPanel();
    // Search is normally moved into the native graph; rescue it before releasing that surface.
    this.toolbar?.restoreSearch();
    this.captureLayout();
    if (mode === 'graph') {this.canvas?.destroy(); this.canvas = undefined; this.displayedFocus = null;}
    this.destroyWorldActions();
    this.mapCanvas?.destroy(); this.mapCanvas = undefined;
    this.mapStage?.remove(); this.mapStage = undefined;
    this.mode = mode;
    this.contentEl.classList.toggle('is-knowledge-map', mode === 'map');
    if (mode === 'map') {
      this.canvas?.destroy(); this.canvas = undefined; this.displayedFocus = null;
      if (this.graphView) {this.graphView.unload(); void (this.graphView as unknown as {onClose(): Promise<void>}).onClose(); this.graphView.containerEl.remove(); this.graphView = undefined;}
      this.contentEl.classList.remove('is-full-graph'); this.stage.hidden = true;
      this.toolbar?.setMode(mode); this.render();
      if (!this.brain.data.mapAttention || !this.brain.graph.get(this.brain.data.mapAttention)) {
        this.brain.data.mapAttention = this.brain.data.globalRoot ?? null;
        this.brain.scheduleSave(); this.render();
      }
      const id = this.brain.data.mapSelected ?? this.focusId;
      if (!this.mapHistory.length && id) {this.mapHistory = [id]; this.mapCursor = 0;}
      if (id) this.revealMapNote(id, true);
      return;
    }
    const graph = mode === 'graph';
    if (!graph && this.graphView) {
      this.graphView.unload(); void (this.graphView as unknown as {onClose(): Promise<void>}).onClose();
      this.graphView.containerEl.remove(); this.graphView = undefined;
    }
    try {
      if (graph && !this.graphView) {
        const factory = (this.app as typeof this.app & NativeRegistry).viewRegistry?.viewByType?.graph;
        if (!factory) throw new Error('请先启用 Obsidian 的关系图谱核心插件。');
        const native = factory(this.leaf);
        this.graphView = native;
        assertNativeView(native);
        native.containerEl.addClass('brain-full-graph');
        native.headerEl.hide();
        this.stage.after(native.containerEl);
        const originalSetData = native.renderer.setData;
        const decorated = new WeakSet<object>();
        native.renderer.setData = data => {
          originalSetData.call(native.renderer, directoryGraphData(this.brain.graph, data));
          for (const node of native.renderer.nodes) if (!decorated.has(node)) {
            decorated.add(node); const render = node.render;
            node.render = () => {render.call(node); if (node.text) node.text.text = this.brain.graph.get(node.id)?.title ?? node.id;};
          }
        };
        native.renderer.onNodeRightClick = (event, id) => this.context(id, event);
        native.load();
        native.renderer.onNodeClick = (event, id) => {
          this.contentEl.win.clearTimeout(this.graphClickTimer);
          if (event.detail >= 2) void this.brain.editNote(id, this.leaf).catch(error => this.brain.report(error));
          else this.graphClickTimer = this.contentEl.win.setTimeout(() => {this.focusId = id; void this.brain.openNote(id, this.leaf).catch(error => this.brain.report(error));}, 250);
        };
      }
      this.contentEl.classList.toggle('is-full-graph', mode !== 'mind');
      this.stage.hidden = mode !== 'mind';
      if (this.graphView) {
        this.graphView.containerEl.hidden = !graph;
        if (graph) { this.graphView.renderer.onResize(); this.graphView.dataEngine.render(); }
      }
      if (!graph) this.canvas?.renderer.onResize();
      this.toolbar?.setMode(mode);
      this.render();
    } catch (error) {
      this.graphView?.unload(); this.graphView?.containerEl.remove(); this.graphView = undefined;
      this.showInformation(error instanceof Error ? error.message : String(error));
    }
  }
  showInformation(message: string, duration = 5000): void {
    if (!this.information) return;
    this.contentEl.win.clearTimeout(this.informationTimer);
    this.information.textContent = message;
    this.informationTimer = this.contentEl.win.setTimeout(() => {
      if (this.information) this.information.textContent = '';
    }, duration);
  }
  /**
   * Every canvas owns the search at its top-right. The native graph exposes a controls stack; the
   * knowledge map hides that stack, so the field anchors to the canvas surface itself.
   */
  private positionSearch(host: HTMLElement | null | undefined): void {
    const search = this.toolbar?.buttons.search;
    this.contentEl.querySelectorAll('.brain-search-controls').forEach(element => element.classList.remove('brain-search-controls'));
    if (!search) return;
    if (!host) { search.classList.remove('brain-graph-search'); return; }
    const controls = host.querySelector<HTMLElement>('.graph-controls');
    search.classList.add('brain-graph-search');
    // Re-renders keep the field where it is; only an actual change of surface moves it.
    if (controls) {
      controls.classList.add('brain-search-controls');
      if (search.parentElement !== controls.parentElement || search.nextElementSibling !== controls) controls.before(search);
    } else if (search.parentElement !== host) host.prepend(search);
  }
  /**
   * The map draws neither the attention note nor the root, so the shared top bar carries the level
   * path: ancestors switch level, the trailing chip selects the attention note itself.
   */
  private syncMapRootBar(attention: string | null): void {
    const root = this.brain.data.globalRoot;
    const paths = rootPaths(this.brain.graph, root);
    const path = attention ? paths.get(attention) : undefined;
    const items = (path ?? (root && this.brain.graph.get(root) ? [root] : []))
      .map(id => ({id, title: this.brain.graph.get(id)?.title ?? id}));
    if (attention && !items.some(item => item.id === attention)) {
      items.push({id: attention, title: this.brain.graph.get(attention)!.title});
    }
    this.rootBar?.setPath(items, attention, id => {
      if (id === attention) {this.revealMapNote(id, true); return;}
      this.enterMapLevel(id);
    });
    this.rootBar?.update({path: root, title: root ? this.brain.graph.get(root)?.title : undefined});
  }
  private search(items = this.brain.graph.all(), placeholder?: string): void { new NotePicker(this.app, items, id => {
    if (this.mode === 'map') this.revealMapNote(id, false, {focus: true});
    else this.focus(id);
  }, placeholder).open(); }
  selectNote(id: string): void {
    if (this.mode === 'map') {this.selectMapNote(id, false); return;}
    this.focus(id, false);
    this.selectedNoteId = id;
    this.render();
    this.canvas?.select(id);
  }
  private openCreator(source: string, kind: RelationKind | 'sibling', point: Point): void {
    this.closeCreator();
    const node = this.brain.graph.get(source);
    if (!node || (kind === 'child' && node.kind === 'note') || (kind === 'jump' && node.kind !== 'note')) return;
    const parents = kind === 'sibling'
      ? this.brain.graph.parents(source).map(id => ({id, title: this.brain.graph.get(id)?.title ?? id}))
      : [];
    if (kind === 'sibling' && !parents.length) { this.showInformation('请先为起点笔记建立父级，再整理同级。', 4000); return; }
    const rect = this.stage!.getBoundingClientRect();
    this.creator = new NodeCreator(this.mode === 'map' ? this.mapStage! : this.mode === 'graph' ? this.graphView!.containerEl : this.stage!, {
      anchor: { x: point.x - rect.left, y: point.y - rect.top },
      sourceTitle: this.brain.graph.get(source)?.title ?? source,
      kind,
      notes: this.brain.graph.all().filter(note => note.id !== VAULT_ROOT && (kind !== 'jump' || note.kind === 'note') && (kind !== 'parent' || note.kind === 'folder')).map(note => ({id: note.id, title: note.title})),
      confirm: request => { this.closeCreator(); void this.createFrom(source, kind, request); },
      cancel: () => this.closeCreator(),
    });
  }
  private closeCreator(): void {
    const wasOpen = !!this.creator;
    this.creator?.destroy(); this.creator = undefined;
    if (wasOpen) this.canvas?.element.focus({preventScroll: true});
  }
  private async createFrom(source: string, kind: RelationKind | 'sibling', request: CreatorRequest): Promise<void> {
    try {
      const target = request.existing;
      if (!target && request.name) {
        const details = request.details;
        const props = {...(details?.icon ? {icon: details.icon} : {}), ...(details?.tags.length ? {tags: details.tags} : {})};
        const content = Object.keys(props).length ? `---\n${stringifyYaml(props)}---\n${details?.body ?? ''}` : details?.body ?? '';
        const node = this.brain.graph.get(source)!;
        const folder = kind === 'child' ? node.path ?? '' : parentPath(node.path ?? '');
        new DirectoryDialog(this.app, kind === 'parent' ? '新建父文件夹' : '新建笔记', () =>
          `目标：${joinPath(folder, request.name!)}${kind === 'parent' ? '/' : '.md'}`,
          async () => {await this.brain.relations.createRelative(source, kind, request.name!, content); this.focus(this.existingAncestor(source));}).open();
        return;
      }
      if (!target) return;
      if (await this.apply({ focus: source, target, kind })) this.focus(source);
    } catch (error) { this.brain.report(error); }
  }
  private connect(source: string, target: string): void {
    if (source === target) return;
    new RelationModal(this.app, this.brain.graph.get(source)?.title ?? source, this.brain.graph.get(target)?.title ?? target,
      [...(this.brain.graph.get(target)?.kind === 'folder' ? ['parent' as const] : []), ...(this.brain.graph.get(source)?.kind !== 'note' ? ['child' as const] : []), ...(this.brain.graph.get(source)?.kind === 'note' && this.brain.graph.get(target)?.kind === 'note' ? ['jump' as const] : [])], kind => {void this.apply({focus: source, target, kind});}).open();
  }
  private async apply(request: RelationRequest, confirmed = false): Promise<boolean> {
    if (this.busy) return false;
    if (request.kind !== 'jump' && !confirmed) {
      new DirectoryDialog(this.app, '调整目录层级', () => this.brain.relations.describe(request), async () => {
        if (!await this.apply(request, true)) throw new Error('目录调整未完成，请检查上方提示。');
      }).open();
      return false;
    }
    this.busy = true; this.refresh();
    try {
      const changed = await this.brain.relations.apply(request);
      if (changed) {
        this.showInformation(`关系已更新，${this.undoHint()}`, 3500);
      } else this.showInformation('这条关系已经存在。', 2000);
      return true;
    } catch (error) {
      this.brain.report(error);
      return false;
    } finally {this.busy = false; this.refresh();}
  }
  private moveTo(id: string, folder?: string): void {
    if (!folder) {
      const items = this.brain.graph.all().filter(node => node.kind !== 'note' && node.id !== id && !node.id.startsWith(id + '/'));
      new NotePicker(this.app, items, target => this.moveTo(id, target), '移动到文件夹…').open(); return;
    }
    const node = this.brain.graph.get(id)!;
    new DirectoryDialog(this.app, '移动到文件夹', () => `目标：${joinPath(this.brain.graph.get(folder)?.path ?? '', node.path?.split('/').pop() ?? '')}`, async () => {
      await this.brain.relations.move(id, folder); this.refresh();
    }).open();
  }
  private newFolder(id = this.focusId ?? VAULT_ROOT): void {
    const node = this.brain.graph.get(id);
    const parent = node?.kind === 'note' ? parentPath(node.path!) || VAULT_ROOT : id;
    new DirectoryDialog(this.app, '新建文件夹', name => `目标：${joinPath(this.brain.graph.get(parent)?.path ?? '', name)}/`, async name => {
      await this.brain.relations.createFolder(parent, name); this.refresh();
    }, true).open();
  }
  private context(id: string, event: MouseEvent): void {
    const node = this.brain.graph.get(id); if (!node) return;
    const menu = new Menu();
    if (node.kind !== 'note') {
      menu.addItem(item => item.setTitle('进入文件夹').setIcon('folder-open').onClick(() => {
        if (this.mode === 'map') this.navigateWorld(id);
        else {if (this.mode === 'graph') this.switchMode('mind'); this.focus(id);}
      }));
      menu.addItem(item => item.setTitle('新建文件夹').setIcon('folder-plus').onClick(() => this.newFolder(id)));
    }
    if (node.kind !== 'note') menu.addItem(item => item.setTitle('新建子笔记').setIcon('file-plus').onClick(() => {
      const rect = this.stage?.getBoundingClientRect(); this.openCreator(id, 'child', {x: rect?.left ?? 0, y: rect?.top ?? 0});
    }));
    if (node.notePath || !node.kind) {
      menu.addItem(item => item.setTitle('打开笔记').setIcon('file-text').onClick(() => {
        if (this.mode === 'map') this.revealMapNote(id, true); else void this.brain.openNote(id, this.leaf).catch(error => this.brain.report(error));
      }));
      menu.addItem(item => item.setTitle('编辑笔记').setIcon('pencil').onClick(() => {void this.brain.editNote(id, this.leaf).catch(error => this.brain.report(error));}));
      menu.addItem(item => item.setTitle('添加跳转关联…').setIcon('link').onClick(() => {
        new NotePicker(this.app, this.brain.graph.all().filter(other => other.id !== id && !!other.notePath), target => {void this.apply({focus: id, target, kind: 'jump'});}).open();
      }));
    }
    if (node.kind !== 'root') {
      menu.addItem(item => item.setTitle('移动到文件夹…').setIcon('folder-input').onClick(() => this.moveTo(id)));
      if (node.parents[0] !== VAULT_ROOT) menu.addItem(item => item.setTitle('移到知识库根目录').onClick(() => this.moveTo(id, VAULT_ROOT)));
    }
    if (node.notePath || !node.kind) {
      menu.addSeparator();
      menu.addItem(item => item.setTitle('删除笔记（移至回收站）')
        .setIcon('trash-2').onClick(() => {void this.deleteNote(id);}));
    }
    menu.showAtMouseEvent(event);
  }
  private edgeContext(edge: GraphEdge, event: MouseEvent): void {
    const menu = new Menu();
    if (edge.kind === 'jump') {
      for (const [source, target] of [[edge.source, edge.target], [edge.target, edge.source]]) {
        const note = this.brain.graph.get(source!);
        if (!note?.links.includes(target!)) continue;
        menu.addItem(item => item.setTitle(`编辑来源：${note.title}`).setIcon('file-text')
          .onClick(() => {void this.brain.openNote(source!, this.leaf).catch(error => this.brain.report(error));}));
      }
    } else {
      menu.addItem(item => item.setTitle('移到知识库根目录').setIcon('folder-input')
        .onClick(() => this.moveTo(edge.target, VAULT_ROOT)));
    }
    menu.showAtMouseEvent(event);
  }
  private async deleteNote(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.closeCreator(); this.refresh();
    try {
      await this.brain.deleteNote(id);
      removeWorldRefs(this.brain.data.knowledgeWorld, path => !this.brain.graph.get(path));
      if (this.selectedNoteId === id) this.selectedNoteId = undefined;
      if (this.brain.data.mapAttention === id) this.brain.data.mapAttention = this.brain.data.globalRoot ?? null;
      if (this.focusId === id) {
        this.focusId = null;
        const next = this.brain.data.globalRoot ?? this.brain.graph.all()[0]?.id;
        if (next) this.focus(next);
      }
      this.history = this.history.filter(path => !!this.brain.graph.get(path));
      this.cursor = this.focusId ? this.history.lastIndexOf(this.focusId) : -1;
      this.saveNavigation();
      this.showInformation('笔记已移至回收站。');
    } catch (error) { this.brain.report(error); }
    finally { this.busy = false; this.refresh(); }
  }
  handleRename(from: string, to: string): void {
    const savedMap = this.brain.data.mapLayout;
    this.mapCanvas?.destroy(); this.mapCanvas = undefined; this.toolbar?.restoreSearch();
    this.destroyWorldActions();
    this.closeWorldPanel();
    this.brain.data.mapLayout = savedMap;
    const map = (path: string) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
    renameWorldRefs(this.brain.data.knowledgeWorld, map);
    if (this.focusId) this.focusId = map(this.focusId);
    if (this.displayedFocus) this.displayedFocus = map(this.displayedFocus);
    if (this.selectedNoteId) this.selectedNoteId = map(this.selectedNoteId);
    if (this.brain.data.mapAttention) this.brain.data.mapAttention = map(this.brain.data.mapAttention);
    this.mapHistory = this.mapHistory?.map(map) ?? [];
    this.history = this.history.map(map);
  }
  dispose(): void {
    // A restored activation-only view never loaded navigation; do not overwrite saved layouts.
    if (!this.brain.licensed) {this.closed = true; return;}
    this.closeMindPanel();
    this.mindSettingsButton?.remove(); this.mindSettingsButton = undefined;
    this.closeWorldPanel();
    this.destroyWorldActions();
    this.mapCanvas?.destroy(); this.mapCanvas = undefined;
    this.contentEl.win.clearTimeout(this.graphClickTimer);
    this.rootBar?.destroy();
    this.contentEl.win.clearTimeout(this.informationTimer);
    this.closed = true; this.captureLayout(); this.saveNavigation(); this.closeCreator();
    this.footer?.destroy(); this.footer = undefined;
    if (this.frame !== undefined) this.contentEl.win.cancelAnimationFrame(this.frame);
    this.frame = undefined; this.unsubscribe?.(); this.unsubscribe = undefined;
    this.canvas?.destroy(); this.canvas = undefined;
    if (this.graphView) { this.graphView.unload(); void (this.graphView as unknown as {onClose(): Promise<void>}).onClose(); this.graphView.containerEl.remove(); this.graphView = undefined; }
  }
  async onClose(): Promise<void> { this.dispose(); this.contentEl.empty(); }
}
