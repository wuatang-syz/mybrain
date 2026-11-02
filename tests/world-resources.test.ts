// @vitest-environment jsdom
import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {GraphIndex} from '../src/graph';
import {buildKnowledgeSnapshot} from '../src/world/snapshot';
import {WorldScene} from '../src/world/scene';
import {newWorldState, themeConfig} from '../src/world/theme';
import {cityTheme} from '../src/world/themes/city';
import {universeTheme} from '../src/world/themes/universe';

const graph = () => new GraphIndex([
  {id: 'root', title: '个人知识库', parents: [], links: [], issues: []},
  {id: 'ai', title: 'AI', parents: ['root'], links: [], issues: []},
  {id: 'note', title: 'Agent', parents: ['ai'], links: [], issues: []},
]);
const snapshot = () => buildKnowledgeSnapshot(graph(), {attention: 'root', root: 'root'}).snapshot;

afterEach(() => {vi.restoreAllMocks();});

describe('world scene resources', () => {
  it('builds one body per resolved object and disposes every geometry and material on release', () => {
    const scene = new WorldScene(cityTheme, themeConfig(newWorldState(), 'city'));
    scene.build(snapshot(), undefined);
    expect(scene.bodies.map(body => body.object.role)).toEqual(['center', 'group', 'member']);
    const geometries = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materials = vi.spyOn(THREE.Material.prototype, 'dispose');
    scene.dispose();
    expect(geometries.mock.calls.length).toBeGreaterThan(3);
    expect(materials.mock.calls.length).toBeGreaterThan(3);
    expect(scene.bodies).toHaveLength(0);
    expect(scene.root.children).toHaveLength(0);
  });
  it('rebuilds from the same snapshot when the configuration changes and never rescans the graph', () => {
    const source = graph(), before = JSON.stringify(source.all());
    const scene = new WorldScene(universeTheme, themeConfig(newWorldState(), 'universe'));
    scene.build(snapshot(), undefined);
    const seeded = scene.bodies.find(body => body.object.id === 'note')!;
    const config = themeConfig(newWorldState(), 'universe');
    config.appearance.modelScale = 2;
    config.mapping.notes.note = {color: '#00ff00', shape: 'orb'};
    scene.setConfig(config);
    scene.build(snapshot(), undefined);
    const updated = scene.bodies.find(body => body.object.id === 'note')!;
    expect(updated.object.color).toBe(0x00ff00);
    expect(updated.object.shape).toBe('orb');
    expect(updated.group.position.toArray()).toEqual(seeded.group.position.toArray());
    expect(JSON.stringify(source.all())).toBe(before);
    scene.dispose();
  });
  it('keeps manual positions when appearance or layout settings change', () => {
    const built = snapshot();
    const view = {camera: {x: 0, y: 20, z: 30}, target: {x: 0, y: 0, z: 0},
      positions: {note: {x: 7, y: 0, z: -3}}, expanded: []};
    const scene = new WorldScene(cityTheme, themeConfig(newWorldState(), 'city'));
    scene.build(built, view);
    expect(scene.bodies.find(body => body.object.id === 'note')?.group.position.toArray()).toEqual([7, 0, -3]);
    // Layout parameters only move automatically placed objects; the dragged note keeps its spot.
    const config = themeConfig(newWorldState(), 'city');
    config.layout.groupGap = 30;
    config.layout.memberGap = 8;
    scene.setConfig(config);
    scene.build(built, view);
    expect(scene.bodies.find(body => body.object.id === 'note')?.group.position.toArray()).toEqual([7, 0, -3]);
    // 重置布局 clears that record, so the note returns to its automatic position.
    scene.build(built, {...view, positions: {}});
    expect(scene.bodies.find(body => body.object.id === 'note')?.group.position.toArray()).not.toEqual([7, 0, -3]);
    scene.dispose();
  });
});
