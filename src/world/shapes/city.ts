import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {ShapeInput, ShapeResult, WorldShapeBuilder, WorldShapeId} from '../types';

export function citySeed(id: string): number {
  let value = 2166136261;
  for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
/** Merged metal, glass, cool and warm light batches. No light per window. */
class Architecture {
  private parts: THREE.BufferGeometry[][] = [[], [], [], []];
  private randomState: number;
  private height = .1;
  private halfWidth = .1;
  constructor(private input: ShapeInput) {this.randomState = input.seed ?? 1;}
  random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, material = 0): void {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z); this.parts[material]!.push(geometry);
    this.height = Math.max(this.height, y + h / 2);
    this.halfWidth = Math.max(this.halfWidth, Math.abs(x) + w / 2, Math.abs(z) + d / 2);
  }
  tower(x: number, z: number, w: number, d: number, h: number, variant: number): void {
    this.box(x, .12, z, w * 1.28, .24, d * 1.28);
    const tiers = variant % 3 === 0 ? 3 : 1;
    for (let tier = 0; tier < tiers; tier++) {
      const factor = 1 - tier * .18, bottom = .24 + tier * h / tiers, th = h / tiers;
      const tw = w * factor, td = d * factor;
      this.box(x, bottom + th / 2, z, tw, th, td, 1);
      for (const side of [-1, 1]) {
        this.box(x + side * tw * .49, bottom + th / 2, z, .045, th, td * 1.02);
        this.box(x, bottom + th / 2, z + side * td * .49, tw, th, .045);
      }
      // Lit floors read as horizontal light bands; sub-pixel window grids turn into noise at overview distance.
      const floors = Math.max(3, Math.round(th / .34));
      for (let floor = 0; floor < floors; floor++) {
        if (this.random() < .22) continue;
        const y = bottom + (floor + .5) * th / floors, warm = this.random() > .86;
        const material = warm ? 3 : 2, band = tw * (.5 + this.random() * .34);
        const bandHeight = Math.min(.075, th / floors * .5);
        for (const side of [-1, 1]) {
          this.box(x, y, z + side * td * .508, band, bandHeight, .012, material);
          this.box(x + side * tw * .508, y, z, .012, bandHeight, band * td / Math.max(.001, tw), material);
        }
      }
      // Dark cornice between tiers; the lit crown is added once at the top of the tower.
      this.box(x, bottom + th, z, tw * 1.04, .04, td * 1.04);
    }
    this.box(x, h + .33, z, w * .65, .18, d * .65);
    if (variant % 2 === 0) this.box(x, h + .55, z, .035, .4, .035, 2);
    else for (let i = 0; i < 3; i++) this.box(x + (i - 1) * w / 4, h + .4 + i * .07, z, w / 4, .15 + i * .14, d * .6);
  }
  finish(radius: number): ShapeResult {
    const input = this.input, group = new THREE.Group(), brightness = input.appearance.windowLight ?? 1;
    const tint = new THREE.Color(input.color);
    const materials = [
      new THREE.MeshStandardMaterial({color: new THREE.Color(input.appearance.ground).lerp(new THREE.Color(0x16283a), .5), roughness: .45, metalness: .45}),
      new THREE.MeshStandardMaterial({color: new THREE.Color(input.appearance.building).lerp(new THREE.Color(0x33628c), .5), roughness: .28, metalness: .38,
        emissive: new THREE.Color(0x0d2033), emissiveIntensity: .6}),
      new THREE.MeshStandardMaterial({color: tint, emissive: tint, emissiveIntensity: 1.25 * brightness, roughness: .3, metalness: .2}),
      new THREE.MeshStandardMaterial({color: 0xffdcae, emissive: 0xffb76a, emissiveIntensity: 1.5 * brightness, roughness: .4}),
    ];
    const detail = new THREE.Group(), simple = new THREE.Group();
    this.parts.forEach((parts, index) => {
      if (!parts.length) {materials[index]!.dispose(); return;}
      const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
      if (!geometry) return;
      const mesh = new THREE.Mesh(geometry, materials[index]);
      mesh.castShadow = index < 2; mesh.receiveShadow = index < 2;
      mesh.userData.cityLight = index >= 2;
      if (index >= 2) mesh.userData.baseEmission = (materials[index] as THREE.MeshStandardMaterial).emissiveIntensity;
      detail.add(mesh);
      if (index < 2) simple.add(mesh.clone());
    });
    // Distant buildings retain solid silhouettes and a single rooftop light.
    const farLight = new THREE.Mesh(new THREE.BoxGeometry(radius * .24, .05, radius * .24), materials[2]);
    farLight.position.y = this.height; simple.add(farLight);
    const lod = new THREE.LOD(); lod.addLevel(detail, 0); lod.addLevel(simple, 130); group.add(lod);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(this.halfWidth * 2, this.height, this.halfWidth * 2),
      new THREE.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false, colorWrite: false}));
    hit.position.y = this.height / 2; group.add(hit);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.04, radius * 1.075, 48),
      new THREE.MeshBasicMaterial({color: input.color, transparent: true, opacity: .8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide}));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .025; ring.visible = false;
    ring.userData.selectionRing = true; group.add(ring);
    return {object: group, hit, radius: Math.max(radius, this.height * .55), spin: 0};
  }
}
function cityShape(kind: WorldShapeId): WorldShapeBuilder {
  return input => {
    const a = new Architecture(input), r = input.size, variant = (input.seed ?? 1) % 6;
    a.box(0, .025, 0, r * 1.85, .05, r * 1.85);
    if (kind === 'plaza') {
      a.box(0, .18, 0, r * 1.65, .25, r * 1.65);
      a.box(0, .34, 0, r * 1.25, .1, r * 1.25, 1);
      a.tower(0, 0, r * .52, r * .52, r * 2.1, 0);
      for (const side of [-1, 1]) a.tower(side * r * .58, -.12 * r, r * .25, r * .35, r * .85, 3);
      a.box(0, r * 1.1, 0, r * 1.3, .09, .14, 2);
    } else if (kind === 'district' || kind === 'landmark' || kind === 'unassigned') {
      const count = kind === 'district' ? 5 : 3;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2 + variant * .25;
        const h = r * (.6 + a.random() * 1.1 + (i === 0 ? .5 : 0));
        a.tower(Math.cos(angle) * r * .68, Math.sin(angle) * r * .68,
          r * (.42 + a.random() * .14), r * (.42 + a.random() * .12), h, variant + i);
      }
      a.box(0, .22, 0, r * 1.5, .34, r * 1.5, 1);
      a.box(0, .1, 0, r * .035, .015, r * 1.6, 3);
    } else if (kind === 'building') {
      if (variant % 3 === 1) {
        a.tower(-r * .3, 0, r * .45, r * .7, r * 1.8, variant);
        a.tower(r * .3, 0, r * .45, r * .7, r * 1.35, variant + 1);
        a.box(0, r, 0, r * .9, .12, .18, 2);
      } else a.tower(0, 0, r * .85, r * .85, r * 1.8, variant);
    } else if (kind === 'grid') {
      for (let i = -1; i <= 1; i++) {
        a.box(i * r * .6, .07, 0, .025, .015, r * 1.8, 2);
        a.box(0, .07, i * r * .6, r * 1.8, .015, .025, 2);
      }
      a.tower(-r * .55, -r * .55, r * .3, r * .3, r * .7, variant);
    } else {
      a.box(0, r * .35, -r * .9, r * 1.9, r * .7, r * .12, 1);
      a.box(-r * .9, r * .35, 0, r * .12, r * .7, r * 1.9, 1);
      a.box(0, .09, 0, r * 1.65, .06, r * 1.65, 2);
      a.box(r * .25, r * .2, -r * .35, r * .7, r * .3, r * .35);
    }
    const result = a.finish(r * 1.5);
    if (kind === 'plaza') {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * .1, r * .22, r * 3.6, 14, 1, true),
        new THREE.MeshBasicMaterial({color: input.color, transparent: true, opacity: .16,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
      beam.position.y = r * 1.75;
      beam.userData.beacon = true; beam.userData.baseOpacity = .16;
      result.object.add(beam);
    }
    return result;
  };
}
export const cityShapes: Partial<Record<WorldShapeId, WorldShapeBuilder>> = Object.fromEntries(
  (['plaza', 'district', 'landmark', 'building', 'grid', 'room', 'unassigned'] as WorldShapeId[]).map(kind => [kind, cityShape(kind)]));
