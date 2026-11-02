// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldInteraction, type InteractionHost} from '../src/world/interaction';
import {WorldLabels} from '../src/world/labels';
import type {WorldBody, WorldObject, WorldThemeDefinition} from '../src/world/types';
import {cityTheme} from '../src/world/themes/city';
import {universeTheme} from '../src/world/themes/universe';

const object = (id: string, role: WorldObject['role'], domain: string, level = 1): WorldObject => ({
  id, title: id, role, level, depth: level, shape: role === 'group' ? 'galaxy' : 'planet', color: 0xffffff,
  size: 1, detail: 1, count: 1, hidden: 0, enter: false, expandable: false, domain,
});
function body(target: WorldObject, x: number, z = 0): WorldBody {
  const group = new THREE.Group(), hit = new THREE.Mesh(new THREE.SphereGeometry(.4), new THREE.MeshBasicMaterial());
  group.position.set(x, 0, z); group.add(hit);
  return {object: target, group, hit, radius: 1, spin: .1};
}
let cleanup: (() => void) | undefined;
afterEach(() => {cleanup?.(); cleanup = undefined; document.body.replaceChildren();});
function setup(theme: WorldThemeDefinition = universeTheme, position = new THREE.Vector3(0, 0, 10)) {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {return {};}});
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, .1, 100); camera.position.copy(position); camera.lookAt(0, 0, 0);
  const group = body(object('domain', 'group', 'domain'), 0);
  const member = body(object('satellite', 'member', 'domain', 2), 2);
  const bodies = [group, member];
  const host: InteractionHost = {camera, controls: {enabled: true} as OrbitControls, bodies: () => bodies,
    theme: () => theme, layoutEnabled: () => true, select: vi.fn(), edit: vi.fn(), context: vi.fn(), hover: vi.fn(), moved: vi.fn(), save: vi.fn()};
  const input = new WorldInteraction(canvas, host);
  cleanup = () => {
    input.destroy();
    for (const entry of bodies) {entry.hit.geometry.dispose(); (entry.hit.material as THREE.Material).dispose();}
  };
  function pointer(type: string, x = 400, y = 300, id = 1) {
    const event = new MouseEvent(type, {clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true});
    Object.defineProperty(event, 'pointerId', {value: id}); canvas.dispatchEvent(event);
  }
  return {host, bodies, pointer, input};
}
describe('world raycast interaction', () => {
  it('selects the mesh immediately and edits only on a second click', () => {
    const {host, pointer} = setup(); pointer('pointerdown'); pointer('pointerup');
    expect(host.select).toHaveBeenCalledExactlyOnceWith('domain'); expect(host.edit).not.toHaveBeenCalled();
    pointer('pointerdown'); pointer('pointerup'); expect(host.edit).toHaveBeenCalledExactlyOnceWith('domain');
    expect(host.controls.enabled).toBe(true);
  });
  it('moves a domain and its members together without opening a note', () => {
    const {host, bodies, pointer} = setup(); pointer('pointerdown'); pointer('pointermove', 500); pointer('pointerup', 500);
    expect(bodies[0]!.group.position.x).toBeGreaterThan(1);
    expect(bodies[1]!.group.position.x - bodies[0]!.group.position.x).toBeCloseTo(2);
    expect(host.select).not.toHaveBeenCalled(); expect(host.save).toHaveBeenCalledOnce();
  });
  it('restores all dragged positions on Escape and ignores another pointer', () => {
    const {host, bodies, pointer} = setup(); pointer('pointerdown'); pointer('pointermove', 500, 300, 2);
    expect(bodies[0]!.group.position.x).toBe(0); pointer('pointermove', 500);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); pointer('pointerup', 500);
    expect(bodies.map(entry => entry.group.position.x)).toEqual([0, 2]); expect(host.controls.enabled).toBe(true);
    expect(host.save).not.toHaveBeenCalled(); expect(host.select).not.toHaveBeenCalled();
  });
  it('drags a note along the city ground plane without lifting it', () => {
    const {host, bodies, pointer} = setup(cityTheme, new THREE.Vector3(0, 16, 16));
    pointer('pointerdown'); pointer('pointermove', 460, 340); pointer('pointerup', 460, 340);
    expect(bodies[0]!.group.position.y).toBeCloseTo(0, 6);
    expect(bodies[0]!.group.position.x).not.toBe(0);
    expect(host.save).toHaveBeenCalledOnce();
  });
  it('leaves empty-space orbit gestures alone and removes event handlers on disposal', () => {
    const {host, pointer, input} = setup(); pointer('pointerdown', 10, 10); pointer('pointerup', 10, 10);
    expect(host.controls.enabled).toBe(true); expect(host.select).not.toHaveBeenCalled();
    input.destroy(); pointer('pointerdown'); pointer('pointerup'); expect(host.select).not.toHaveBeenCalled();
  });
  it('keeps domain labels stationary when hovered so pointer clicks reach the same button', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const {host} = setup();
    const bodies = [body(object('one', 'group', 'one'), -1), body(object('two', 'group', 'two'), 1),
      body(object('three', 'group', 'three'), 2.5)];
    host.camera.updateMatrixWorld();
    const labels = new WorldLabels(document.body, universeTheme, {...host, enter: vi.fn(), expand: vi.fn()});
    labels.rebuild(bodies); labels.update(host.camera, 679, 544, 1);
    const positions = () => [...labels.element.querySelectorAll<HTMLElement>('.brain-world-label')].map(entry => entry.style.transform);
    const before = positions();
    labels.update(host.camera, 679, 544, 1, undefined, 'two');
    expect(positions()).toEqual(before);
    labels.destroy(); context.mockRestore();
    for (const entry of bodies) {entry.hit.geometry.dispose(); (entry.hit.material as THREE.Material).dispose();}
  });
  it('keeps the top-right column clear for the shared search icon and the world icon rail', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const width = 800, height = 600;
    const camera = new THREE.PerspectiveCamera(45, width / height, .1, 100);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    // Member labels auto-place under their note, so these two project to y=120 mirrored on x:
    // the first sits inside the rail column, the second on the clear left half.
    const covered = body(object('covered', 'member', 'domain', 2), 0);
    covered.group.position.set(20.7, 12.42, -40);
    const clear = body(object('clear', 'member', 'domain', 2), 0);
    clear.group.position.set(-20.7, 12.42, -40);
    const labels = new WorldLabels(document.body, universeTheme,
      {select: vi.fn(), enter: vi.fn(), expand: vi.fn(), context: vi.fn(), hover: vi.fn()});
    labels.rebuild([covered, clear]); labels.update(camera, width, height, 1);
    const anchor = (id: string) => {
      const element = labels.element.querySelector<HTMLElement>(`.brain-world-label[data-note-id='${id}']`)!;
      const [, x, y] = /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(element.style.transform)!;
      return {element, x: Number(x), y: Number(y)};
    };
    const target = anchor('covered');
    expect(target.x).toBeGreaterThan(width - 140);
    expect(target.y).toBeLessThan(212);
    expect(target.element.hidden).toBe(true);
    expect(anchor('clear').element.hidden).toBe(true); // Distant members now reveal their title on focus.
    labels.update(camera, width, height, 1, 'clear');
    expect(anchor('clear').element.hidden).toBe(false);
    labels.destroy(); context.mockRestore();
    for (const entry of [covered, clear]) {entry.hit.geometry.dispose(); (entry.hit.material as THREE.Material).dispose();}
  });
  it('keeps global labels free of inline actions and exposes the theme level as a title', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const entry = body({...object('domain', 'group', 'domain'), enter: true}, 0);
    const universe = new WorldLabels(document.body, universeTheme, {select: vi.fn(), enter: vi.fn(), expand: vi.fn(),
      context: vi.fn(), hover: vi.fn()});
    universe.rebuild([entry]);
    expect(universe.element.querySelector('.brain-world-action')).toBeNull();
    expect(universe.element.querySelector('button')?.title).toContain('星系');
    const city = new WorldLabels(document.body, cityTheme, {select: vi.fn(), enter: vi.fn(), expand: vi.fn(),
      context: vi.fn(), hover: vi.fn()});
    city.rebuild([entry]);
    expect(city.element.querySelector('.brain-world-action')).toBeNull();
    expect(city.element.querySelector('button')?.title).toContain('分区');
    universe.destroy(); city.destroy(); context.mockRestore();
    entry.hit.geometry.dispose(); (entry.hit.material as THREE.Material).dispose();
  });
});
