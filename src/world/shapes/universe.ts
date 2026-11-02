import * as THREE from 'three';
import type {ShapeInput, ShapeResult, WorldShapeBuilder} from '../types';

/** Additive luminous material, used for rings, beams and glows. */
function luminous(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({color: new THREE.Color(color).multiplyScalar(1.6), transparent: opacity < 1,
    opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
}
function ring(radius: number, tube: number, color: number, opacity = .6): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 96), luminous(color, opacity));
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}
function surfaceMaterial(color: number, small: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({color, emissive: color, emissiveIntensity: small ? .8 : .62,
    roughness: .48, metalness: .3});
}
/** Fresnel atmosphere that follows the camera and the sphere surface. */
function atmosphere(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {tint: {value: new THREE.Color(color)}, strength: {value: .72}},
    vertexShader: `varying vec3 vNormal; varying vec3 vView;
      void main(){ vec4 p=modelViewMatrix*vec4(position,1.); vNormal=normalize(normalMatrix*normal);
        vView=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
    fragmentShader: `uniform vec3 tint; uniform float strength; varying vec3 vNormal; varying vec3 vView;
      void main(){ float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),3.2);
        gl_FragColor=vec4(tint*1.7,rim*strength); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
function outline(mesh: THREE.Mesh, color: number, opacity = .9): THREE.LineSegments {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({color, transparent: true, opacity, toneMapped: false}));
  edges.position.copy(mesh.position); edges.rotation.copy(mesh.rotation);
  return edges;
}
/** 知识晶核: the faceted observatory that keeps the current centre look. */
function core(input: ShapeInput): ShapeResult {
  const scale = Math.max(.3, input.size / 2.1), group = new THREE.Group();
  const baseMaterial = new THREE.MeshStandardMaterial({color: 0x202647, metalness: .78, roughness: .24,
    emissive: 0x435ae0, emissiveIntensity: .22});
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * scale, 2.35 * scale, .42 * scale, 12), baseMaterial);
  base.position.y = -.3 * scale; group.add(base);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * scale, 2.1 * scale, .2 * scale, 12), baseMaterial.clone());
  floor.position.y = .01 * scale; group.add(floor);
  for (let index = 0; index < 4; index++) {
    const orbit = ring((1.75 + index * .29) * scale, (index === 1 ? .04 : .018) * scale,
      index % 2 ? 0x6c93ff : 0x84efff, .72 - index * .12);
    orbit.position.y = (-.07 - index * .08) * scale; group.add(orbit);
  }
  const towers = [{x: 0, z: 0, h: 3.5, r: .46}, {x: -.9, z: .2, h: 2.15, r: .3},
    {x: .82, z: -.32, h: 2.5, r: .32}, {x: .45, z: 1.05, h: 1.45, r: .26}, {x: -.55, z: -1, h: 1.8, r: .24}];
  const accent = input.appearance.building;
  for (const [index, tower] of towers.entries()) {
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(tower.r * .72 * scale, tower.r * scale, tower.h * scale, 5),
      new THREE.MeshPhysicalMaterial({color: index % 2 ? accent : 0x9e9eff, metalness: .32, roughness: .16,
        emissive: index % 2 ? 0x277dcf : 0x544bd4, emissiveIntensity: .75, transparent: true, opacity: .86, clearcoat: 1}));
    crystal.position.set(tower.x * scale, (tower.h / 2 + .1) * scale, tower.z * scale);
    group.add(crystal, outline(crystal, 0xa8dcff));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(tower.r * .73 * scale, .72 * scale, 5), crystal.material);
    tip.position.set(tower.x * scale, (tower.h + .44) * scale, tower.z * scale); group.add(tip);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(.026 * scale, .026 * scale, (tower.h + .25) * scale, 6), luminous(0x9fefff));
    glow.position.set(tower.x * scale, (tower.h / 2 + .2) * scale, (tower.z + tower.r * .8) * scale); group.add(glow);
  }
  const light = new THREE.PointLight(0x849eff, 12, 15 * scale, 2);
  light.position.set(0, 2.5 * scale, scale); group.add(light);
  return {object: group, hit: base, radius: 2.2 * scale, spin: 0};
}
/** 星系 and 行星 share the ringed body; the planet is the smaller, cheaper variant. */
function ringedBody(input: ShapeInput, small: boolean): ShapeResult {
  const group = new THREE.Group(), radius = Math.max(.12, input.size), detail = small ? 1 : 2;
  const segments = input.detail > 1 ? (small ? 32 : 48) : small ? 20 : 32;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(12, segments * .66)),
    surfaceMaterial(input.color, small));
  group.add(sphere);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.1, segments, Math.max(10, segments * .55)), atmosphere(input.color)));
  const system = new THREE.Group();
  system.rotation.z = .14; system.rotation.x = -.13;
  system.add(ring(radius * 1.32, .023 * Math.max(.4, radius * .5), input.color, .8));
  if (!small) system.add(ring(radius * 1.7, .012 * Math.max(.4, radius * .5), input.color, .38));
  const band = new THREE.Mesh(new THREE.RingGeometry(radius * 1.24, radius * 1.52, 96),
    new THREE.MeshBasicMaterial({color: input.color, transparent: true, opacity: .09, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false}));
  band.rotation.x = -Math.PI / 2; system.add(band);
  group.add(system);
  if (!small) group.add(ring(3.2 * (radius / 1.95), .008, input.color, .2));
  void detail;
  return {object: group, hit: sphere, radius: radius * 1.32, spin: small ? .06 : .045};
}
/** 浮岛·基地: a hovering platform with an underside spike and a beacon. */
function island(input: ShapeInput): ShapeResult {
  const group = new THREE.Group(), radius = Math.max(.1, input.size);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * .82, radius * .34, 6),
    new THREE.MeshStandardMaterial({color: input.color, roughness: .55, metalness: .25, emissive: input.color, emissiveIntensity: .22}));
  platform.rotation.y = Math.PI / 6; group.add(platform, outline(platform, input.appearance.building, .55));
  const spike = new THREE.Mesh(new THREE.ConeGeometry(radius * .7, radius * 1.15, 6),
    new THREE.MeshStandardMaterial({color: input.appearance.building, roughness: .6, metalness: .2, flatShading: true}));
  spike.rotation.x = Math.PI; spike.position.y = -radius * .7; group.add(spike);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(radius * .07, radius * .09, radius * .9, 5), luminous(input.appearance.building, .8));
  mast.position.y = radius * .5; group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(radius * .16, 10, 8), luminous(input.color));
  beacon.position.y = radius * .98; group.add(beacon);
  group.add(ring(radius * 1.15, radius * .03, input.color, .35));
  return {object: group, hit: platform, radius: radius * 1.3, spin: .12};
}
/** 空间站: a ring station with spokes and a hub. */
function station(input: ShapeInput): ShapeResult {
  const group = new THREE.Group(), radius = Math.max(.1, input.size);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * .14, 8, 32),
    new THREE.MeshStandardMaterial({color: input.appearance.building, roughness: .4, metalness: .55,
      emissive: input.color, emissiveIntensity: .3}));
  wheel.rotation.x = Math.PI / 2.3; group.add(wheel);
  for (let index = 0; index < 4; index++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.9, radius * .07, radius * .07),
      new THREE.MeshStandardMaterial({color: input.color, roughness: .5, metalness: .4}));
    spoke.rotation.y = index * Math.PI / 4; group.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * .26, radius * .26, radius * .7, 8),
    new THREE.MeshStandardMaterial({color: input.appearance.building, roughness: .35, metalness: .6,
      emissive: input.color, emissiveIntensity: .4}));
  group.add(hub, outline(hub, input.color, .6));
  return {object: group, hit: hub, radius: radius * 1.15, spin: .18};
}
/** 光球: a glowing translucent orb. */
function orb(input: ShapeInput): ShapeResult {
  const group = new THREE.Group(), radius = Math.max(.1, input.size);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18),
    new THREE.MeshStandardMaterial({color: input.color, emissive: input.color, emissiveIntensity: 1.1,
      roughness: .35, metalness: .1, transparent: true, opacity: .92}));
  group.add(sphere);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.45, 20, 14), luminous(input.color, .22)));
  return {object: group, hit: sphere, radius: radius * 1.45, spin: .3};
}

export const universeShapes: Partial<Record<import('../types').WorldShapeId, WorldShapeBuilder>> = {
  core,
  galaxy: input => ringedBody(input, false),
  planet: input => ringedBody(input, true),
  island,
  station,
  orb,
};
