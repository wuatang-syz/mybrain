import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = 'C:/Users/wuata/Desktop/my-notes-master/my-notes-master/.obsidian/plugins/obsidian-brain';
const files = ['main.js', 'manifest.json', 'styles.css'];

await access(target);
await mkdir(target, { recursive: true });
for (const file of files) await copyFile(resolve(projectRoot, file), `${target}/${file}`);

const localManifest = JSON.parse(await readFile(resolve(projectRoot, 'manifest.json'), 'utf8'));
// Keep the existing development vault's ID/folder and settings intact. Release uses mybrain.
localManifest.id = 'obsidian-brain';
await writeFile(`${target}/manifest.json`, JSON.stringify(localManifest, null, 2) + '\n');
const installedManifest = JSON.parse(await readFile(`${target}/manifest.json`, 'utf8'));
if (localManifest.id !== installedManifest.id || localManifest.version !== installedManifest.version) {
  throw new Error(`插件同步校验失败：本地 ${localManifest.id}@${localManifest.version}，目标 ${installedManifest.id}@${installedManifest.version}`);
}
const sizes = await Promise.all(files.map(async file => `${file}=${(await stat(`${target}/${file}`)).size}`));
console.log(`已同步到 ${target}`);
console.log(sizes.join(', '));
