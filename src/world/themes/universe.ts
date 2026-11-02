import {POLYGON_POINT_TAIL} from '../levels';
import {pickShapes} from '../shapes';
import type {WorldShapeId, WorldThemeDefinition} from '../types';

const ladder: WorldShapeId[] = ['core', 'galaxy', 'planet', 'island', 'station', 'orb',
  'octagon', 'heptagon', 'hexagon', 'pentagon', 'quad', 'triangle', 'point', 'point', 'point'];

/**
 * 知识宇宙 keeps the current deep blue cosmos: a crystal observatory, ringed galaxies, satellites
 * and a star field, with depth degrading down the shared polygon ladder.
 */
export const universeTheme: WorldThemeDefinition = {
  id: 'universe',
  name: '知识宇宙',
  levels: [
    {id: 'core', name: '知识晶核', shape: 'core', size: 2.1, detail: 2},
    {id: 'galaxy', name: '星系', shape: 'galaxy', size: 1.95, detail: 2},
    {id: 'planet', name: '行星', shape: 'planet', size: .62, detail: 1},
    {id: 'island', name: '浮岛·基地', shape: 'island', size: .5, detail: 1},
    {id: 'station', name: '空间站', shape: 'station', size: .42, detail: 1},
    {id: 'orb', name: '光球', shape: 'orb', size: .32, detail: 1},
    ...POLYGON_POINT_TAIL,
  ],
  roles: {center: 'core', group: 'galaxy', member: 'level'},
  visuals: {
    background: '#050d20',
    palette: ['#55cfff', '#b99aff', '#6aefdc', '#f3cb82', '#8299ff', '#e99bd6'],
    labelSize: 1,
    modelScale: 1,
    motion: true,
    glow: .52,
    structure: '#b4eaff',
    decoration: '#6cc6ff',
    ground: '#101a3a',
    building: '#85bdff',
  },
  layout: {groupGap: 11, memberGap: 3.2, plane: 'camera', rings: 8, orbit: 3.2, spacing: 1.2, lift: .4, tilt: .55},
  relations: {
    structure: {color: '#8fd8ff', opacity: .85, width: .022, dashed: false},
    jump: {color: '#b4eaff', opacity: .6, width: .012, dashed: false},
  },
  decoration: {kind: 'orbit', color: '#6cc6ff', opacity: .2, width: .008},
  motion: {spin: 1, drift: .35, twinkle: true},
  copy: {
    eyebrow: 'KNOWLEDGE UNIVERSE',
    heading: '我的知识宇宙',
    centerSubtitle: '记录 · 连接 · 生长',
    groupSubtitle: '{count} 篇知识笔记',
    navigator: '星域导航',
    navigatorHint: '返回宇宙全景',
    enter: '进入{level}',
    expand: '展开更多笔记（{count}）',
    motionOn: '暂停动效',
    motionOff: '开启动效',
    hint: '拖动空白旋转 · 滚轮缩放 · 右键拖动平移',
    legend: [{label: '知识中心', role: 'center'}, {label: '星系', role: 'group'}, {label: '笔记', role: 'member'}],
    fail: '知识世界绘制失败：{message}',
  },
  shapes: pickShapes([...ladder, 'unassigned']),
};
