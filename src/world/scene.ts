import * as THREE from 'three';
import nebulaUrl from './assets/nebula.jpg';
import surfaceUrl from './assets/surface.jpg';
import {citySeed} from './shapes/city';
import {worldShapes} from './shapes';
import {parseColor, resolveAppearance, resolveLayout, resolveObjects} from './theme';
import type {KnowledgeSnapshot, ResolvedAppearance, WorldBody, WorldThemeConfig, WorldThemeDefinition, WorldView} from './types';

/** Disposes geometry and materials owned by a scene subtree; textures are released separately. */
export function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.clear();
}
function line(color: number, opacity: number, dashed: boolean): THREE.Line {
  const material = dashed
    ? new THREE.LineDashedMaterial({color, transparent: true, opacity, dashSize: .35, gapSize: .25})
    : new THREE.LineBasicMaterial({color, transparent: true, opacity});
  return new THREE.Line(new THREE.BufferGeometry(), material);
}
function beam(from: THREE.Vector3, to: THREE.Vector3, color: number, opacity: number, width: number): THREE.Object3D {
  const mid = from.clone().lerp(to, .5); mid.y += Math.min(2, from.distanceTo(to) * .13);
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  const material = new THREE.MeshBasicMaterial({color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, Math.max(.006, width), 4, false), material);
}
/** Deterministic star field; the city theme never builds one. */
function starField(): THREE.Points {
  let seed = 8137;
  const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296;};
  const positions: number[] = [], colors: number[] = [], sizes: number[] = [];
  for (let i = 0; i < 1800; i++) {
    const azimuth = random() * Math.PI * 2, cos = random() * 2 - 1, sin = Math.sqrt(1 - cos * cos), radius = 90 + random() * 100;
    positions.push(radius * sin * Math.cos(azimuth), radius * cos, radius * sin * Math.sin(azimuth));
    const tint = new THREE.Color().setHSL(.55 + random() * .17, .3, .58 + random() * .4);
    colors.push(tint.r, tint.g, tint.b); sizes.push(.9 + random() * 2.5);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {time: {value: 0}}, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; varying vec3 vColor; varying float vSeed;
      void main(){vColor=color; vSeed=position.x; vec4 p=modelViewMatrix*vec4(position,1.);
      gl_PointSize=size*1.5; gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform float time; varying vec3 vColor; varying float vSeed;
      void main(){float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.03,d);
      gl_FragColor=vec4(vColor,a*(.72+.28*sin(time*.6+vSeed)));}`,
  });
  return new THREE.Points(geometry, material);
}

/** Theme resources for one world: background, shapes, ornaments and relation lines. */
export class WorldScene {
  readonly root = new THREE.Group();
  readonly bodies: WorldBody[] = [];
  appearance: ResolvedAppearance;
  config: WorldThemeConfig;
  private ornaments = new THREE.Group();
  private structure = new THREE.Group();
  private textures: THREE.Texture[] = [];
  private stars?: THREE.Points;
  private surface?: THREE.Texture;
  private background?: THREE.Texture;
  private highlighted?: string;
  private traffic: {mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; phase: number}[] = [];

  constructor(readonly theme: WorldThemeDefinition, config: WorldThemeConfig) {
    this.config = config;
    this.appearance = resolveAppearance(theme, config);
    this.root.add(this.ornaments, this.structure);
  }
  /** Appearance and layout changes re-derive the look without rescanning any note. */
  setConfig(config: WorldThemeConfig): void {
    this.config = config;
    this.appearance = resolveAppearance(this.theme, config);
  }
  /** The universe keeps its nebula backdrop; the city uses a flat bright background. */
  backgroundTexture(): THREE.Texture | undefined {return this.background;}
  private cosmic(): boolean {return this.theme.decoration.kind === 'orbit';}
  /** Loads the local textures once per scene; the city never touches them. */
  loadTextures(): void {
    if (!this.cosmic()) return;
    if (!this.stars) {this.stars = starField(); this.root.add(this.stars);}
    if (this.textures.length) return;
    const loader = new THREE.TextureLoader();
    const background = loader.load(nebulaUrl);
    background.colorSpace = THREE.SRGBColorSpace;
    const surface = loader.load(surfaceUrl);
    surface.colorSpace = THREE.SRGBColorSpace;
    this.background = background; this.surface = surface; this.textures.push(background, surface);
  }
  build(snapshot: KnowledgeSnapshot, view: WorldView | undefined, selected?: string): void {
    this.loadTextures();
    // The star field outlives a rebuild; everything else is recreated from the snapshot.
    if (this.stars) this.root.remove(this.stars);
    disposeTree(this.root);
    this.bodies.length = 0; this.traffic = [];
    this.root.add(this.ornaments, this.structure);
    if (this.stars) this.root.add(this.stars);
    this.ornaments.clear(); this.structure.clear();
    const objects = resolveObjects(this.theme, this.config, snapshot);
    const positions = this.layout(objects, view);
    for (const object of objects) {
      const builder = this.theme.shapes[object.shape] ?? worldShapes[object.shape];
      if (!builder) continue;
      const built = builder({role: object.role, level: object.level, shape: object.shape, color: object.color,
        seed: citySeed(object.id), size: object.size, detail: object.detail, appearance: this.appearance});
      built.object.position.copy(positions.get(object.id) ?? new THREE.Vector3());
      built.object.userData.noteId = object.id;
      built.hit.userData.noteId = object.id;
      this.applySurface(built.object, object.shape);
      this.root.add(built.object);
      this.bodies.push({object, group: built.object, hit: built.hit, radius: built.radius, spin: built.spin});
    }
    this.decorate(objects, positions);
    this.relations(snapshot, positions);
    this.setHighlight(selected);
  }
  private applySurface(group: THREE.Group, shape: string): void {
    if (!this.surface || shape === 'core') return;
    group.traverse(object => {
      const mesh = object as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!material || !material.isMeshStandardMaterial) return;
      material.map = this.surface!;
      material.emissiveMap = this.surface!;
      material.needsUpdate = true;
    });
  }
  /** Deterministic automatic layout, then manual positions on top: dragging always wins. */
  private layout(objects: WorldBody['object'][], view: WorldView | undefined): Map<string, THREE.Vector3> {
    const spec = resolveLayout(this.theme, this.config), positions = new Map<string, THREE.Vector3>();
    const groups = objects.filter(object => object.role === 'group');
    const ringSize = Math.max(1, Math.floor(spec.rings) || 8);
    const ground = spec.plane === 'ground';
    groups.forEach((group, index) => {
      const ring = Math.floor(index / ringSize), count = Math.min(ringSize, groups.length - ring * ringSize);
      const angle = -Math.PI * .78 + (index % ringSize) / Math.max(1, count) * Math.PI * 2;
      const radius = spec.groupGap * (ring + .96);
      positions.set(group.id, ground
        ? new THREE.Vector3(Math.cos(angle) * radius * 1.1, 0, Math.sin(angle) * radius * 1.1)
        : new THREE.Vector3(Math.cos(angle) * radius * 1.16, spec.lift + Math.sin(index * 1.9) * spec.tilt, Math.sin(angle) * radius));
      const domain = positions.get(group.id)!;
      const members = objects.filter(object => object.role === 'member' && object.domain === group.id);
      members.forEach((member, position) => {
        const orbit = Math.floor(position / ringSize), remaining = Math.min(ringSize, members.length - orbit * ringSize);
        const theta = -.2 + (position % ringSize) / Math.max(1, remaining) * Math.PI * 2;
        const distance = spec.memberGap + orbit * spec.spacing;
        positions.set(member.id, ground
          ? new THREE.Vector3(domain.x + Math.cos(theta) * distance, 0, domain.z + Math.sin(theta) * distance)
          : new THREE.Vector3(domain.x + Math.cos(theta) * distance, domain.y + Math.sin(theta * 2) * spec.tilt * .64,
            domain.z + Math.sin(theta) * distance));
      });
    });
    const center = objects.find(object => object.role === 'center');
    if (center) positions.set(center.id, new THREE.Vector3());
    if (view) {
      for (const [id, point] of Object.entries(view.positions)) {
        if (id === center?.id) continue;
        positions.set(id, new THREE.Vector3(point.x, point.y, point.z));
      }
    }
    return positions;
  }
  /** Decoration never carries relation meaning: orbit rings or roads are scenery only. */
  private decorate(objects: WorldBody['object'][], positions: Map<string, THREE.Vector3>): void {
    const center = positions.get(objects.find(object => object.role === 'center')?.id ?? '') ?? new THREE.Vector3();
    const color = this.appearance.decoration, cosmic = this.cosmic();
    if (!cosmic) {
      const extent = Math.max(18, ...[...positions.values()].map(p => Math.max(Math.abs(p.x), Math.abs(p.z)) + 8));
      const ground = new THREE.Mesh(new THREE.CylinderGeometry(extent, extent, .14, 96),
        new THREE.MeshStandardMaterial({color: new THREE.Color(this.appearance.ground).lerp(new THREE.Color(0x0a1626), .45),
          roughness: .38, metalness: .34}));
      ground.position.y = -.15; ground.receiveShadow = true; this.ornaments.add(ground);
      const grid = new THREE.GridHelper(extent * 1.32, Math.min(56, Math.ceil(extent * 1.32)), 0x24425c, 0x152a3f);
      grid.position.y = -.07; this.ornaments.add(grid);
    }
    for (const object of objects) {
      if (object.role !== 'group') continue;
      const at = positions.get(object.id); if (!at) continue;
      if (cosmic) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(object.size * 1.7, .012, 4, 96),
          new THREE.MeshBasicMaterial({color, transparent: true, opacity: this.theme.decoration.opacity,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
        ring.rotation.x = Math.PI / 2; ring.position.copy(at); this.ornaments.add(ring);
      } else {
        const length = Math.hypot(at.x - center.x, at.z - center.z);
        if (length < .5) continue;
        const road = new THREE.Group();
        const surface = new THREE.Mesh(new THREE.BoxGeometry(.65, .035, length),
          new THREE.MeshStandardMaterial({color: 0x090f1b, roughness: .45, metalness: .3}));
        surface.receiveShadow = true; road.add(surface);
        const curbMaterial = new THREE.MeshStandardMaterial({color, roughness: .5, metalness: .4});
        for (const side of [-1, 1]) {
          const curb = new THREE.Mesh(new THREE.BoxGeometry(.05, .06, length), curbMaterial);
          curb.position.x = side * .35; road.add(curb);
        }
        road.position.set((at.x + center.x) / 2, -.015, (at.z + center.z) / 2);
        road.rotation.y = Math.atan2(at.x - center.x, at.z - center.z); this.ornaments.add(road);
        const light = new THREE.Mesh(new THREE.BoxGeometry(.055, .025, .32),
          new THREE.MeshBasicMaterial({color: 0xb3eafa, toneMapped: false}));
        this.ornaments.add(light); light.rotation.y = road.rotation.y;
        this.traffic.push({mesh: light, from: center.clone(), to: at.clone(), phase: this.traffic.length * .19});
      }
    }
  }
  /** Directory and jump links stay visible; their style follows the selected theme. */
  private relations(snapshot: KnowledgeSnapshot, positions: Map<string, THREE.Vector3>): void {
    const centerObject = this.bodies.find(body => body.object.role === 'center');
    for (const body of this.bodies) {
      if (body.object.role !== 'group' || !centerObject) continue;
      const style = this.theme.relations.structure;
      this.structure.add(beam(centerObject.group.position, body.group.position, this.appearance.structure, style.opacity, style.width));
    }
    for (const relation of snapshot.relations) {
      const from = positions.get(relation.source), to = positions.get(relation.target);
      if (!from || !to) continue;
      const style = relation.kind === 'hierarchy' ? this.theme.relations.structure
        : this.theme.relations.jump;
      const color = relation.kind === 'hierarchy' ? this.appearance.structure : parseColor(style.color, this.appearance.structure);
      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const stroke = line(color, style.opacity, style.dashed);
      stroke.geometry.dispose();
      stroke.geometry = geometry;
      if (stroke.material instanceof THREE.LineDashedMaterial) stroke.computeLineDistances();
      stroke.userData.relation = relation;
      this.structure.add(stroke);
    }
    this.setHighlight(this.highlighted);
  }
  setHighlight(id?: string): void {
    this.highlighted = id;
    if (!this.cosmic()) for (const body of this.bodies) body.group.traverse(child => {
      if (child.userData.selectionRing) child.visible = body.object.id === id;
      if (child.userData.cityLight) {
        const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = (child.userData.baseEmission as number) * (body.object.id === id ? 1.55 : 1);
      }
    });
  }
  /** Twinkling star field motion, driven by the canvas clock. */
  tick(elapsed: number): void {
    for (const car of this.traffic) {
      car.mesh.position.lerpVectors(car.from, car.to, (elapsed * .045 + car.phase) % 1); car.mesh.position.y = .025;
    }
    if (!this.cosmic()) {
      const center = this.bodies.find(body => body.object.role === 'center');
      center?.group.traverse(child => {
        if (child.userData.cityLight) ((child as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity =
          (child.userData.baseEmission as number) * (1 + .12 * Math.sin(elapsed * .8));
        if (child.userData.beacon) {
          const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          material.opacity = (child.userData.baseOpacity as number) * (.72 + .28 * Math.sin(elapsed * .55));
        }
      });
    }
    if (this.stars) (this.stars.material as THREE.ShaderMaterial).uniforms.time!.value = elapsed;
  }
  dispose(): void {
    disposeTree(this.root);
    this.stars = undefined;
    for (const texture of this.textures) texture.dispose();
    this.textures = []; this.surface = undefined; this.background = undefined; this.bodies.length = 0;
  }
}
