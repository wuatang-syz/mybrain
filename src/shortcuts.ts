export const shortcutActions = [
  {id: 'search', label: '搜索笔记', key: 'Mod+f'},
  {id: 'create', label: '新建独立笔记', key: 'Mod+Shift+n'},
  {id: 'parent', label: '新增父级', key: 'Mod+ArrowUp'},
  {id: 'child', label: '新增子级', key: 'Mod+ArrowDown'},
  {id: 'jump', label: '新增跳转关联', key: 'Mod+ArrowLeft'},
  {id: 'sibling', label: '新增同级', key: 'Mod+ArrowRight'},
  {id: 'back', label: '后退', key: 'Alt+ArrowLeft'},
  {id: 'next', label: '前进', key: 'Alt+ArrowRight'},
  {id: 'home', label: '回到全局根节点', key: 'Alt+Home'},
  {id: 'open', label: '打开中心笔记', key: 'Mod+Enter'},
  {id: 'undo', label: '撤销关系变更', key: 'Mod+z'},
  {id: 'redo', label: '重做关系变更', key: 'Mod+Shift+z'},
  {id: 'fit', label: '适应画布', key: 'f'},
  {id: 'zoomIn', label: '放大画布', key: '='},
  {id: 'zoomOut', label: '缩小画布', key: '-'},
  {id: 'follow', label: '切换跟随当前笔记', key: 'Mod+Shift+l'},
] as const;
export type ShortcutAction = typeof shortcutActions[number]['id'];
export type ShortcutBindings = Record<ShortcutAction, string>;
export const defaultShortcuts = (): ShortcutBindings => Object.fromEntries(shortcutActions.map(action => [action.id, action.key])) as ShortcutBindings;
const modifiers = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
const namedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Delete', 'Backspace'];

export function normalizeShortcut(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value) return '';
  const parts = value.split('+'), key = parts.pop()!;
  if (!(namedKeys.includes(key) || (key.length === 1 && (/^[a-z0-9]$/.test(key) || '=-/,.;[]`'.includes(key))) || /^F([1-9]|1[0-2])$/.test(key))) return undefined;
  if (parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length ||
    (parts.includes('Mod') && (parts.includes('Ctrl') || parts.includes('Meta')))) return undefined;
  if (!parts.length && ['Enter', 'Delete', 'Backspace'].includes(key)) return undefined;
  return [...modifiers.filter(part => parts.includes(part)), key].join('+');
}
export function loadShortcuts(raw: unknown): ShortcutBindings {
  const result = defaultShortcuts();
  if (raw && typeof raw === 'object') for (const action of shortcutActions) {
    const value = normalizeShortcut((raw as Record<string, unknown>)[action.id]);
    if (value !== undefined) result[action.id] = value;
  }
  return result;
}
function physicalShortcut(binding: string, mac: boolean): string {
  const parts = binding.split('+'), key = parts.pop()!;
  const actual = new Set(parts.map(part => part === 'Mod' ? mac ? 'Meta' : 'Ctrl' : part));
  return [...modifiers.filter(part => actual.has(part)), key].join('+');
}
export function shortcutConflict(bindings: ShortcutBindings, action: ShortcutAction, binding: string, mac: boolean): string | undefined {
  if (!binding) return;
  return shortcutActions.find(other => other.id !== action && bindings[other.id] &&
    physicalShortcut(bindings[other.id], mac) === physicalShortcut(binding, mac))?.label;
}
export function shortcutFromEvent(event: KeyboardEvent, mac: boolean): string | undefined {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) return;
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (mac && event.ctrlKey) parts.push('Ctrl');
  if (!mac && event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return normalizeShortcut(parts.join('+'));
}
export function shortcutLabel(binding: string, mac: boolean): string {
  if (!binding) return '未设置';
  const labels: Record<string, string> = {Mod: mac ? 'Cmd' : 'Ctrl', Meta: mac ? 'Cmd' : 'Win', Alt: mac ? 'Option' : 'Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→'};
  return binding.split('+').map(key => labels[key] ?? (key.length === 1 ? key.toUpperCase() : key)).join(' + ');
}
export function matchShortcut(event: KeyboardEvent, bindings: ShortcutBindings, mac: boolean): ShortcutAction | undefined {
  const target = event.target as Element | null;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]')) return;
  const binding = shortcutFromEvent(event, mac);
  if (!binding) return;
  // Plain keys must not override keyboard activation of toolbar controls.
  if (!binding.includes('+') && target?.closest('button, summary, a')) return;
  return shortcutActions.find(action => bindings[action.id] &&
    physicalShortcut(bindings[action.id], mac) === physicalShortcut(binding, mac))?.id;
}
