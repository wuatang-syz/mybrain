import {POLYGON_POINT_TAIL} from '../levels';
import {pickShapes} from '../shapes';
import {cityShapes} from '../shapes/city';
import type {WorldShapeId, WorldThemeDefinition} from '../types';

const ladder: WorldShapeId[] = ['plaza', 'district', 'landmark', 'building', 'grid', 'room',
  'octagon', 'heptagon', 'hexagon', 'pentagon', 'quad', 'triangle', 'point', 'point', 'point'];

/**
 * 知识城市 is a bright miniature diorama: a central plaza, districts on the ground plane and
 * buildings that keep degrading into the shared polygon ladder as depth grows.
 */
export const cityTheme: WorldThemeDefinition = {
  id: 'city',
  name: '知识城市',
  levels: [
    {id: 'plaza', name: '中心广场', shape: 'plaza', size: 2.2, detail: 2},
    {id: 'district', name: '分区', shape: 'district', size: 1.8, detail: 2},
    {id: 'landmark', name: '街区及地标建筑', shape: 'landmark', size: 1.5, detail: 2},
    {id: 'building', name: '街区内的独立建筑', shape: 'building', size: 1.1, detail: 1},
    {id: 'grid', name: '地面街区网格', shape: 'grid', size: .85, detail: 1},
    {id: 'room', name: '独立房间', shape: 'room', size: .65, detail: 1},
    ...POLYGON_POINT_TAIL,
  ],
  roles: {center: 'plaza', group: 'district', member: 'level'},
  visuals: {
    background: '#060e1d',
    palette: ['#55cfe2', '#799fff', '#72dcc8', '#efbd78', '#a8a1f1', '#75b8ee'],
    labelSize: .95,
    modelScale: 1,
    motion: true,
    glow: .23,
    windowLight: 1,
    structure: '#6d7f96',
    decoration: '#213b52',
    ground: '#142235',
    building: '#5f9ec5',
  },
  lighting: {ambient: '#456a94', ambientIntensity: .6, key: '#cfe6ff', keyIntensity: 2.4, rim: '#3f86b8', rimIntensity: 1.8, fogNear: 80, fogFar: 200},
  layout: {groupGap: 9, memberGap: 2.6, plane: 'ground', rings: 8, orbit: 2.6, spacing: 1.15, lift: 0, tilt: 0},
  relations: {
    structure: {color: '#7c8da3', opacity: .8, width: .02, dashed: false},
    jump: {color: '#4b86c8', opacity: .7, width: .014, dashed: false},
  },
  decoration: {kind: 'road', color: '#c3ccd8', opacity: .5, width: .48},
  motion: {spin: 0, drift: .12, twinkle: false},
  copy: {
    eyebrow: 'KNOWLEDGE CITY',
    heading: '我的知识城市',
    centerSubtitle: '知识中枢',
    groupSubtitle: '{count} 篇知识笔记',
    navigator: '分区导航',
    navigatorHint: '返回城市全景',
    enter: '进入{level}',
    expand: '展开更多笔记（{count}）',
    motionOn: '暂停动效',
    motionOff: '开启动效',
    hint: '拖动空白平移 · 滚轮缩放 · 右键调整视角',
    legend: [{label: '中心广场', role: 'center'}, {label: '分区', role: 'group'}, {label: '建筑', role: 'member'}],
    fail: '知识世界绘制失败：{message}',
  },
  shapes: {...pickShapes([...ladder, 'unassigned']), ...cityShapes},
};
