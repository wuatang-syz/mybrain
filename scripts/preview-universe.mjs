import * as esbuild from 'esbuild';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
const vault=resolve('G:/Atang/Obsidian/脑图');
await mkdir('.preview',{recursive:true});
await esbuild.build({entryPoints:['dev/universe.ts'],bundle:true,format:'esm',target:'es2022',loader:{'.jpg':'dataurl'},outfile:'.preview/universe.js',sourcemap:true});
const routes=new Map([['/','dev/universe.html'],['/universe.js','.preview/universe.js'],['/universe.js.map','.preview/universe.js.map'],['/universe.css','dev/universe.css'],['/styles.css','styles.css'],['/notes.json','.preview/universe-notes.json']]);
const known=new Set(JSON.parse(await readFile('.preview/universe-notes.json','utf8')).notes.map(n=>n.id));
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');let file=routes.get(url.pathname);
  if(url.pathname==='/note'){const id=url.searchParams.get('id');const path=resolve(vault,id??'');if(!known.has(id)||!path.startsWith(vault+sep)){res.writeHead(404);res.end();return;}file=path;}
  if(!file){res.writeHead(404);res.end();return;}const mime=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.md')?'text/plain':'text/javascript';
  res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(file));
}catch{res.writeHead(500);res.end('Preview asset unavailable');}});
server.listen(5186,'127.0.0.1',async()=>{await writeFile('.preview/universe-server.json',JSON.stringify({pid:process.pid,port:5186}));console.log('Knowledge universe: http://127.0.0.1:5186');});
