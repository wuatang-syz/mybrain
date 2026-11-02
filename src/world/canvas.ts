import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {WorldScene, disposeTree} from './scene';
import {WorldInteraction} from './interaction';
import {WorldLabels} from './labels';
import {WorldSelection} from './selection';
import {WorldHud} from './hud';
import {newWorldState, resolveTheme, themeConfig, viewKey} from './theme';
import type {Point3} from '../model/types';
import type {KnowledgeSnapshot, KnowledgeWorldState, WorldBody, WorldThemeConfig, WorldView} from './types';

export interface WorldCallbacks {
  select(id: string): void;
  edit(id: string): void;
  open?(id: string): void;
  back?(): void;
  clear?(): void;
  context(id: string, event: MouseEvent): void;
  enter(id: string): void;
  save(): void;
  onExpanded?(): void;
  error?(message: string): void;
  onZoom?(percent: number): void;
  icon?(element: HTMLElement, name: string): void;
  /** Reports every motion change so the host can persist 外观 · 动效. */
  motion?(on: boolean): void;
}
export interface WorldCanvasOptions {budget?: number}
export interface WorldRenderRequest {
  state: KnowledgeWorldState;
  themeId: string;
  /** The attention level to keep the camera for; defaults to the snapshot level. */
  level?: string | null;
}
interface Flight {from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number}

/**
 * The shared world canvas. Camera, selection, search location, drilling, labels and resource management are theme independent; a theme swap only replaces the scene
 * resources, so the WebGL renderer and the canvas element stay mounted.
 */
export class KnowledgeWorldCanvas {
  readonly element: HTMLDivElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(42, 1, .1, 900);
  readonly scene = new THREE.Scene();
  readonly controls: OrbitControls;
  readonly expanded = new Set<string>();
  snapshot?: KnowledgeSnapshot;
  world: WorldScene;
  themeId: string;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private keyLight = new THREE.DirectionalLight(0xd5f4ff, 2.4);
  private rimLight = new THREE.DirectionalLight(0x9971ff, 2);
  private ambient = new THREE.AmbientLight(0x8497e9, 1.4);
  private labels: WorldLabels;
  private input: WorldInteraction;
  private hud: WorldHud;
  private selection: WorldSelection;
  private overview = true;
  private layout = false;
  private previewView?: WorldView;
  private resetPreview = false;
  private state: KnowledgeWorldState;
  private cleanups: (() => void)[] = [];
  private selected?: string;
  private hovered?: string;
  private flight?: Flight;
  private signature = '';
  private cameraKey = '';
  private budget: number;
  private initial = true;
  private disposed = false;
  private visible = true;
  private dirty = true;
  private motion = true;
  private reducedMotion = false;
  private lastFrame = 0;
  private elapsed = 0;
  private saveTimer = 0;
  private overviewDistance = 50;
  private width = 1;
  private height = 1;
  private win: Window;
  private drawn = new Set<string>();

