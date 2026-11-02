import {mkdir,copyFile} from 'node:fs/promises';
const target='dist/mybrain';
await mkdir(target,{recursive:true});
for (const file of ['main.js','manifest.json','styles.css']) await copyFile(file,`${target}/${file}`);
console.log(`Installable plugin: ${target}`);
