import * as esbuild from 'esbuild';
const production = process.argv.includes('production');
const context = await esbuild.context({entryPoints:['src/main.ts'], bundle:true,
  external:['obsidian'], format:'cjs', target:'es2021', outfile:'main.js', loader:{'.jpg':'dataurl','.png':'dataurl'},
  sourcemap:!production, minify:production, logLevel:'info'});
if (production) { await context.rebuild(); await context.dispose(); }
else await context.watch();
