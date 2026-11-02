import {describe, expect, it} from 'vitest';
import {GraphIndex} from '../src/graph';
import {loadBrainData} from '../src/settings';
import {
  clearViewPositions, cloneWorldState, defaultThemeConfig, ensureView, newWorldState, removeWorldRefs, renameWorldRefs,
  resetThemeConfig, resolveAppearance, resolveLayout, resolveObjects, resolveTheme, setTheme, themeConfig, viewKey,
} from '../src/world/theme';
import {buildKnowledgeSnapshot} from '../src/world/snapshot';
import {cityTheme} from '../src/world/themes/city';
import {universeTheme} from '../src/world/themes/universe';
import type {KnowledgeWorldState, WorldThemeConfig} from '../src/world/types';

const graph = () => new GraphIndex([
  {id: 'root', title: '个人知识库', parents: [], links: [], issues: []},
  {id: 'ai', title: 'AI', parents: ['root'], links: [], issues: []},
  {id: 'note', title: 'Agent', parents: ['ai'], links: [], issues: []},
  {id: 'tools', title: '工具', parents: ['ai'], links: [], issues: []},
]);
const snapshot = () => buildKnowledgeSnapshot(graph(), {attention: 'root', root: 'root'}, {expanded: ['ai']}).snapshot;
const state = (): KnowledgeWorldState => newWorldState();

