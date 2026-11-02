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

