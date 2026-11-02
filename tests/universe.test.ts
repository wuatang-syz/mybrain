import {describe, expect, it} from 'vitest';
import {GraphIndex} from '../src/graph';
import {loadBrainData} from '../src/settings';
import {LEVEL_COUNT, POINT_LEVEL, POLYGON_POINT_TAIL, ladderIndex, ladderLevel} from '../src/world/levels';
import {newWorldState, resolveObjects, resolveTheme, sanitizeLegacyUniverse, themeConfig, viewKey} from '../src/world/theme';
import {buildKnowledgeSnapshot} from '../src/world/snapshot';
import {WorldScene} from '../src/world/scene';
import {cityTheme} from '../src/world/themes/city';
import {universeTheme} from '../src/world/themes/universe';
import type {UniverseState} from '../src/model/types';

const graph = () => new GraphIndex([
  {id: 'root', title: '个人知识库', parents: [], links: [], issues: []},
  {id: 'ai', title: 'AI', parents: ['root'], links: [], issues: []},
  {id: 'note', title: 'Agent', parents: ['ai'], links: [], issues: []},
  {id: 'deep', title: '工具调用', parents: ['note'], links: [], issues: []},
  {id: 'loose', title: '灵感', parents: [], links: [], issues: []},
]);
const saved = (): UniverseState => ({version: 1, level: 'root', camera: {x: 0, y: 25, z: 40}, target: {x: 0, y: 0, z: 0},
  positions: {note: {x: 5, y: 1, z: 9}}, motion: false});
const built = (budget = 200) => buildKnowledgeSnapshot(graph(), {attention: 'root', root: 'root'},
  {budget, expanded: ['ai']});

