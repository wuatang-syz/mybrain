import * as THREE from 'three';
import {levelName} from './theme';
import type {WorldBody, WorldThemeDefinition} from './types';
import {CENTER_ID} from './theme';

export interface LabelActions {
  select(id: string): void;
  enter(id: string): void;
  expand(id: string): void;
  context(id: string, event: MouseEvent): void;
  hover(id?: string): void;
  icon?(element: HTMLElement, name: string): void;
}
interface Entry {body: WorldBody; element: HTMLDivElement; badge?: HTMLElement}
interface Rect {x: number; y: number; width: number; height: number}
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);

/**
 * Screen-space labels. Names, subtitles and action copy come from the theme, and every level name
 * is used for the drill affordance so the universe says 进入星系 while the city says 进入分区.
 */
export class WorldLabels {
  readonly element: HTMLDivElement;
  private entries: Entry[] = [];
  private leaders: HTMLCanvasElement;
  private theme: WorldThemeDefinition;
  constructor(parent: HTMLElement, theme: WorldThemeDefinition, private actions: LabelActions) {
    this.theme = theme;
    this.element = parent.ownerDocument.createElement('div'); this.element.className = 'brain-world-labels';
    this.leaders = parent.ownerDocument.createElement('canvas'); this.leaders.className = 'brain-world-label-leaders';
    parent.append(this.element);
  }
  setTheme(theme: WorldThemeDefinition): void {this.theme = theme;}
  rebuild(bodies: WorldBody[]): void {
    this.element.replaceChildren(this.leaders); this.entries = [];
    const doc = this.element.ownerDocument, theme = this.theme;
    for (const body of bodies) {
      const {object} = body, major = object.role !== 'member', interactive = object.id !== CENTER_ID;
      const el = doc.createElement('div'); el.className = `brain-world-label is-${object.role}`;
      el.dataset.noteId = object.id; el.style.setProperty('--world-color', `#${object.color.toString(16).padStart(6, '0')}`);
      const button = doc.createElement('button'); button.className = 'brain-world-note'; button.type = 'button';
      button.setAttribute('aria-label', `聚焦节点：${object.title}`);
      button.title = `${levelName(theme, object.level)} · ${object.title}`;
      const title = doc.createElement('strong'); title.textContent = object.title; button.append(title);
      if (major) {
        const count = doc.createElement('span');
        count.textContent = object.role === 'center'
          ? theme.copy.centerSubtitle : fill(theme.copy.groupSubtitle, {count: object.count});
        button.append(count);
      }
      button.addEventListener('click', () => {if (interactive) this.actions.select(object.id);});
      el.addEventListener('contextmenu', event => {event.preventDefault(); if (interactive) this.actions.context(object.id, event);});
      el.addEventListener('pointerenter', () => this.actions.hover(object.id));
      el.addEventListener('pointerleave', () => this.actions.hover());
      el.addEventListener('focusin', () => this.actions.hover(object.id));
      el.addEventListener('focusout', () => this.actions.hover());
      el.append(button);
      this.element.append(el);
      let badge: HTMLElement | undefined;
      if (object.role === 'group' && !!object.icon) {
        badge = doc.createElement('div'); badge.className = 'brain-world-emblem';
        badge.style.color = `#${object.color.toString(16).padStart(6, '0')}`;
        this.actions.icon?.(badge, object.icon ?? 'sparkles'); this.element.append(badge);
      }
      this.entries.push({body, element: el, badge});
    }
  }
  update(camera: THREE.PerspectiveCamera, width: number, height: number, scale: number, selected?: string, hovered?: string): void {
    const occupied: Rect[] = [], projected = new THREE.Vector3();
    // The shared search icon and the world icon rail stacked under it own the top-right column.
    occupied.push({x: 14, y: 15, width: 210, height: 80}, {x: width - 140, y: 15, width: 126, height: 212});
    const host = this.element.parentElement!;
    const hostRect = host.getBoundingClientRect();
    for (const overlay of host.querySelectorAll<HTMLElement>('.brain-world-settings:not([hidden]), .brain-world-quick')) {
      const r = overlay.getBoundingClientRect(); occupied.push({x:r.left-hostRect.left,y:r.top-hostRect.top,width:r.width,height:r.height});
    }
    if (this.leaders.width !== width || this.leaders.height !== height) {this.leaders.width = width; this.leaders.height = height;}
    const ctx = this.leaders.getContext('2d'); ctx?.clearRect(0, 0, width, height);
    const discs = this.entries.filter(entry => entry.body.object.role !== 'member').map(entry => {
      const point = entry.body.group.position.clone().project(camera);
      const radius = entry.body.radius * scale * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(entry.body.group.position));
      return {id: entry.body.object.id, x: (point.x * .5 + .5) * width, y: (-point.y * .5 + .5) * height, r: radius * 1.15};
    });
    const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const priority = (entry: Entry) => entry.body.object.id === selected ? 0
      : entry.element.contains(entry.element.ownerDocument.activeElement) ? 1
      : entry.body.object.id === hovered ? 2 : entry.body.object.role === 'center' ? 3 : entry.body.object.role === 'group' ? 4 : 5;
    const sorted = this.entries.slice().sort((a, b) => priority(a) - priority(b));
    for (const entry of sorted) {
      const {body, element, badge} = entry, {object} = body;
      const hot = object.id === selected || object.id === hovered || element.contains(element.ownerDocument.activeElement);
      projected.copy(body.group.position).project(camera);
      const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * height;
      const distance = camera.position.distanceTo(body.group.position);
      const radius = body.radius * scale * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance);
      const compact = width <= 430;
      const labelScale = this.theme.visuals.labelSize;
      const w = object.role === 'member' ? Math.min(150, Math.max(42, object.title.length * 11 + 20))
        : object.role === 'center' ? (compact ? 138 : 180) : Math.round((compact ? 100 : 124) * Math.max(.8, labelScale));
      const h = Math.round((object.role === 'member' ? 24 : compact ? (object.role === 'center' ? 36 : 30) : 48) * Math.max(.85, labelScale));
      let top = y + radius + (object.role === 'center' ? 8 : 9), labelX = x;
      if (object.role === 'group') {
        if (y < height * .43) top = y - radius - h - 8;
        else if (x < width * .29) {labelX = x - radius - w / 2 - 7; top = y - h / 2;}
        else if (x > width * .71) {labelX = x + radius + w / 2 + 7; top = y - h / 2;}
        labelX = Math.max(w / 2 + 12, Math.min(width - w / 2 - 12, labelX));
        const candidates = [
          {x: labelX, y: top}, {x, y: y - radius - h - 8}, {x, y: y + radius + 9},
          {x: x - radius - w / 2 - 9, y: y - h / 2}, {x: x + radius + w / 2 + 9, y: y - h / 2},
          ...(compact ? [-1, 1].flatMap(side => [-2, -1, 1, 2].map(row => ({x: x + side * (radius + w / 2 + 9), y: y + row * (h + 10)}))) : []),
        ].map(point => ({x: Math.max(w / 2 + 8, Math.min(width - w / 2 - 8, point.x)), y: Math.max(52, Math.min(height - h - 32, point.y))}));
        const score = (point: {x: number; y: number}) => {
          const rect = {x: point.x - w / 2, y: point.y, width: w, height: h};
          return occupied.reduce((sum, other) => sum + overlapArea(rect, other) * 3, 0)
            + discs.reduce((sum, disc) => sum + overlapArea(rect, {x: disc.x - disc.r, y: disc.y - disc.r, width: disc.r * 2, height: disc.r * 2}), 0);
        };
        const best = candidates.reduce((a, b) => score(b) < score(a) ? b : a);
        labelX = best.x; top = best.y;
      }
      const rect = {x: labelX - w / 2, y: top, width: w, height: h};
      const inView = projected.z > -1 && projected.z < 1 && x > 8 && x < width - 8 && top > 45 && top + h < height - 20;
      const overlaps = occupied.some(other => rect.x < other.x + other.width + 5 && rect.x + w + 5 > other.x && rect.y < other.y + other.height + 3 && rect.y + h + 3 > other.y);
      const blocksBody = object.role === 'member' && discs.some(disc => overlapArea(rect, {x: disc.x - disc.r, y: disc.y - disc.r, width: disc.r * 2, height: disc.r * 2}) > 0);
      const visible = inView && (hot || (!overlaps && !blocksBody && (object.role !== 'member' || radius > 22)));
      element.hidden = !visible;
      element.style.transform = `translate(${Math.round(labelX)}px,${Math.round(top)}px) translateX(-50%)`;
      element.classList.toggle('is-selected', object.id === selected);
      element.classList.toggle('is-hovered', object.id === hovered);
      if (visible) occupied.push(rect);
      if (visible && ctx && object.role === 'group') {
        const endX = Math.max(rect.x, Math.min(rect.x + w, x)), endY = Math.max(rect.y, Math.min(rect.y + h, y));
        const length = Math.hypot(endX - x, endY - y);
        if (length > radius + 18) {
          ctx.strokeStyle = `#${object.color.toString(16).padStart(6, '0')}80`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + (endX - x) * radius / length, y + (endY - y) * radius / length); ctx.lineTo(endX, endY); ctx.stroke();
        }
      }
      if (badge) {
        badge.hidden = !inView || radius < 14;
        badge.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-50%)`;
        badge.style.width = `${Math.min(40, radius * .9)}px`; badge.style.height = `${Math.min(40, radius * .9)}px`;
      }
    }
  }
  destroy(): void {this.entries = []; this.element.remove();}
}
