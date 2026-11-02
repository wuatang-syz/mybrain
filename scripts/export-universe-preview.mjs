// Read-only local preview metadata. No notes or relationships are changed.
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {join,relative,basename} from 'node:path';
import {parse} from 'yaml';
const vault='G:/Atang/Obsidian/脑图';
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.md'))files.push(path);}}
await walk(vault);
const ids=files.map(path=>relative(vault,path).replaceAll('\\','/'));
const resolve=raw=>{const path=String(raw).replace(/^\[\[/,'').replace(/\]\]$/,'').split('|')[0].split('#')[0].trim();return ids.find(id=>id===path||id===path+'.md')??ids.find(id=>basename(id,'.md')===path);};
const notes=await Promise.all(files.map(async(path,i)=>{const text=await readFile(path,'utf8');const match=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text);let fm={};try{fm=match?parse(match[1])??{}:{};}catch{}
  const list=key=>Array.isArray(fm[key])?[...new Set(fm[key].map(resolve).filter(Boolean))]:[];
  const body=match?text.slice(match[0].length):text;
  return {id:ids[i],title:basename(path,'.md'),parents:list('brain-parents'),jumps:list('brain-jumps'),links:[...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>resolve(m[1])).filter(Boolean))],issues:[]};}));
const data=JSON.parse(await readFile(join(vault,'.obsidian/plugins/obsidian-brain/data.json'),'utf8'));
await mkdir('.preview',{recursive:true});await writeFile('.preview/universe-notes.json',JSON.stringify({root:data.globalRoot,notes},null,2));
console.log(`Prepared ${notes.length} real notes for local-only preview.`);
