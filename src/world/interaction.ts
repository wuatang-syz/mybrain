import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CENTER_ID} from './theme';
import type {WorldBody, WorldThemeDefinition} from './types';

export interface InteractionHost {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  bodies(): WorldBody[];
  theme(): WorldThemeDefinition;
  select(id: string): void;
  edit(id: string): void;
  context(id: string, e: MouseEvent): void;
  hover(id?: string): void;
  layoutEnabled?(): boolean;
  interrupt?(): void;
  activate?(id: string): void;
  moved(): void;
  save(): void;
}
interface Drag {body: WorldBody; pointer: number; x: number; y: number; start: THREE.Vector3; anchor: THREE.Vector3; moved: boolean}

/**
 * Raycast interaction shared by every theme. The theme only decides where dragging happens: the
 * universe keeps dragging on the camera plane while the city drags along its ground plane.
 */
export class WorldInteraction {
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane();
  private drag?: Drag;
  private cleanup: (() => void)[] = [];
  private lastClick = {id: '', time: 0};
  constructor(private canvas: HTMLCanvasElement, private host: InteractionHost) {
    const win = canvas.ownerDocument.defaultView!;
    const listen = (target: EventTarget, name: string, listener: EventListener, capture = false) => {
      target.addEventListener(name, listener, capture); this.cleanup.push(() => target.removeEventListener(name, listener, capture));
    };
    listen(canvas, 'pointerdown', event => this.down(event as PointerEvent), true);
    listen(win, 'pointermove', event => this.move(event as PointerEvent), true);
    listen(win, 'pointerup', event => this.up(event as PointerEvent), true);
    listen(win, 'pointercancel', () => this.cancel()); listen(win, 'blur', () => this.cancel());
    listen(canvas, 'pointerleave', () => {if (!this.drag) this.host.hover();});
    listen(win, 'keydown', event => {if ((event as KeyboardEvent).key === 'Escape') this.cancel();});
    listen(canvas, 'contextmenu', event => {
      const pointer = event as MouseEvent, hit = this.hit(pointer);
      if (hit && hit.object.id !== CENTER_ID) {pointer.preventDefault(); this.host.context(hit.object.id, pointer);}
    });
  }
  private ray(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.host.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), this.host.camera);
  }
  private hit(event: MouseEvent): WorldBody | undefined {
    this.ray(event);
    const bodies = this.host.bodies();
    for (const body of bodies) body.group.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(bodies.map(body => body.hit), false)[0];
    return hit ? bodies.find(body => body.hit === hit.object) : undefined;
  }
  private dragPlane(body: WorldBody): void {
    const ground = this.host.theme().layout.plane === 'ground';
    const normal = ground ? new THREE.Vector3(0, 1, 0) : this.host.camera.getWorldDirection(new THREE.Vector3());
    // A camera looking straight along the ground makes that plane degenerate, so fall back to the
    // camera plane instead of silently refusing to drag.
    const grazing = ground && Math.abs(this.raycaster.ray.direction.dot(normal)) < .15;
    const used = grazing ? this.host.camera.getWorldDirection(new THREE.Vector3()) : normal;
    this.plane.setFromNormalAndCoplanarPoint(used, body.group.position);
  }
  private down(event: PointerEvent): void {
    if (event.button !== 0 || this.drag) return;
    this.host.interrupt?.();
    const body = this.hit(event); if (!body) return;
    event.preventDefault(); if (this.host.layoutEnabled?.()) {event.stopImmediatePropagation(); this.host.controls.enabled = false;}
    this.dragPlane(body);
    const anchor = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3()) ?? body.group.position.clone();
    this.drag = {body, pointer: event.pointerId, x: event.clientX, y: event.clientY, start: body.group.position.clone(), anchor, moved: false};
  }
  private move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      if (event.target === this.canvas && event.buttons === 0) {
        const body = this.hit(event); this.host.hover(body?.object.id);
        this.canvas.classList.remove('brain-cursor-grabbing');
        this.canvas.classList.toggle('brain-cursor-pointer', Boolean(body));
        this.canvas.classList.toggle('brain-cursor-grab', !body);
      }
      return;
    }
    if (event.pointerId !== drag.pointer) return;
    if (this.host.layoutEnabled?.()) {event.preventDefault(); event.stopImmediatePropagation();}
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5;
    if (!this.host.layoutEnabled?.() || !drag.moved || drag.body.object.role === 'center') return;
    this.ray(event);
    const point = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!point) return;
    const next = drag.start.clone().add(point.sub(drag.anchor));
    const delta = next.clone().sub(drag.body.group.position);
    // Dragging a domain carries its members; dragging a note only moves that note.
    if (drag.body.object.role === 'group') {
      for (const member of this.host.bodies()) {
        if (member.object.role === 'member' && member.object.domain === drag.body.object.id) member.group.position.add(delta);
      }
    }
    drag.body.group.position.copy(next); this.canvas.classList.remove('brain-cursor-grab', 'brain-cursor-pointer'); this.canvas.classList.add('brain-cursor-grabbing'); this.host.moved();
  }
  private up(event: PointerEvent): void {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    if (this.host.layoutEnabled?.()) {event.preventDefault(); event.stopImmediatePropagation();} this.drag = undefined; this.host.controls.enabled = true;
    this.canvas.classList.remove('brain-cursor-grab', 'brain-cursor-grabbing'); this.canvas.classList.add('brain-cursor-pointer');
    if (drag.moved) {this.lastClick = {id: '', time: 0}; if (this.host.layoutEnabled?.()) this.host.save(); return;}
    const id = drag.body.object.id; if (id === CENTER_ID) return;
    const now = Date.now(), double = this.lastClick.id === id && now - this.lastClick.time < 350;
    this.lastClick = double ? {id: '', time: 0} : {id, time: now};
    if (double) (this.host.activate ?? this.host.edit)(id); else this.host.select(id);
  }
  cancel(): void {
    const drag = this.drag; if (!drag) return;
    const delta = drag.start.clone().sub(drag.body.group.position);
    if (drag.body.object.role === 'group') {
      for (const member of this.host.bodies()) {
        if (member.object.role === 'member' && member.object.domain === drag.body.object.id) member.group.position.add(delta);
      }
    }
    drag.body.group.position.copy(drag.start); this.drag = undefined;
    this.host.controls.enabled = true; this.host.moved();
  }
  destroy(): void {this.cancel(); for (const cleanup of this.cleanup) cleanup(); this.cleanup = [];}
}