  constructor(container: HTMLElement, private callbacks: WorldCallbacks, options: WorldCanvasOptions = {},
    private initialTheme = 'universe', private initialConfig?: WorldThemeConfig) {
    this.budget = options.budget ?? 200;
    this.win = container.ownerDocument.defaultView!;
    this.themeId = resolveTheme(initialTheme).id;
    this.state = newWorldState();
    this.state.theme = this.themeId;
    this.world = new WorldScene(resolveTheme(this.themeId), initialConfig ?? themeConfig(this.state, this.themeId));
    this.element = container.ownerDocument.createElement('div');
    this.element.className = 'brain-knowledge-world'; container.append(this.element);
    this.element.setAttribute('aria-label', '三维知识世界');
    const canvas = container.ownerDocument.createElement('canvas');
    try {this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});}
    catch {this.element.remove(); throw new Error('三维知识世界需要 WebGL 2，请检查 Obsidian 的硬件加速后重试。');}
    canvas.className = 'brain-world-canvas'; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '三维知识世界：拖动空白调整视角，滚轮缩放；笔记也可使用标签按钮访问');
    this.element.append(canvas);
    this.renderer.setPixelRatio(Math.min(this.win.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.setClearColor(0x050d20);
    this.scene.add(this.world.root, this.ambient, this.keyLight, this.rimLight);
    this.camera.position.set(0, 32, 42);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = .09;
    this.controls.minDistance = 5; this.controls.maxDistance = 900;
    this.controls.minPolarAngle = .15; this.controls.maxPolarAngle = Math.PI * .49;
    this.controls.update();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.world.appearance.glow, .45, .72);
    // The composer owns its render targets, so MSAA has to be requested explicitly or thin facade
    // geometry breaks into shimmering streaks.
    try {
      this.composer.renderTarget1.samples = 4; this.composer.renderTarget2.samples = 4;
    } catch { /* Antialiasing stays off when the WebGL context cannot multisample. */ }
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    const changed = () => {this.dirty = true; callbacks.onZoom?.(this.zoomPercent()); this.queueSave();};
    const start = () => {this.flight = undefined; this.selection?.cancel(); this.overview = false;};
    this.controls.addEventListener('change', changed);
    this.controls.addEventListener('start', start);
    this.cleanups.push(() => {
      this.controls.removeEventListener('change', changed);
      this.controls.removeEventListener('start', start);
    });
    this.selection = new WorldSelection({
      select: id => {
        this.selected = id; this.world.setHighlight(id); this.dirty = true;
        callbacks.select(id);
      },
      locate: id => {
        this.locate(id);
        (callbacks.open ?? callbacks.edit)(id);
      }, activate: id => this.activate(id),
    });
    this.labels = new WorldLabels(this.element, this.world.theme, {...callbacks,
      select: id => this.selection.click(id), hover: id => this.hover(id), expand: id => this.expand(id)});
    this.input = new WorldInteraction(canvas, {camera: this.camera, controls: this.controls, theme: () => this.world.theme,
      bodies: () => this.world.bodies, select: id => this.selection.click(id), edit: id => callbacks.edit(id),
      activate: id => this.selection.activate(id), layoutEnabled: () => this.layout && !this.isPreviewing,
      interrupt: () => {this.flight = undefined; this.selection.cancel();},
      context: (id, event) => callbacks.context(id, event), hover: id => this.hover(id),
      moved: () => {this.dirty = true;},
      save: () => this.queueSave()});
    this.hud = new WorldHud(this.element, {fit: () => this.fit(),
      back: () => callbacks.back?.(), layout: () => {this.layout = !this.layout; this.element.classList.toggle('is-adjusting-layout', this.layout); return this.layout;}});
    this.hud.setTheme(this.world.theme, this.world.appearance);
    const reduced = this.win.matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => {
      this.reducedMotion = reduced.matches;
      if (reduced.matches) this.motion = false;
      this.dirty = true;
    };
    preference(); reduced.addEventListener('change', preference);
    this.cleanups.push(() => reduced.removeEventListener('change', preference));
    const resize = new ResizeObserver(() => this.resize());
    resize.observe(container); this.cleanups.push(() => resize.disconnect());
    const loop = () => this.renderer.setAnimationLoop(this.visible && !container.ownerDocument.hidden ? time => this.animate(time) : null);
    container.ownerDocument.addEventListener('visibilitychange', loop);
    this.cleanups.push(() => container.ownerDocument.removeEventListener('visibilitychange', loop));
    const intersection = new IntersectionObserver(entries => {this.visible = entries[0]?.isIntersecting ?? true; this.dirty = true; loop();});
    intersection.observe(this.element); this.cleanups.push(() => intersection.disconnect());
    const lost = (event: Event) => {
      event.preventDefault(); this.renderer.setAnimationLoop(null);
      callbacks.error?.('三维画布连接中断，请切换到其他模式后重新打开知识世界。');
    };
    canvas.addEventListener('webglcontextlost', lost);
    this.cleanups.push(() => canvas.removeEventListener('webglcontextlost', lost));
    this.resize(); loop();
    this.applyThemeResources();
  }
  private sceneConfig(): WorldThemeConfig {return themeConfig(this.state, this.themeId);}
  /** Replaces theme scene resources while the renderer, camera and canvas stay mounted. */
  private applyThemeResources(): void {
    const theme = this.world.theme;
    this.ambient.color.set(theme.lighting?.ambient ?? theme.visuals.background);
    // The city needs directional shading to read as a diorama, so it leans on the key light
    // instead of a flat ambient fill.
    this.ambient.intensity = theme.lighting?.ambientIntensity ?? 1.4;
    this.keyLight.intensity = theme.lighting?.keyIntensity ?? 2.4;
    this.keyLight.color.set(theme.lighting?.key ?? '#d5f4ff');
    this.rimLight.intensity = theme.lighting?.rimIntensity ?? 2;
    this.rimLight.color.set(theme.lighting?.rim ?? '#9971ff');
    this.rimLight.position.set(14, 12, -18);
    this.keyLight.position.set(-8, theme.layout.plane === 'ground' ? 22 : 15, theme.layout.plane === 'ground' ? 10 : 12);
    this.bloom.strength = this.world.appearance.glow;
    // A bright city scene must not bloom its own surfaces into a white haze.
    const ground = theme.layout.plane === 'ground';
    // The night city is lit by the key light and its own windows; a bright studio environment
    // washes the ground plate out, so the theme relies on direct lighting only.
    this.scene.environment = null;
    this.scene.environmentIntensity = .75;
    this.renderer.shadowMap.enabled = ground; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.keyLight.castShadow = ground; this.keyLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.keyLight.shadow.camera, {left: -35, right: 35, top: 35, bottom: -35, near: .5, far: 100});
    this.keyLight.shadow.camera.updateProjectionMatrix(); this.keyLight.shadow.normalBias = .035;
    this.scene.fog = theme.lighting ? new THREE.Fog(this.world.appearance.background, theme.lighting.fogNear, theme.lighting.fogFar) : null;
    this.controls.mouseButtons.LEFT = ground ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = ground ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.bloom.radius = ground ? .38 : .45;
    // Only lit floors, the centre beacon and a selected facade should bloom in the night city.
    this.bloom.threshold = ground ? .88 : .72;
    this.renderer.toneMappingExposure = ground ? 1.05 : 1.18;
    this.renderer.setClearColor(this.world.appearance.background);
    this.scene.background = this.world.backgroundTexture() ?? null;
    this.hud.setTheme(theme, this.world.appearance);
    this.labels.setTheme(theme);
    this.element.dataset.theme = theme.id;
    // The persisted 外观 · 动效 value is the source of truth, so a reload resumes the saved state.
    this.setMotion(this.world.appearance.motion);
  }
  setTheme(themeId: string): void {
    this.selection?.cancel();
    const next = resolveTheme(themeId).id;
    if (next === this.themeId) return;
    const previous = this.world;
    const replacement = new WorldScene(resolveTheme(next), themeConfig(this.state, next));
    try {
      replacement.build(this.snapshot ?? emptySnapshot(), this.currentView(next) ?? undefined, this.selected);
    } catch (error) {
      replacement.dispose();
      this.callbacks.error?.(failMessage(this.world.theme, error));
      return;
    }
    previous.dispose();
    this.scene.remove(previous.root);
    this.scene.add(replacement.root);
    this.world = replacement; this.themeId = next;
    this.cameraKey = ''; this.signature = '';
    this.applyThemeResources();
    this.labels.rebuild(this.world.bodies);
    this.dirty = true;
  }
  /** Appearance or layout edits rebuild the scene from the same snapshot. No note scan happens. */
  applyConfig(config: WorldThemeConfig): void {
    const previous = this.world.config;
    this.world.setConfig(config);
    try {this.world.build(this.snapshot ?? emptySnapshot(), this.configView(), this.selected);}
    catch (error) {
      this.world.setConfig(previous);
      this.world.build(this.snapshot ?? emptySnapshot(), this.currentView(this.themeId) ?? undefined, this.selected);
      this.callbacks.error?.(failMessage(this.world.theme, error));
    }
    this.signature = '';
    this.applyThemeResources();
    this.labels.rebuild(this.world.bodies);
   
    this.dirty = true;
  }
  render(snapshot: KnowledgeSnapshot, selected: string | undefined, world: WorldRenderRequest): void {
    if (this.disposed) return;
    const requestedTheme = resolveTheme(world.themeId).id;
    if (requestedTheme !== this.themeId) this.setTheme(requestedTheme);
    this.state = world.state;
    const config = this.sceneConfig();
    this.world.setConfig(config);
    const level = world.level === undefined ? snapshot.level?.id ?? null : world.level;
    this.stateLevel = level;
    const key = viewKey(this.themeId, level), changed = this.cameraKey !== key;
    if (changed) {
      this.input.cancel(); this.selection.cancel();
      this.expanded.clear();
      for (const id of this.currentView(this.themeId)?.expanded ?? []) this.expanded.add(id);
    }
    this.snapshot = snapshot; this.selected = selected;
    const configSignature = JSON.stringify(config);
    const signature = JSON.stringify([this.themeId, level, configSignature,
      snapshot.groups.map(group => [group.id, group.title, group.members.length, group.hidden]),
      snapshot.notes.map(note => [note.id, note.title, note.depth])]);
    if (changed || signature !== this.signature) {
      const previous = this.signature;
      this.signature = signature;
      try {this.world.build(snapshot, this.currentView(this.themeId) ?? undefined, selected);}
      catch (error) {
        this.signature = previous;
        this.callbacks.error?.(failMessage(this.world.theme, error));
      }
      this.labels.rebuild(this.world.bodies);
      this.drawn = new Set(snapshot.drawn);
      for (const group of snapshot.groups) this.drawn.add(group.id);
    }
    this.world.setHighlight(selected);
    this.applyThemeResources();
    this.dirty = true;
    if (changed) {
      const view = this.currentView(this.themeId);
      if (view && view.camera && view.target) {this.cameraKey = key; this.restoreCamera(view);}
      else {this.cameraKey = key; this.fit(this.initial);}
    }
    if (this.initial) {this.initial = false; if (changed) this.fit(true);}
  }
  private restoreCamera(view: WorldView): void {
    this.overview = false;
    this.fly(new THREE.Vector3(view.camera.x, view.camera.y, view.camera.z), new THREE.Vector3(view.target.x, view.target.y, view.target.z), this.initial);
  }
  private currentView(themeId: string): WorldView | null {
    return this.state.views[viewKey(themeId, this.stateLevel)] ?? null;
  }
  private stateLevel: string | null = null;
  private expand(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.callbacks.onExpanded?.(); this.queueSave();
  }
  private hover(id?: string): void {
    if (this.hovered === id) return;
    this.hovered = id; this.world.setHighlight(id ?? this.selected); this.dirty = true;
  }
  private resize(): void {
    if (this.disposed) return;
    const hadSize = this.width > 1;
    this.width = Math.max(1, this.element.clientWidth); this.height = Math.max(1, this.element.clientHeight);
    this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix();
    const background = this.scene.background;
    if (background && (background as THREE.Texture).isTexture) {
      const texture = background as THREE.Texture, aspect = this.width / this.height;
      texture.repeat.set(Math.min(1, aspect / 2), Math.min(1, 2 / aspect));
      texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
      texture.updateMatrix();
    }
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    if (hadSize && this.world.bodies.length) {if (this.overview) this.fit(true); else if (this.selected) this.locate(this.selected);}
    this.dirty = true;
  }
  private animate(time: number): void {
    if (this.disposed || time - this.lastFrame < 30) return;
    const delta = Math.min(.05, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    if (this.flight) {
      const flight = this.flight, t = Math.min(1, (time - flight.start) / 600), ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(flight.from, flight.to, ease);
      this.controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease);
      this.dirty = true;
      if (t === 1) this.flight = undefined;
    }
    this.controls.update();
    if (this.motion) {
      this.elapsed += delta;
      const spin = this.world.theme.motion.spin;
      for (const body of this.world.bodies) if (body.object.role !== 'center') body.group.rotation.y += delta * body.spin * spin;
      this.world.tick(this.elapsed);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.camera.updateMatrixWorld();
    this.labels.update(this.camera, this.width, this.height, this.world.appearance.modelScale, this.selected, this.hovered);
    this.composer.render();
    this.dirty = false;
  }
  private fitDistance(): number {
    const bounds = new THREE.Box3();
    for (const body of this.world.bodies) bounds.expandByPoint(body.group.position);
    const size = bounds.isEmpty() ? new THREE.Vector3(10, 5, 10) : bounds.getSize(new THREE.Vector3()).addScalar(6);
    const fov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return Math.max(18, Math.max(size.x / Math.max(.35, this.camera.aspect), size.z * .8 + 5) / (2 * fov)) * 1.17;
  }
  fit(immediate = false): void {
    this.overview = true;
    this.overviewDistance = this.fitDistance();
    const bounds = new THREE.Box3();
    for (const body of this.world.bodies) bounds.expandByPoint(body.group.position);
    const target = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    this.fly(new THREE.Vector3(.28, this.themeId === 'city' ? .68 : .75, .78).normalize().multiplyScalar(this.overviewDistance).add(target), target, immediate);
  }
  private fly(position: THREE.Vector3, target: THREE.Vector3, immediate = false): void {
    if (immediate || this.reducedMotion || !this.motion) {
      this.flight = undefined; this.camera.position.copy(position); this.controls.target.copy(target);
      this.controls.update(); this.dirty = true; return;
    }
    this.flight = {from: this.camera.position.clone(), to: position, fromTarget: this.controls.target.clone(),
      toTarget: target, start: this.win.performance.now()};
    this.dirty = true;
  }
  locate(id: string): boolean {
    const body = this.world.bodies.find(entry => entry.object.id === id);
    if (!body) return false;
    this.overview = false;
    // Keep neighbours in frame: a selected group should still read as part of the city.
    const distance = Math.max(body.radius * 5, body.object.role === 'member' ? 13 : 26);
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(distance);
    this.fly(body.group.position.clone().add(offset), body.group.position.clone());
    return true;
  }
  zoom(direction: 1 | -1): void {
    this.overview = false;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * Math.pow(1.22, -direction), 5, 900));
    this.fly(this.controls.target.clone().add(offset), this.controls.target.clone());
  }
  zoomPercent(): number {
    return Math.round(this.overviewDistance / Math.max(1, this.camera.position.distanceTo(this.controls.target)) * 100);
  }
  setBudget(budget: number): void {this.budget = budget;}
  get drawnNotes(): ReadonlySet<string> {return this.drawn;}
  /** 外观 · 动效 as driven by the world icon rail; the OS reduced-motion preference wins. */
  get motionOn(): boolean {return this.motion;}
  setMotion(on: boolean): void {
    const next = !!on && !this.reducedMotion;
    if (this.motion === next) return;
    this.motion = next;
    if (!next && this.flight) {this.camera.position.copy(this.flight.to); this.controls.target.copy(this.flight.toTarget); this.flight = undefined;}
    this.dirty = true;
  }
  /** Returns the state the world reports so the rail and the saved configuration stay in step. */
  toggleMotion(): boolean {
    this.setMotion(!this.motion); this.callbacks.motion?.(this.motion);
    return this.motion;
  }
  /** Live scene objects, exposed for hosts and diagnostics. */
  get objects(): readonly WorldBody[] {return this.world.bodies;}
  get budgetValue(): number {return this.budget;}
  /** Persisted per theme and attention level. */
  getView(): WorldView {
    const point = (source: THREE.Vector3): Point3 => ({x: source.x, y: source.y, z: source.z});
    const positions: Record<string, Point3> = {};
    for (const body of this.world.bodies) if (body.object.role !== 'center') positions[body.object.id] = point(body.group.position);
    return {camera: point(this.camera.position), target: point(this.controls.target), positions, expanded: [...this.expanded]};
  }
  /** The level the next render should restore, so switching worlds restores the matching view. */
  setLevel(level: string | null): void {
    if (this.stateLevel !== level) {
      this.selection.cancel(); this.win.clearTimeout(this.saveTimer);
      this.expanded.clear();
      for (const id of this.state.views[viewKey(this.themeId, level)]?.expanded ?? []) this.expanded.add(id);
    }
    this.stateLevel = level;
  }
  /** 重置布局 clears only this theme and level position record, keeping camera and expansion. */
  clearPositions(): void {
    const view = this.currentView(this.themeId);
    const cleared: WorldView = view
      ? {camera: view.camera, target: view.target, expanded: [...view.expanded], positions: {}}
      : {camera: {x: 0, y: 32, z: 42}, target: {x: 0, y: 0, z: 0}, expanded: [], positions: {}};
    if (this.isPreviewing) this.resetPreview = true;
    this.world.build(this.snapshot ?? emptySnapshot(), cleared, this.selected);
    this.labels.rebuild(this.world.bodies);
    this.dirty = true;
  }
  private activate(id: string): void {
    this.selection.cancel();
    const object = this.world.bodies.find(body => body.object.id === id)?.object;
    if (!object) return;
    if (object.enter) this.callbacks.enter(id);
  }
  get isPreviewing(): boolean {return !!this.previewView;}
  beginPreview(): void {this.selection.cancel(); this.previewView = this.getView(); this.resetPreview = false;}
  endPreview(apply: boolean): WorldView | undefined {
    const original = this.previewView; if (!original) return;
    const result = {...this.getView(), positions: this.resetPreview ? {} : original.positions};
    this.previewView = undefined; this.resetPreview = false;
    if (!apply) {
      this.world.setConfig(this.sceneConfig());
      this.world.build(this.snapshot ?? emptySnapshot(), original, this.selected);
      this.labels.rebuild(this.world.bodies); this.applyThemeResources(); this.restoreCamera(original); this.dirty = true;
    }
    return apply ? result : original;
  }
  private configView(): WorldView | undefined {
    if (this.previewView) return {...this.previewView, positions: this.resetPreview ? {} : this.previewView.positions};
    return this.currentView(this.themeId) ?? undefined;
  }
  private queueSave(): void {
    this.win.clearTimeout(this.saveTimer);
    this.saveTimer = this.win.setTimeout(() => {
      if (!this.disposed && !this.initial && !this.isPreviewing) this.callbacks.save();
    }, 350);
  }
  destroy(): void {
    if (this.disposed) return;
    this.selection.cancel();
    this.input.destroy();
    if (!this.initial && !this.isPreviewing) this.callbacks.save();
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.win.clearTimeout(this.saveTimer);
    this.cleanups.forEach(cleanup => cleanup());
    this.controls.dispose(); this.labels.destroy(); this.hud.destroy();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.world.dispose();
    disposeTree(this.scene);
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.element.remove();
  }
}
function emptySnapshot(): KnowledgeSnapshot {
  return {level: null, root: null, selected: null, groups: [], notes: [], relations: [], drawn: [],
    stats: {groups: 0, notes: 0, drawn: 0, hidden: 0, total: 0}};
}
function failMessage(theme: {copy: {fail: string}}, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return theme.copy.fail.replace('{message}', message);
}
