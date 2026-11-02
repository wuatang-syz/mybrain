import * as THREE from 'three';
import type {ShapeInput, ShapeResult, WorldShapeBuilder} from '../types';

/** Emissive surface used by the shared ladder tail so both themes fade identically. */
function facet(color: number, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .28,
    roughness: .5, metalness: .18, transparent: opacity < 1, opacity});
}
function solid(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({color, transparent: opacity < 1, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
}

/**
 * A flat sided prism. `sides` drives the shared polygon ladder: eight sides down to three, then
 * `point` uses a tiny faceted sphere that stays raycastable so selection and dragging keep working.
 */
function prism(input: ShapeInput, sides: number): ShapeResult {
  const {color, size, detail} = input, radius = Math.max(.05, size);
  const group = new THREE.Group();
  const height = radius * 1.25;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * .92, height, sides, 1), facet(color));
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({color, transparent: true, opacity: .72, toneMapped: false}));
  outline.rotation.copy(body.rotation);
  group.add(outline);
  return {object: group, hit: body, radius, spin: detail ? .12 : .06};
}

function pointShape(input: ShapeInput): ShapeResult {
  const {color, size} = input, radius = Math.max(.08, size);
  const group = new THREE.Group();
  const hit = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), facet(color));
  group.add(hit, new THREE.Mesh(new THREE.SphereGeometry(radius * 1.9, 8, 6), solid(color, .18)));
  return {object: group, hit, radius: radius * 1.9, spin: .3};
}

/** The neutral bucket shape: a muted pedestal so unassigned notes never borrow a ladder level. */
function unassignedShape(input: ShapeInput): ShapeResult {
  const {color, size, detail} = input, radius = Math.max(.2, size);
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.18, radius * .5, 8, 1), facet(color, .92));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * .55, radius * .8, radius * .9, 8, 1), facet(color, .95));
  cap.position.y = radius * .7;
  group.add(base, cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.05, radius * .05, 4, 32), facet(color, .8));
  ring.rotation.x = Math.PI / 2; group.add(ring);
  return {object: group, hit: cap, radius: radius * 1.2, spin: .04 + detail * .01};
}

export const tailShapes: Partial<Record<import('../types').WorldShapeId, WorldShapeBuilder>> = {
  octagon: input => prism(input, 8),
  heptagon: input => prism(input, 7),
  hexagon: input => prism(input, 6),
  pentagon: input => prism(input, 5),
  quad: input => prism(input, 4),
  triangle: input => prism(input, 3),
  point: pointShape,
  unassigned: unassignedShape,
};
