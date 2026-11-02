import {Modal, type App} from 'obsidian';

/** Shows the real filesystem destination before a directory command is submitted. */
export class DirectoryDialog extends Modal {
  constructor(app: App, private label: string, private description: (name: string) => string,
    private submit: (name: string) => Promise<void>, private askName = false) {super(app);}
  onOpen(): void {
    this.titleEl.setText(this.label);
    const input = this.askName ? this.contentEl.createEl('input', {type: 'text', attr: {'aria-label': '名称', placeholder: '名称'}}) : undefined;
    const preview = this.contentEl.createEl('p');
    const update = () => {try {preview.setText(this.description(input?.value ?? ''));} catch (error) {preview.setText(String(error));}};
    input?.addEventListener('input', update); update();
    const error = this.contentEl.createDiv({cls: 'brain-issue'});
    const actions = this.contentEl.createDiv({cls: 'brain-new-note-actions'});
    actions.createEl('button', {text: '取消'}).onclick = () => this.close();
    const button = actions.createEl('button', {text: this.askName ? '创建' : '移动', cls: 'mod-cta'});
    button.onclick = () => {button.disabled = true; void this.submit(input?.value ?? '').then(() => this.close()).catch(err => error.setText(String(err))).finally(() => {button.disabled = false;});};
    input?.focus();
  }
  onClose(): void {this.contentEl.empty();}
}
