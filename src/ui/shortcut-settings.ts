import { Platform, Setting } from 'obsidian';
import type BrainPlugin from '../main';
import { defaultShortcuts, shortcutActions, shortcutConflict, shortcutFromEvent, shortcutLabel } from '../shortcuts';

export function renderShortcutSettings(container: HTMLElement, brain: BrainPlugin, redisplay: () => void): void {
  new Setting(container).setName('快捷键').setHeading();
  container.createEl('p', {text: '以下快捷键仅在 Brain 画布获得焦点时生效，输入文字时不触发。新增关系以当前中心为起点。点击快捷键框后按下组合键；Esc 取消，Tab 离开。全局打开 Brain 可在 Obsidian「快捷键」中搜索 Brain 设置。'});
  new Setting(container).setName('恢复全部默认快捷键').setDesc('只重置 Brain 画布快捷键。')
    .addButton(button => button.setButtonText('恢复默认').onClick(() => {
      brain.data.settings.shortcuts = defaultShortcuts(); brain.scheduleSave(); brain.refreshViews(); redisplay();
    }));
  for (const action of shortcutActions) {
    const row = new Setting(container).setName(action.label);
    const error = container.createDiv({attr: {role: 'status', 'aria-live': 'polite'}});
    const save = (value: string): boolean => {
      const conflict = shortcutConflict(brain.data.settings.shortcuts, action.id, value, Platform.isMacOS);
      if (conflict) {error.setText(`与「${conflict}」冲突，请先清除该操作的快捷键或选择其他组合。`); return false;}
      brain.data.settings.shortcuts[action.id] = value;
      brain.scheduleSave(); brain.refreshViews(); error.setText(''); return true;
    };
    row.addText(text => {
      const input = text.inputEl;
      input.readOnly = true;
      input.setAttribute('aria-label', `${action.label}快捷键，聚焦后按下组合键`);
      const show = () => text.setValue(shortcutLabel(brain.data.settings.shortcuts[action.id], Platform.isMacOS));
      show();
      input.addEventListener('focus', () => text.setValue('请按快捷键…'));
      input.addEventListener('blur', show);
      input.addEventListener('keydown', event => {
        if (event.key === 'Tab') return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') {input.blur(); return;}
        if (event.repeat || event.isComposing || event.keyCode === 229) return;
        const value = shortcutFromEvent(event, Platform.isMacOS);
        if (!value) {
          if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) error.setText('请使用字母、数字、方向键或带修饰键的组合；此按键不支持。');
          return;
        }
        if (save(value)) {show(); input.blur();}
      });
      row.addButton(button => button.setButtonText('清除').onClick(() => {save(''); show();}));
      row.addButton(button => button.setButtonText('默认').onClick(() => {save(action.key); show();}));
    });
  }
}
