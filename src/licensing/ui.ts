import {Modal, Notice, Setting} from 'obsidian';
import type BrainPlugin from '../main';
import {commerce} from './config';
import {checkoutUrl, verifyLicense} from './verify';

export function renderLicense(container: HTMLElement, plugin: BrainPlugin): void {
  container.createEl('h2', {text: 'TheMind 买断授权'});
  container.createEl('p', {text: plugin.licensed ? '已激活 · 全部功能永久使用' : '购买并激活后使用全部功能。原有 Markdown 笔记不受影响。'});
  container.createEl('p', {text: '一次性付款，不自动续费。授权在本机离线校验，不上传笔记。授权适用于当前功能；不包含未来单独收费的云服务。'});
  if (commerce.priceLabel) container.createEl('p', {text: commerce.priceLabel});
  if (commerce.wechatQr) {
    const purchase = container.createDiv({cls: 'brain-license-purchase'});
    purchase.createEl('h3', {text: '微信扫码购买'});
    purchase.createEl('p', {text: '请使用微信扫描下方收款码，支付 ¥99。核对收款信息后再付款。'});
    purchase.createEl('img', {cls: 'brain-license-qr', attr: {src: commerce.wechatQr, alt: 'TheMind 微信收款码，买断价格 99 元'}});
    purchase.createEl('p', {text: `付款后添加${commerce.support}，发送付款时间和交易单号，人工核实到账后发送授权码。请勿发送支付密码或验证码。`});
    purchase.createEl('p', {text: '扫码付款不会自动激活。已有付款请先联系确认，不要重复支付。'});
  }
  for (const [name, value] of [['微信支付', commerce.wechatUrl], ['支付宝', commerce.alipayUrl]]) {
    const url = checkoutUrl(value!);
    if (!url) continue;
    const row = new Setting(container).setName(name!).setDesc(url ? '在浏览器中打开购买页面，付款后按页面说明获取授权码。' : '购买渠道尚未开放。');
    row.addButton(button => button.setButtonText('前往购买').setDisabled(!url).onClick(() => {if (url) window.open(url, '_blank', 'noopener,noreferrer');}));
  }
  if (commerce.support) container.createEl('p', {text: `订单及授权找回：${commerce.support}`});
  let token = '';
  new Setting(container).setName('授权码').setDesc('请勿分享授权码。激活后重新启用插件生效。')
    .addTextArea(input => {input.setPlaceholder('MB1.…').onChange(value => {token = value.trim();}); input.inputEl.setAttribute('aria-label', 'TheMind 授权码');});
  new Setting(container).addButton(button => button.setButtonText('验证并保存授权').setCta().onClick(async () => {
    button.setDisabled(true);
    try {
      if (!commerce.publicKey) {new Notice('此构建尚未配置授权公钥，暂不可激活。'); return;}
      if (!await verifyLicense(token, commerce.publicKey)) {new Notice('授权码无效，请检查是否完整复制。'); return;}
      await plugin.saveLicense(token);
      new Notice('授权已保存。请在社区插件设置中关闭再开启 TheMind，即可使用全部功能。', 10000);
    } catch {new Notice('授权保存失败，请重试。');} finally {button.setDisabled(false);}
  }));
}
export class LicenseModal extends Modal {
  constructor(private readonly brain: BrainPlugin) {super(brain.app);}
  onOpen(): void {renderLicense(this.contentEl, this.brain);}
  onClose(): void {this.contentEl.empty();}
}
