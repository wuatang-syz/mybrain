import {parse, stringify} from 'yaml';
export class PluginSettingTab {}
export class Setting {}
export class Plugin {}
export class ItemView {}
export class Modal { open(): void {} }
export class FuzzySuggestModal {}
export class Notice {}
export class Menu {}
export class TFile { constructor(public path: string) {} }
export function setIcon(): void {}
export function normalizePath(path: string): string {return path.replace(/\\/g,'/').replace(/\/{2,}/g,'/').replace(/^\/+|\/+$/g,'');}
export function parseYaml(raw: string): unknown {return parse(raw,{uniqueKeys:true});}
export function getFrontMatterInfo(raw: string): {exists:boolean;frontmatter:string;from:number;to:number;contentStart:number} {
  const match=/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  return match?{exists:true,frontmatter:match[1]!,from:4,to:match[0].length,contentStart:match[0].length}:{exists:false,frontmatter:'',from:0,to:0,contentStart:0};
}
export const Platform = {isMacOS: false};

export function stringifyYaml(value: unknown): string {return stringify(value);}

/** jsdom lacks the DOM helpers Obsidian adds to HTMLElement; mirror the subset the plugin uses. */
interface DomOptions {cls?: string; text?: string; type?: string; attr?: Record<string, string>}
if (typeof HTMLElement !== 'undefined') {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const withEl = (element: HTMLElement) => element as unknown as {createEl(tag: string, options?: DomOptions): HTMLElement};
  if (!proto.createEl) proto.createEl = function (this: HTMLElement, tag: string, options?: DomOptions): HTMLElement {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    if (options?.type) element.setAttribute('type', options.type);
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.append(element);
    return element;
  };
  if (!proto.createDiv) proto.createDiv = function (this: HTMLElement, options?: DomOptions): HTMLElement {
    return withEl(this).createEl('div', options);
  };
  if (!proto.createSpan) proto.createSpan = function (this: HTMLElement, options?: DomOptions): HTMLElement {
    return withEl(this).createEl('span', options);
  };
  if (!proto.empty) proto.empty = function (this: HTMLElement): void { this.replaceChildren(); };
}
