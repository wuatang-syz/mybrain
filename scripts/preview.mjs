import * as esbuild from 'esbuild';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
await mkdir('.preview', {recursive:true});
await esbuild.build({entryPoints:['dev/demo.ts'],alias:{obsidian:'./dev/obsidian.ts'},bundle:true,format:'esm',target:'es2021',outfile:'.preview/demo.js',sourcemap:true,loader:{'.png':'dataurl','.jpg':'dataurl'}});
const routes = new Map([['/', 'dev/index.html'], ['/demo.js','.preview/demo.js'], ['/demo.js.map','.preview/demo.js.map'], ['/styles.css','styles.css'], ['/demo.css','dev/demo.css']]);
const server = createServer(async (request,response) => {
  const file = routes.get(new URL(request.url,'http://127.0.0.1').pathname);
  if (!file) {response.writeHead(404);response.end('Not found');return;}
  try { const body=await readFile(file); response.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});response.end(body);}
  catch {response.writeHead(500);response.end('Preview asset unavailable');}
});
server.listen(Number(process.env.BRAIN_PREVIEW_PORT || 5178),'127.0.0.1',async()=>{
  const address=server.address(); const port=typeof address==='object' && address ? address.port : 5178;
  await writeFile('.preview/server.json',JSON.stringify({pid:process.pid,port}));
  console.log(`Brain preview: http://127.0.0.1:${port}`);
});
