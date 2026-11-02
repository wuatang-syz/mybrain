import type {NoteDetails} from './ui/note-fields';
import {commerce} from './licensing/config';
import {verifyLicense} from './licensing/verify';
import {LicenseModal} from './licensing/ui';
import { Notice, Plugin, TFile, normalizePath, getFrontMatterInfo, parseYaml, stringifyYaml, type WorkspaceLeaf } from 'obsidian';
import { GraphIndex } from './graph';
import { VaultIndexer } from './obsidian/indexer';
import {migrateLegacyRelations} from './obsidian/migration';
import {DirectoryService} from './obsidian/directory-service';
import {VAULT_ROOT} from './graph/directory';
import { BrainSettingTab, loadBrainData, type BrainData } from './settings';
import { BrainView, VIEW_TYPE } from './ui/view';
import { NewNoteModal } from './ui/dialogs';
import { registerBrainCommands } from './commands';
import { findCompanionNote, initializeNoteSplit } from './ui/note-pane';
import { removeWorldRefs, renameWorldRefs } from './world/theme';

export default class BrainPlugin extends Plugin {
  licensed = false;
  showLicense(): void {new LicenseModal(this).open();}
  async saveLicense(token: string): Promise<void> {
    if (this.saveTimer) {clearTimeout(this.saveTimer); this.saveTimer = undefined;}
    await this.saves;
    const next = {...this.data, licenseToken: token};
    await this.saveData(next);
    this.data.licenseToken = token;
  }
  data!: BrainData;
  graph = new GraphIndex();
  relations!: DirectoryService;
  indexer!: VaultIndexer;
  private started = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saves = Promise.resolve();
  private destroyed = false;
  private noteLeaf: WorkspaceLeaf | undefined;
  private noteQueue: Promise<void> = Promise.resolve();
  private noteSplits = new WeakMap<object, object>();
  private worldRefsPruned = false;
  private ready: Promise<void> = Promise.resolve();
  async onload(): Promise<void> {
    this.data = loadBrainData(await this.loadData());
    this.licensed = !!await verifyLicense(this.data.licenseToken ?? '', commerce.publicKey);
    if (!this.licensed) {
      this.registerView(VIEW_TYPE, leaf => new BrainView(leaf, this));
      this.addRibbonIcon('brain-circuit', '购买或激活 TheMind', () => this.showLicense());
      this.addCommand({id: 'open-brain', name: '购买或激活 TheMind', callback: () => this.showLicense()});
      this.addSettingTab(new BrainSettingTab(this.app, this));
      return;
    }
    this.indexer = new VaultIndexer(this.app, this.graph, {onRename: (from, to) => this.onRename(from, to),
      onError: error => this.report(error), onReady: () => this.pruneWorldRefs()});
    this.relations = new DirectoryService(this.app, this.graph, this.indexer);
    // Let the host populate its link cache before deduplicating migrated references.
    this.ready = new Promise(resolve => this.app.workspace.onLayoutReady(() => {
      void migrateLegacyRelations(this.app, () => !this.destroyed).then(result => {
        if (result.errors.length && !this.destroyed) new Notice(`旧关系迁移未完成，以下笔记原文已保留：\n${result.errors.join('\n')}`, 15000);
      }).catch(error => this.report(error)).finally(resolve);
    }));
    this.registerView(VIEW_TYPE, leaf => new BrainView(leaf, this));
    this.addRibbonIcon('brain-circuit', '打开 Brain', () => {void this.openBrain();});
    this.addCommand({id: 'open-brain', name: '打开知识图谱', callback: () => {void this.openBrain();}});
    this.addCommand({id: 'focus-active-note', name: '以当前笔记为中心', callback: () => {
      const file = this.app.workspace.getActiveFile(); void this.openBrain(file?.extension === 'md' ? file.path : undefined);
    }});
    this.addCommand({id: 'new-brain-note', name: '新建笔记', callback: () => this.newNote()});
    this.addCommand({id: 'choose-global-root', name: '选择全局根节点', callback: () => this.chooseGlobalRoot()});
    this.addCommand({id: 'go-global-root', name: '回到全局根节点', callback: () => {
      void this.openBrain(VAULT_ROOT);
    }});
    this.addCommand({id: 'undo-relation', name: '撤销关系变更', callback: () => {void this.runHistory('undo');}});
    this.addCommand({id: 'redo-relation', name: '重做关系变更', callback: () => {void this.runHistory('redo');}});
    this.addSettingTab(new BrainSettingTab(this.app, this));
    registerBrainCommands(this);
    this.register(this.relations.subscribe(paths => {
      for (const path of paths) this.indexer.refresh(path);
      this.refreshViews();
    }));
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (file?.extension === 'md' && this.data.settings.followActive) {
        for (const view of this.views()) view.focus(file.path, false);
      }
    }));
  }
  async ensureReady(): Promise<void> {
    await this.ready;
    if (this.destroyed) return;
    if (this.started) return;
    this.started = true;
    this.indexer.start(ref => this.registerEvent(ref));
  }
  async openBrain(focus?: string): Promise<void> {
    await this.ensureReady();
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({type: VIEW_TYPE, active: true});
    await this.app.workspace.revealLeaf(leaf);
    if (focus && leaf.view instanceof BrainView) leaf.view.focus(focus);
  }
  views(): BrainView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(leaf => leaf.view).filter((view): view is BrainView => view instanceof BrainView);
  }
  refreshViews(): void { for (const view of this.views()) view.refresh(); }
  chooseGlobalRoot(after?: () => void): void {
    void this.openBrain(VAULT_ROOT).then(() => after?.());
  }
  setGlobalRoot(_id: string): void {this.chooseGlobalRoot();}
  notePath(id: string): string | undefined {
    const node = this.graph.get(id);
    return node ? node.notePath ?? (node.kind ? undefined : id) : id;
  }
  newNote(view?: BrainView): void { new NewNoteModal(this.app, async (name, details) => {
    if (!view) { await this.openBrain(); view = this.views()[0]; }
    const file = await this.createNote(name, details);
    view?.selectNote(file.path);
  }, undefined, this.graph.all().filter(note => !!note.notePath), id => {view?.focus(id); void this.openNote(id, view?.leaf).catch(error => this.report(error));}).open(); }
  async createNote(name: string, details?: NoteDetails): Promise<TFile> {
    await this.ensureReady();
    const title = name.trim().replace(/\.md$/i, '');
    if (!title || /[\\/:*?"<>|[\]#^]/.test(title) || [...title].some(char => char.charCodeAt(0) < 32) || title === '.' || title === '..' || /[. ]$/.test(title)) {
      throw new Error('请输入有效名称，不包含路径分隔符、链接符号或文件名保留字符。');
    }
    const folder = this.data.settings.newNoteFolder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const config = this.app.vault.configDir;
    if (folder.split('/').some(part => part === '..' || part === '.') || /[:*?"<>|]/.test(folder) || folder === config || folder.startsWith(`${config}/`)) {
      throw new Error('请在设置中填写知识库内的有效文件夹。');
    }
    const path = normalizePath(folder ? `${folder}/${title}.md` : `${title}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('该位置已经有同名笔记，请使用其他名称。');
    if (folder) {
      let current = '';
      for (const part of folder.split('/').filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
      }
    }
    const properties = details ? {...(details.icon ? {icon: details.icon} : {}), ...(details.tags.length ? {tags: details.tags} : {})} : {};
    const content = Object.keys(properties).length ? `---\n${stringifyYaml(properties)}---\n${details?.body ?? ''}` : details?.body ?? '';
    const file = await this.app.vault.create(path, content);
    this.indexer.refresh(file.path);
    return file;
  }
  async deleteNote(path: string): Promise<void> {
    path = this.notePath(path) ?? '';
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('笔记不存在，可能已被移动或删除。');
    await this.app.fileManager.trashFile(file);
    this.indexer.refresh(path);
    await this.indexer.settled();
    this.data.globalRoot = VAULT_ROOT;
    delete this.data.layouts[path];
    delete this.data.mapLayout.nodes[path];
    delete this.data.mapLayout.cards[path];
    if (this.data.mapLayout.universe) {
      delete this.data.mapLayout.universe.positions[path];
      if (this.data.mapLayout.universe.level === path) this.data.mapLayout.universe = undefined;
    }
    if (this.data.mapAttention === path) this.data.mapAttention = this.data.globalRoot;
    removeWorldRefs(this.data.knowledgeWorld, id => !this.graph.get(id));
    this.scheduleSave(); this.refreshViews();
  }
  /**
   * Knowledge world references are only pruned once the first scan is ready, so a slow index never
   * deletes configuration for notes that simply have not been read yet.
   */
  private pruneWorldRefs(): void {
    if (this.worldRefsPruned) return;
    this.worldRefsPruned = true;
    removeWorldRefs(this.data.knowledgeWorld, id => !this.graph.get(id));
    this.scheduleSave(); this.refreshViews();
  }
  async editNote(path: string, source?: WorkspaceLeaf): Promise<void> {
    path = this.notePath(path) ?? '';
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('笔记不存在。');
    await this.openNote(path, source);
    let original = await this.app.vault.read(file);
    const info = getFrontMatterInfo(original);
    const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('笔记属性格式无效，请先修复属性。');
    const properties = (parsed ?? {}) as Record<string, unknown>;
    const tags = Array.isArray(properties.tags) ? properties.tags.map(String) : typeof properties.tags === 'string' ? properties.tags.split(/[,，\s]+/).filter(Boolean) : [];
    new NewNoteModal(this.app, async (name, details) => {
      const title = name.trim().replace(/\.md$/i, '');
      if (!title || /[\\/:*?"<>|[\]#^]/.test(title) || [...title].some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(title)) throw new Error('请输入有效的笔记名称。');
      const target = normalizePath(`${file.parent?.path === '/' ? '' : file.parent?.path ? file.parent.path + '/' : ''}${title}.md`);
      if (target !== file.path && this.app.vault.getAbstractFileByPath(target)) throw new Error('已经有同名笔记。');
      const next = {...properties};
      if (details.icon) next.icon = details.icon; else delete next.icon;
      if (details.tags.length) next.tags = details.tags; else delete next.tags;
      const content = Object.keys(next).length ? `---\n${stringifyYaml(next)}---\n${details.body}` : details.body;
      await this.app.vault.process(file, current => {
        if (current !== original) throw new Error('笔记已在其他位置修改，请重新打开编辑。');
        return content;
      });
      original = content;
      if (target !== file.path) await this.app.fileManager.renameFile(file, target);
      this.indexer.refresh(file.path); this.refreshViews();
    }, {name: file.basename, icon: typeof properties.icon === 'string' ? properties.icon : '', tags, body: original.slice(info.contentStart)}, this.graph.all().filter(note => !!note.notePath && note.notePath !== path), id => {void this.editNote(id, source).catch(error => this.report(error));}).open();
  }
  private noteRequest?: {path: string; source?: WorkspaceLeaf; promise: Promise<void>};
  /** Every graph mode shares the same serial companion editor path. */
  openMapNote(path: string, source: WorkspaceLeaf): Promise<void> {
    return this.openNote(path, source);
  }
  openNote(path: string, source?: WorkspaceLeaf): Promise<void> {
    path = this.notePath(path) ?? '';
    if (!path) return Promise.resolve();
    source ??= this.views()[0]?.leaf;
    if (this.noteRequest?.path === path && this.noteRequest.source === source) return this.noteRequest.promise;
    const opening = (this.noteQueue ?? Promise.resolve()).then(() => this.openNoteOnce(path, source)).finally(() => {
      if (this.noteRequest?.promise === opening) this.noteRequest = undefined;
    });
    this.noteRequest = {path, source, promise: opening};
    this.noteQueue = opening.catch(() => {});
    return opening;
  }
  private async openNoteOnce(path: string, source?: WorkspaceLeaf): Promise<void> {
    if (this.destroyed) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('笔记不存在，可能已被移动或删除。');
    const workspace = this.app.workspace;
    const leaves: WorkspaceLeaf[] = [];
    const rootLeavesAvailable = typeof workspace.iterateRootLeaves === 'function';
    if (rootLeavesAvailable) workspace.iterateRootLeaves(leaf => {leaves.push(leaf);});
    else leaves.push(...new Set([...workspace.getLeavesOfType('markdown'), ...workspace.getLeavesOfType('empty')]));
    if (source && rootLeavesAvailable && !leaves.includes(source)) return;
    let note: WorkspaceLeaf;
    if (source) note = findCompanionNote(source, leaves, this.noteLeaf) ?? workspace.createLeafBySplit(source, 'vertical', false);
    else {
      const opened = leaves.find(leaf => leaf.getViewState().state?.file === file.path);
      if (opened) {await workspace.revealLeaf(opened); return;}
      note = this.noteLeaf && leaves.includes(this.noteLeaf) ? this.noteLeaf : workspace.getLeaf('split', 'vertical');
    }
    this.noteLeaf = note;
    note.setPinned(false);
    const pane = note.view.containerEl.closest('.workspace-tabs');
    pane?.addClass('brain-note-pane');
    if (note.getViewState().state?.file !== file.path) await note.openFile(file, {active: true});
    await workspace.revealLeaf(note);
    const left = source?.parent, right = note.parent;
    const initialized = this.noteSplits ??= new WeakMap();
    if (source && left && right && initialized.get(left) !== right && initializeNoteSplit(source, note)) initialized.set(left, right);
  }
  async runHistory(direction: 'undo' | 'redo'): Promise<void> {
    try {await this.relations[direction](); this.refreshViews();}
    catch (error) {this.report(error);}
  }
  private inform(message: string, duration = 5000): void {
    const views = this.views();
    if (views.length) for (const view of views) view.showInformation(message, duration);
    else new Notice(message, duration);
  }
  report(error: unknown): void { this.inform(error instanceof Error ? error.message : String(error), 6500); }
  scheduleSave(): void {
    if (this.destroyed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {this.saveTimer = undefined; this.persist();}, 350);
  }
  private persist(): void {
    const snapshot = JSON.parse(JSON.stringify(this.data)) as BrainData;
    this.saves = this.saves.then(() => this.saveData(snapshot)).catch(error => this.report(error));
  }
  private async onRename(from: string, to: string): Promise<void> {
    const map = (path: string) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
    if (this.data.focus) this.data.focus = map(this.data.focus);
    this.data.globalRoot = VAULT_ROOT;
    if (this.data.mapSelected) this.data.mapSelected = map(this.data.mapSelected);
    if (this.data.mapAttention) this.data.mapAttention = map(this.data.mapAttention);
    renameWorldRefs(this.data.knowledgeWorld, map);
    this.data.mapLayout = {
      ...this.data.mapLayout,
      nodes: Object.fromEntries(Object.entries(this.data.mapLayout.nodes).map(([id, p]) => [map(id), p])),
      cards: Object.fromEntries(Object.entries(this.data.mapLayout.cards).map(([id, p]) => [map(id), p])),
      ...(this.data.mapLayout.universe ? {universe: {
        ...this.data.mapLayout.universe,
        level: this.data.mapLayout.universe.level ? map(this.data.mapLayout.universe.level) : null,
        positions: Object.fromEntries(Object.entries(this.data.mapLayout.universe.positions).map(([id, p]) => [map(id), p])),
      }} : {}),
    };
    this.data.history = this.data.history.map(map);
    this.data.layouts = Object.fromEntries(Object.entries(this.data.layouts).map(([id, state]) => [map(id), {
      ...state, positions: Object.fromEntries(Object.entries(state.positions).map(([path, point]) => [map(path), point])), pinned: state.pinned.map(map),
      ...(state.order ? {order: state.order.map(map)} : {}),
    }]));
    for (const view of this.views()) view.handleRename(from, to);
    this.scheduleSave();

  }
  onunload(): void {
    this.noteLeaf?.view.containerEl.closest('.workspace-tabs')?.removeClass('brain-note-pane');
    this.destroyed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.indexer?.stop();
    for (const view of this.views()) view.dispose();
    if (this.data) this.persist();
  }
}