describe('knowledge world data and persistence', () => {
  it('uses the real attention note as the world centre and keeps groups at depth one', () => {
    const {snapshot} = built();
    expect(snapshot.level).toEqual({id: 'root', title: '个人知识库'});
    expect(snapshot.groups.find(group => group.id === 'ai')).toMatchObject({depth: 1, drillable: true});
    expect(snapshot.notes.find(note => note.id === 'note')).toMatchObject({group: 'ai', depth: 2});
    // Depth follows the displayed ownership path, so a grandchild sits one ladder step lower.
    expect(snapshot.notes.find(note => note.id === 'deep')).toMatchObject({group: 'ai', depth: 3});
    expect(snapshot.stats.groups).toBe(1);
  });
  it('does not create synthetic unassigned groups for notes outside this directory', () => {
 const {snapshot} = built();
 expect(snapshot.groups.map(g=>g.id)).toEqual(['ai']);
 expect(snapshot.notes.some(n=>n.id==='loose')).toBe(false);
});
  it('maps depth onto the shared ladder and clamps everything deeper to a point', () => {
    expect(universeTheme.levels).toHaveLength(LEVEL_COUNT);
    expect(cityTheme.levels).toHaveLength(LEVEL_COUNT);
    for (const [index, level] of POLYGON_POINT_TAIL.entries()) {
      expect(universeTheme.levels[index + 6]).toEqual(level);
      expect(cityTheme.levels[index + 6]).toEqual(level);
    }
    expect(ladderIndex(2)).toBe(2);
    expect(ladderIndex(99)).toBe(POINT_LEVEL);
    expect(ladderLevel(universeTheme.levels, 3).name).toBe('浮岛·基地');
    expect(ladderLevel(cityTheme.levels, 4).name).toBe('地面街区网格');
  });
  it('resolves role defaults, ladder shapes and inherited group colours per theme', () => {
    const {snapshot} = built(), config = themeConfig(newWorldState(), 'universe');
    const objects = resolveObjects(universeTheme, config, snapshot);
    expect(objects[0]).toMatchObject({id: 'root', role: 'center', shape: 'core', level: 0});
    const group = objects.find(object => object.id === 'ai')!;
    expect(group).toMatchObject({role: 'group', shape: 'galaxy', level: 1});
    expect(objects.find(object => object.id === 'note')).toMatchObject({role: 'member', shape: 'planet', level: 2});
    expect(objects.find(object => object.id === 'deep')).toMatchObject({role: 'member', shape: 'island', level: 3});
    // Members inherit the group colour until they override it themselves.
    expect(objects.find(object => object.id === 'note')?.color).toBe(group.color);
    const city = resolveObjects(cityTheme, themeConfig(newWorldState(), 'city'), snapshot);
    expect(city[0]).toMatchObject({shape: 'plaza'});
    expect(city.find(object => object.id === 'ai')).toMatchObject({shape: 'district'});
    expect(city.find(object => object.id === 'deep')).toMatchObject({shape: 'building'});
  });
  it('keeps the knowledge identical for either theme and never writes to the graph', () => {
    const before = JSON.stringify(graph().all());
    const source = graph();
    const first = buildKnowledgeSnapshot(source, {attention: 'root', root: 'root'}).snapshot;
    const second = buildKnowledgeSnapshot(source, {attention: 'root', root: 'root'}).snapshot;
    expect(second).toEqual(first);
    expect(JSON.stringify(source.all())).toBe(before);
    expect(resolveTheme('unknown-theme').id).toBe('universe');
    expect(resolveTheme(null).name).toBe('知识宇宙');
  });
  it('keeps selection reachable under a small rendering budget', () => {
    const {snapshot} = buildKnowledgeSnapshot(graph(), {attention: 'root', root: 'root', selected: 'deep'}, {budget: 1});
    expect(snapshot.notes.some(note => note.id === 'deep')).toBe(true);
    expect(snapshot.stats.drawn).toBeLessThanOrEqual(3);
  });
  it('applies saved positions only in the saved theme and level', () => {
    const {snapshot} = built();
    const view = {camera: {x: 0, y: 20, z: 30}, target: {x: 0, y: 0, z: 0},
      positions: {deep: {x: 4, y: 0, z: 6}}, expanded: []};
    const moved = new WorldScene(cityTheme, themeConfig(newWorldState(), 'city'));
    moved.build(snapshot, view);
    expect(moved.bodies.find(body => body.object.id === 'deep')?.group.position.toArray()).toEqual([4, 0, 6]);
    moved.dispose();
    const plain = new WorldScene(cityTheme, themeConfig(newWorldState(), 'city'));
    plain.build(snapshot, undefined);
    expect(plain.bodies.find(body => body.object.id === 'deep')?.group.position.x).not.toBe(4);
    plain.dispose();
  });
  it('resets old hierarchy positions but preserves world appearance during directory migration', () => {
    const legacy = {mapLayout: {version: 2, nodes: {ai: {x: 900, y: 20}}, cards: {}, universe: saved()}};
    const data = loadBrainData(JSON.parse(JSON.stringify(legacy)));
    expect(data.mapLayout.nodes).toEqual({ai: {x: 900, y: 20}});
    const key = viewKey('universe', 'root');
    expect(data.knowledgeWorld.views[key]).toBeDefined();
    expect(data.knowledgeWorld.themes.universe?.appearance.motion).toBe(false);
    // A second load never overwrites an existing view, so the migration stays idempotent.
    data.knowledgeWorld.views[key] = {camera: saved().camera, target: saved().target, positions: {}, expanded: []};
    const again = loadBrainData({...JSON.parse(JSON.stringify(legacy)), version: 4, knowledgeWorld: data.knowledgeWorld});
    expect(again.knowledgeWorld.views[key]?.positions).toEqual({});
  });
  it('rejects invalid cameras and removes malformed saved note positions', () => {
    expect(sanitizeLegacyUniverse({...saved(), camera: {x: NaN, y: 0, z: 2}})).toBeUndefined();
    expect(sanitizeLegacyUniverse({...saved(), camera: saved().target})).toBeUndefined();
    expect(sanitizeLegacyUniverse({...saved(), positions: {bad: {x: 0, y: Infinity, z: 1}, good: {x: 1, y: 2, z: 3}}})?.positions)
      .toEqual({good: {x: 1, y: 2, z: 3}});
  });
});