describe('knowledge world configuration', () => {
  it('starts from the theme role defaults and resolves layout and appearance per field', () => {
    const world = state(), config = themeConfig(world, 'universe');
    expect(config.mapping).toMatchObject({center: 'core', group: 'galaxy', member: 'level'});
    expect(config.appearance).toEqual({});
    expect(resolveAppearance(universeTheme, config).background).toBe(0x050d20);
    config.appearance.background = '#123456';
    config.layout.groupGap = 22;
    const appearance = resolveAppearance(universeTheme, config), layout = resolveLayout(universeTheme, config);
    expect(appearance.background).toBe(0x123456);
    // Untouched fields keep following the theme.
    expect(appearance.glow).toBeCloseTo(universeTheme.visuals.glow);
    expect(layout.groupGap).toBe(22);
    expect(layout.memberGap).toBe(universeTheme.layout.memberGap);
  });
  it('merges role defaults, object overrides and inherited group colours', () => {
    const world = state(), config = themeConfig(world, 'universe');
    config.mapping.member = 'orb';
    config.mapping.groups.ai = {color: '#ff0000', shape: 'station'};
    config.mapping.notes.note = {color: '#00ff00', icon: 'flask-conical', shape: 'orb'};
    const objects = resolveObjects(universeTheme, config, snapshot());
    const group = objects.find(object => object.id === 'ai')!;
    expect(group).toMatchObject({color: 0xff0000, shape: 'station'});
    // The member overrides the role shape and the inherited group colour.
    expect(objects.find(object => object.id === 'note')).toMatchObject({color: 0x00ff00, shape: 'orb', icon: 'flask-conical'});
    // A sibling without its own override keeps the role shape and inherits the group colour.
    expect(objects.find(object => object.id === 'tools')).toMatchObject({color: 0xff0000, shape: 'orb'});
    // Drilling into a note makes it the centre, so it uses the centre mapping instead.
    const drilled = buildKnowledgeSnapshot(graph(), {attention: 'ai', root: 'root'}).snapshot;
    expect(resolveObjects(universeTheme, config, drilled)[0]).toMatchObject({id: 'ai', role: 'center', shape: 'core'});
  });
  it('keeps each theme configuration and view independent', () => {
    const world = state();
    themeConfig(world, 'universe').appearance.glow = 1.2;
    themeConfig(world, 'city').appearance.glow = .1;
    expect(themeConfig(world, 'universe').appearance.glow).toBe(1.2);
    expect(themeConfig(world, 'city').appearance.glow).toBe(.1);
    const universeView = ensureView(world, 'universe', 'root');
    universeView.camera = {x: 1, y: 2, z: 3};
    const cityView = ensureView(world, 'city', 'root');
    cityView.camera = {x: 9, y: 8, z: 7};
    expect(world.views[viewKey('universe', 'root')]?.camera).toEqual({x: 1, y: 2, z: 3});
    expect(world.views[viewKey('city', 'root')]?.camera).toEqual({x: 9, y: 8, z: 7});
    setTheme(world, 'city');
    expect(world.theme).toBe('city');
    setTheme(world, 'universe');
    expect(world.views[viewKey('universe', 'root')]?.camera).toEqual({x: 1, y: 2, z: 3});
    expect(resolveTheme(world.theme).id).toBe('universe');
  });
  it('discards an edit when it is cancelled and keeps it when it is applied', () => {
    const world = state(), stored = themeConfig(world, 'universe');
    stored.appearance.palette = ['#111111'];
    const before = JSON.parse(JSON.stringify(stored)) as WorldThemeConfig;
    const draft = JSON.parse(JSON.stringify(stored)) as WorldThemeConfig;
    draft.appearance.background = '#abcdef';
    draft.mapping.member = 'orb';
    // Cancel: the stored configuration is untouched because the drawer only hands out copies.
    expect(stored).toEqual(before);
    themeConfig(world, 'universe').appearance = JSON.parse(JSON.stringify(before.appearance)) as WorldThemeConfig['appearance'];
    expect(themeConfig(world, 'universe').appearance.background).toBeUndefined();
    // Apply: the draft becomes the stored configuration.
    world.themes.universe = draft;
    expect(themeConfig(world, 'universe')).toMatchObject({mapping: {member: 'orb'}});
    expect(resolveAppearance(universeTheme, themeConfig(world, 'universe')).background).toBe(0xabcdef);
  });
  it('resets theme defaults without touching layouts and resets layouts per theme and level', () => {
    const world = state();
    const config = themeConfig(world, 'universe');
    config.appearance.background = '#123456';
    config.mapping.group = 'orb';
    config.layout.groupGap = 30;
    ensureView(world, 'universe', 'root').positions.deep = {x: 1, y: 1, z: 1};
    ensureView(world, 'city', 'root').positions.deep = {x: 2, y: 2, z: 2};
    resetThemeConfig(world, 'universe');
    expect(themeConfig(world, 'universe')).toEqual(defaultThemeConfig(universeTheme));
    expect(world.views[viewKey('universe', 'root')]?.positions).toEqual({deep: {x: 1, y: 1, z: 1}});
    clearViewPositions(world, 'universe', 'root');
    expect(world.views[viewKey('universe', 'root')]?.positions).toEqual({});
    // Resetting one world never clears the other world's layout record.
    expect(world.views[viewKey('city', 'root')]?.positions).toEqual({deep: {x: 2, y: 2, z: 2}});
  });
  it('falls back to the universe and repairs illegal fields one by one', () => {
    const raw = {knowledgeWorld: {version: 1, theme: 'atlantis', themes: {
      universe: {appearance: {background: 'not-a-colour', labelSize: 99, motion: false, glow: 'x'},
        layout: {groupGap: 999}, mapping: {member: 'nope', notes: {note: {color: 'bad', shape: 'planet', icon: 'x'}}}},
      city: 'broken',
    }, views: {
      'universe:root': {camera: {x: 0, y: 20, z: 30}, target: {x: 0, y: 0, z: 0},
        positions: {note: {x: 1, y: 0, z: 2}}, expanded: ['ai']},
      'atlantis:root': {camera: {x: 0, y: 5, z: 5}, target: {x: 0, y: 0, z: 0}, positions: {}},
    }}};
    const world = loadBrainData({...raw, version: 4}).knowledgeWorld;
    expect(world.theme).toBe('universe');
    expect(Object.keys(world.themes).sort()).toEqual(['city', 'universe']);
    const universe = world.themes.universe!;
    expect(universe.appearance.background).toBeUndefined();
    expect(universe.appearance.labelSize).toBe(2);
    expect(universe.appearance.glow).toBeUndefined();
    expect(universe.appearance.motion).toBe(false);
    expect(universe.layout.groupGap).toBe(40);
    expect(universe.mapping.member).toBe('level');
    // An illegal colour is dropped, the legal shape and icon survive.
    expect(universe.mapping.notes.note).toEqual({shape: 'planet', icon: 'x'});
    expect(Object.keys(world.views)).toEqual(['universe:root']);
  });
  it('migrates every theme reference on rename and clears deleted references', () => {
    const world = state();
    themeConfig(world, 'universe').mapping.notes['Folder/note'] = {color: '#00ff00'};
    themeConfig(world, 'city').mapping.groups.ai = {color: '#ff0000'};
    ensureView(world, 'universe', 'Folder/note').positions['Folder/note'] = {x: 1, y: 1, z: 1};
    ensureView(world, 'universe', 'Folder/note').expanded.push('Folder/note');
    ensureView(world, 'city', 'root').positions['Folder/note'] = {x: 2, y: 2, z: 2};
    const rename = (path: string) => path === 'Folder/note' || path.startsWith('Folder/') ? `Moved/${path.slice(7)}` : path;
    renameWorldRefs(world, rename);
    expect(themeConfig(world, 'universe').mapping.notes['Moved/note']).toEqual({color: '#00ff00'});
    expect(world.views[viewKey('universe', 'Moved/note')]?.positions['Moved/note']).toEqual({x: 1, y: 1, z: 1});
    expect(world.views[viewKey('universe', 'Moved/note')]?.expanded).toEqual(['Moved/note']);
    expect(world.views[viewKey('city', 'root')]?.positions['Moved/note']).toEqual({x: 2, y: 2, z: 2});
    removeWorldRefs(world, id => id === 'Moved/note' || id === 'ai');
    expect(themeConfig(world, 'universe').mapping.notes['Moved/note']).toBeUndefined();
    expect(themeConfig(world, 'city').mapping.groups.ai).toBeUndefined();
    expect(world.views[viewKey('universe', 'Moved/note')]).toBeUndefined();
    expect(world.views[viewKey('city', 'root')]?.positions).toEqual({});
  });
  it('never mutates knowledge when a theme or its configuration changes', () => {
    const source = graph(), before = JSON.stringify(source.all());
    const world = state(), built = buildKnowledgeSnapshot(source, {attention: 'root', root: 'root'}).snapshot;
    setTheme(world, 'city');
    themeConfig(world, 'city').appearance.modelScale = 2;
    themeConfig(world, 'city').mapping.notes.note = {shape: 'room'};
    resolveObjects(cityTheme, themeConfig(world, 'city'), built);
    expect(JSON.stringify(source.all())).toBe(before);
    expect(built.groups.some(group => group.id === 'ai')).toBe(true);
    expect(built.notes.some(note => note.id === 'note')).toBe(true);
    expect(cloneWorldState(world)).not.toBe(world);
  });
  it('groups only actual directory children', () => {
 const built = buildKnowledgeSnapshot(graph(), {attention: 'root', root: 'root'}).snapshot;
 expect(built.groups.map(g=>g.id)).toEqual(['ai']);
});
});
