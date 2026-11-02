import {setIcon} from 'obsidian';
export interface NoteDetails { icon: string; tags: string[]; body: string }
export function noteFields(parent: HTMLElement, initial: Partial<NoteDetails> = {}): () => NoteDetails {
  const doc = parent.ownerDocument;
  const row = doc.createElement('div'); row.className = 'brain-note-row';
  const name = parent.querySelector('input'); if (name) row.append(name);
  parent.prepend(row);
  const submit = doc.createElement('button'); submit.type = 'button'; submit.className = 'brain-note-submit'; submit.setAttribute('aria-label', '确认');
  setIcon(submit, 'plus'); submit.onclick = () => parent.dispatchEvent(new Event('brain-submit')); row.append(submit);
  const panels = doc.createElement('div'); panels.className = 'brain-note-panels'; row.after(panels);
  const controls: {summary: HTMLButtonElement; panel: HTMLDivElement}[] = [];
  const dropdown = (label: string, glyph: string) => {
    const summary = doc.createElement('button'); summary.type = 'button'; summary.className = 'brain-note-dropdown';
    summary.setAttribute('aria-label', label); summary.title = label; summary.setAttribute('aria-expanded', 'false'); setIcon(summary, glyph);
    const panel = doc.createElement('div'); panel.className = 'brain-note-popover'; panel.hidden = true;
    panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', label);
    panels.append(panel); row.append(summary); controls.push({summary, panel});
    const close = () => {panel.hidden = true; summary.setAttribute('aria-expanded', 'false');};
    summary.onclick = () => {
      const open = panel.hidden;
      for (const control of controls) {control.panel.hidden = true; control.summary.setAttribute('aria-expanded', 'false');}
      panel.hidden = !open; summary.setAttribute('aria-expanded', String(open));
    };
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(); summary.focus();}
    });
    return {summary, panel, close};
  };
  const icons = dropdown('选择图标', 'shapes'), labels = dropdown('设置标签', 'tags');
  const icon = doc.createElement('input'); icon.value = initial.icon ?? ''; icon.placeholder = '输入图标'; icon.setAttribute('aria-label', '图标'); icons.panel.append(icon);
  const renderIcon = () => { if (icon.value) icons.summary.textContent = icon.value; else {icons.summary.textContent = ''; setIcon(icons.summary, 'shapes');} };
  renderIcon(); icon.oninput = renderIcon;
  for (const emoji of ['📄', '📚', '💡', '🎯', '⭐', '🧠', '']) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = emoji || '清除';
    button.onclick = () => {icon.value = emoji; renderIcon(); icons.close(); icons.summary.focus();}; icons.panel.append(button);
  }
  const tags = doc.createElement('input'); tags.value = (initial.tags ?? []).join(', '); tags.placeholder = '标签，用逗号分隔'; tags.setAttribute('aria-label', '标签'); labels.panel.append(tags);
  return () => ({icon: icon.value.trim(), tags: [...new Set(tags.value.split(/[,，\s]+/).map(tag => tag.replace(/^#/, '')).filter(Boolean))], body: initial.body ?? ''});
}
