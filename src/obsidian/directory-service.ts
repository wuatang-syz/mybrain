import {TFile, type App, type TAbstractFile} from 'obsidian';
import type {GraphIndex} from '../graph';
import {joinPath, parentPath, renamePath} from '../graph/directory';
import type {RelationKind, RelationRequest} from '../model/types';
import type {VaultIndexer} from './indexer';

type Step = {kind: 'move'; from: string; to: string; file: TAbstractFile}
  | {kind: 'folder'; path: string; remove?: boolean; file?: TAbstractFile}
  | {kind: 'note'; path: string; content: string; remove?: boolean; file?: TAbstractFile}
  | {kind: 'jump'; path: string; file: TFile; target: string; before: string; after: string};
interface Command {steps: Step[]}
const reverse = (step: Step): Step => step.kind === 'move' ? {...step, from: step.to, to: step.from}
  : step.kind === 'jump' ? {...step, before: step.after, after: step.before} : {...step, remove: !step.remove};
export function validName(value: string): string {
  const name = value.trim();
  if (!name || /[\\/:*?"<>|[\]#^]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(name)) {
    throw new Error('请输入有效名称，不包含路径分隔符或文件名保留字符。');
  }
  return name;
}

/** One history and queue for directory operations and independent note jumps. */
export class DirectoryService {
  private queue: Promise<unknown> = Promise.resolve();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<(paths: string[]) => void>();
  constructor(private app: App, private graph: GraphIndex, private indexer: VaultIndexer) {}
  get canUndo(): boolean {return this.undoStack.length > 0;}
  get canRedo(): boolean {return this.redoStack.length > 0;}
  subscribe(callback: (paths: string[]) => void): () => void {this.listeners.add(callback); return () => {this.listeners.delete(callback);};}
  private serial<T>(run: () => Promise<T>): Promise<T> {const next = this.queue.then(run, run); this.queue = next.catch(() => {}); return next;}
  private record(id: string) {const node = this.graph.get(id); if (!node) throw new Error('节点已被移动或删除，请重新选择。'); return node;}
  private file(path: string): TAbstractFile {const file = this.app.vault.getAbstractFileByPath(path); if (!file) throw new Error(`路径不存在：${path}`); return file;}
  private note(id: string): string {const node = this.record(id); if (!node.notePath) throw new Error('只有具有正文的笔记节点可以建立跳转。'); return node.notePath;}
  private folder(id: string): string {
    const node = this.record(id);
    if (node.kind === 'note') throw new Error('只有文件夹可以承载子项，请选择文件夹。');
    return node.path ?? '';
  }
  private moveStep(id: string, folder: string, steps: Step[]): void {
    const node = this.record(id);
    if (node.kind === 'root') throw new Error('知识库根节点不能移动。');
    const from = node.path!, to = joinPath(folder, from.split('/').pop()!);
    if (from === to) return;
    if (folder === from || folder.startsWith(`${from}/`)) throw new Error('不能移动到自身或自己的子文件夹。');
    steps.push({kind: 'move', from, to, file: this.file(from)});
  }
  describe(request: RelationRequest): string {
    if (request.kind === 'jump') return '添加跳转关联';
    const focus = this.record(request.focus), target = this.record(request.target);
    const parent = request.kind === 'parent' ? target : focus;
    const child = request.kind === 'parent' ? focus : target;
    const folder = request.kind === 'sibling' ? parentPath(focus.path ?? '') : this.folder(parent.id);
    return `移动到 ${joinPath(folder, child.path?.split('/').pop() ?? '')}`;
  }
  apply(request: RelationRequest): Promise<boolean> {return this.serial(async () => {
    await this.indexer.settled();
    if (request.focus === request.target) throw new Error('不能连接节点自身。');
    const steps: Step[] = [];
    if (request.kind === 'jump') {
      const from = this.note(request.focus), to = this.note(request.target);
      if (this.graph.linked(request.focus).includes(request.target)) return false;
      // The metadata event can arrive after the write resolves. Use committed content only
      // to bridge that short delay, without creating a second relationship store.
      for (const command of this.undoStack) for (const step of command.steps) {
        if (step.kind !== 'jump' || !((step.path === from && step.target === to) || (step.path === to && step.target === from))) continue;
        if (this.app.vault.getAbstractFileByPath(step.path) === step.file && await this.app.vault.read(step.file) === step.after) return false;
      }
      steps.push(await this.linkStep(from, to));
    } else {
      const folder = request.kind === 'sibling' ? parentPath(this.record(request.focus).path ?? '') : this.folder(request.kind === 'parent' ? request.target : request.focus);
      this.moveStep(request.kind === 'parent' ? request.focus : request.target, folder, steps);
    }
    return this.commit(steps);
  });}
  move(id: string, folderId: string): Promise<boolean> {return this.serial(() => {
    const target = this.record(folderId);
    if (target.kind === 'note') throw new Error('请选择文件夹。');
    const steps: Step[] = []; this.moveStep(id, target.path ?? '', steps); return this.commit(steps);
  });}
  createFolder(parent: string, name: string): Promise<boolean> {return this.serial(() => {
    const steps: Step[] = [], folder = this.folder(parent);
    steps.push({kind: 'folder', path: joinPath(folder, validName(name))}); return this.commit(steps);
  });}
  createRelative(source: string, kind: RelationKind | 'sibling', name: string, content: string): Promise<boolean> {return this.serial(async () => {
    const node = this.record(source), steps: Step[] = [];
    if (kind === 'parent') {
      if (node.kind === 'root') throw new Error('根节点不能添加父级。');
      const folder = joinPath(parentPath(node.path!), validName(name));
      steps.push({kind: 'folder', path: folder}); this.moveStep(source, folder, steps);
    } else {
      const folder = kind === 'child' ? this.folder(source) : parentPath(node.path ?? '');
      const path = joinPath(folder, `${validName(name.replace(/\.md$/i, ''))}.md`);
      steps.push({kind: 'note', path, content});
      if (kind === 'jump') {
        steps.push(await this.linkStep(this.note(source), path));
      }
    }
    return this.commit(steps);
  });}
  undo(): Promise<void> {return this.serial(() => this.history(this.undoStack, this.redoStack, true));}
  redo(): Promise<void> {return this.serial(() => this.history(this.redoStack, this.undoStack, false));}
  private async history(from: Command[], to: Command[], inverse: boolean): Promise<void> {
    const command = from.at(-1); if (!command) return;
    await this.execute(inverse ? [...command.steps].reverse().map(reverse) : command.steps);
    from.pop(); to.push(command);
  }
  private async commit(steps: Step[]): Promise<boolean> {
    if (!steps.length) return false;
    await this.execute(steps); this.undoStack.push({steps}); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; return true;
  }
  private async linkStep(path: string, target: string): Promise<Step> {
    const file = this.file(path) as TFile, destination = this.app.vault.getAbstractFileByPath(target);
    const before = await this.app.vault.read(file);
    const link = destination instanceof TFile
      ? this.app.fileManager.generateMarkdownLink(destination, path)
      : `[[${target.replace(/\.md$/i, '')}]]`;
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    const gap = !before || before.endsWith(eol + eol) ? '' : before.endsWith(eol) ? eol : eol + eol;
    return {kind: 'jump', path, file, target, before, after: before + gap + link + eol};
  }
  private async validate(steps: Step[]): Promise<void> {
    const files = new Map(this.app.vault.getAllLoadedFiles().map(file => [file.path, file]));
    for (const step of steps) {
      if (step.kind === 'jump') {
        if (this.file(step.path) !== step.file) throw new Error(`笔记已被外部替换：${step.path}`);
        if (await this.app.vault.read(step.file) !== step.before) throw new Error(`跳转已被外部修改：${step.path}`);
        continue;
      }
      const path = step.kind === 'move' ? step.to : step.path;
      const config = this.app.vault.configDir;
      if (path === config || path.startsWith(`${config}/`) || path.split('/').some(part => part === '..' || part === '.')) throw new Error('不能修改知识库配置目录。');
      if (step.kind === 'move') {
        if (files.get(step.from) !== step.file) throw new Error(`文件已被外部移动或替换：${step.from}`);
        if (files.has(path)) throw new Error(`目标已存在：${path}`);
        for (const [key, file] of [...files]) if (key === step.from || key.startsWith(`${step.from}/`)) {files.delete(key); files.set(renamePath(key, step.from, path), file);}
      } else if (step.remove) {
        if (!files.has(path)) throw new Error(`路径已被外部删除：${path}`);
        if (step.file && files.get(path) !== step.file) throw new Error(`路径已被外部替换：${path}`);
        if (step.kind === 'folder' && [...files.keys()].some(key => key.startsWith(`${path}/`))) throw new Error(`文件夹包含其他内容，无法撤销：${path}`);
        if (step.kind === 'note' && await this.app.vault.read(files.get(path) as TFile) !== step.content) throw new Error(`新笔记已被编辑，无法撤销创建：${path}`);
        files.delete(path);
      } else {
        if (files.has(path)) throw new Error(`目标已存在：${path}`);
        files.set(path, {path, ...(step.kind === 'folder' ? {children: []} : {})} as unknown as TAbstractFile);
      }
      const parent = parentPath(path);
      if (!(step.kind !== 'move' && step.remove) && parent && !('children' in (files.get(parent) ?? {}))) throw new Error(`目标文件夹不存在：${parent}`);
    }
  }
  private async run(step: Step): Promise<void> {
    if (step.kind === 'move') {
      if (this.app.vault.getAbstractFileByPath(step.to)) throw new Error(`目标已存在：${step.to}`);
      if (this.file(step.from) !== step.file) throw new Error(`文件已变化：${step.from}`);
      await this.app.fileManager.renameFile(step.file, step.to);
    } else if (step.kind === 'jump') {
      const file = this.file(step.path) as TFile;
      if (file !== step.file) throw new Error(`笔记已被外部替换：${step.path}`);
      await this.app.vault.process(file, current => {
        if (current !== step.before) throw new Error(`笔记已被外部修改：${step.path}`);
        return step.after;
      });
      this.indexer.refresh(step.path);
    } else if (step.remove) {
      const file = this.file(step.path);
      if (step.file && file !== step.file) throw new Error(`路径已被外部替换：${step.path}`);
      if (step.kind === 'folder' && 'children' in file && (file.children as TAbstractFile[]).length) throw new Error(`文件夹非空：${step.path}`);
      if (step.kind === 'note' && await this.app.vault.read(file as TFile) !== step.content) throw new Error(`笔记已变化：${step.path}`);
      await this.app.fileManager.trashFile(file);
    } else {
      const previous = step.file;
      const created = step.kind === 'folder' ? await this.app.vault.createFolder(step.path) : await this.app.vault.create(step.path, step.content);
      step.file = created;
      // A redone creation has a new Obsidian object. Rebind only commands that referred to
      // the original object, never an unrelated externally replaced file at the same path.
      if (previous) for (const command of [...this.undoStack, ...this.redoStack]) for (const saved of command.steps) {
        if (saved.file === previous) saved.file = created;
      }
      if (step.kind === 'note') this.indexer.refresh(step.path);
    }
  }
  private async execute(steps: Step[]): Promise<void> {
    await this.indexer.settled(); await this.validate(steps);
    const done: Step[] = [];
    try {for (const step of steps) {await this.run(step); done.push(step); await this.indexer.settled();}}
    catch (error) {
      const failed: string[] = [];
      for (const step of done.reverse()) {try {await this.run(reverse(step)); await this.indexer.settled();} catch {failed.push(step.kind === 'move' ? step.from : step.path);}}
      if (failed.length) throw new Error(`${String(error)}；以下路径未能恢复：${failed.join('、')}`);
      throw error;
    } finally {for (const listener of this.listeners) {try {listener([]);} catch { /* Observers cannot reject a committed command. */ }}}
  }
}
