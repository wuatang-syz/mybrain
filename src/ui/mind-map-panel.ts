import {DEFAULT_MIND_MAP, type MindMapSettings} from '../mind-map-settings';

/** Native DOM controls shared by live views and the browser preview. */
export class MindMapPanel {
  readonly element: HTMLElement;
  private settings: MindMapSettings;
  private controls = new Map<keyof MindMapSettings, HTMLInputElement | HTMLSelectElement>();
  private outputs = new Map<keyof MindMapSettings, HTMLOutputElement>();

  constructor(parent: HTMLElement, settings: MindMapSettings, private change: (value: MindMapSettings) => void, close: () => void) {
    this.settings = {...settings};
    const doc = parent.ownerDocument;
    this.element = doc.createElement('section');
    this.element.className = 'brain-mind-settings';
    this.element.setAttribute('aria-label', '导图设置');
    const header = doc.createElement('div'); header.className = 'brain-mind-settings-header';
    const title = doc.createElement('strong'); title.textContent = '导图设置';
    const dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '关闭'; dismiss.onclick = close;
    dismiss.setAttribute('aria-label', '关闭导图设置'); header.append(title, dismiss); this.element.append(header);
    const description = doc.createElement('p'); description.textContent = '调整立即生效，自动保存到当前知识库。'; this.element.append(description);
    const group = (name: string, open = false) => {
      const section = doc.createElement('details'); section.className = 'brain-mind-settings-group'; section.open = open;
      const summary = doc.createElement('summary'); summary.textContent = name;
      const body = doc.createElement('div'); body.className = 'brain-mind-settings-group-body';
      section.append(summary, body); this.element.append(section); return body;
    };
    const row = (host: HTMLElement, key: keyof MindMapSettings, label: string, control: HTMLInputElement | HTMLSelectElement) => {
      const line = doc.createElement('label'); line.className = 'brain-mind-setting';
      const text = doc.createElement('span'); text.textContent = label; line.append(text, control); host.append(line); this.controls.set(key, control);
      control.setAttribute('aria-label', label);
      control.addEventListener('input', () => {
        const value = control instanceof doc.defaultView!.HTMLInputElement
          ? control.type === 'checkbox' ? control.checked : Number(control.value) : control.value;
        this.settings = {...this.settings, [key]: value}; this.update(this.settings); this.change({...this.settings});
      });
      return line;
    };
    const toggle = (host: HTMLElement, key: keyof MindMapSettings, name: string) => {
      const input = doc.createElement('input'); input.type = 'checkbox'; input.setAttribute('role', 'switch'); row(host, key, name, input);
    };
    const select = (host: HTMLElement, key: keyof MindMapSettings, name: string, values: [string, string][]) => {
      const input = doc.createElement('select');
      for (const [value, text] of values) {const option = doc.createElement('option'); option.value = value; option.textContent = text; input.append(option);}
      row(host, key, name, input);
    };
    const range = (host: HTMLElement, key: keyof MindMapSettings, name: string, min: number, max: number, suffix: string) => {
      const input = doc.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = '1';
      const line = row(host, key, name, input); line.classList.add('is-range');
      const output = doc.createElement('output'); output.dataset.suffix = suffix; line.append(output); this.outputs.set(key, output);
    };
    const display = group('展示内容', true);
    toggle(display, 'showIcons', '显示节点图标'); toggle(display, 'showGroupLabels', '显示分组标题');
    const layout = group('节点与布局');
    range(layout, 'fontSize', '节点字号', 12, 24, 'px');
    select(layout, 'spacing', '节点间距', [['compact', '紧凑'], ['standard', '标准'], ['spacious', '宽松']]);
    const windowHint = doc.createElement('p'); windowHint.textContent = '同级和关联纵向滑动，父级和子级横向滑动；节点数量不会缩小字号。'; layout.append(windowHint);
    const lines = group('连线');
    range(lines, 'lineLength', '连线长度', 50, 200, '%');
    const lengthHint = doc.createElement('p'); lengthHint.textContent = '调整中心与父级、子级及侧边分组的距离。'; lines.append(lengthHint);
    range(lines, 'lineWidth', '连线粗细', 50, 200, '%'); range(lines, 'lineOpacity', '连线透明度', 20, 100, '%');
    const reset = doc.createElement('button'); reset.type = 'button'; reset.textContent = '恢复默认';
    reset.onclick = () => {this.update({...DEFAULT_MIND_MAP}); this.change({...this.settings});}; this.element.append(reset);
    for (const name of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) this.element.addEventListener(name, event => event.stopPropagation());
    this.element.addEventListener('keydown', event => {event.stopPropagation(); if (event.key === 'Escape') {event.preventDefault(); close();}});
    parent.append(this.element); this.update(settings); dismiss.focus({preventScroll: true});
  }
  update(settings: MindMapSettings): void {
    this.settings = {...settings};
    for (const [key, control] of this.controls) {
      if (control.tagName === 'INPUT' && (control as HTMLInputElement).type === 'checkbox') (control as HTMLInputElement).checked = Boolean(settings[key]);
      else control.value = String(settings[key]);
      const output = this.outputs.get(key);
      if (output) output.value = `${settings[key]}${output.dataset.suffix ?? ''}`;
    }
  }
  destroy(): void {this.element.remove();}
}
