import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const result = await build({entryPoints: ['src/licensing/config.ts'], bundle: true, write: false, format: 'esm', loader: {'.png': 'dataurl'}});
const {commerce} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
const errors = [];
if (manifest.id.includes('obsidian') || !/^[a-z0-9-]+$/.test(manifest.id)) errors.push('Invalid release plugin ID');
if (manifest.version !== pkg.version || versions[manifest.version] !== manifest.minAppVersion) errors.push('Versions do not match');
for (const key of ['wechatUrl', 'alipayUrl']) {
  if (!commerce[key]) continue;
  try {const url = new URL(commerce[key]); if (url.protocol !== 'https:' || url.username || url.password) throw new Error();}
  catch {errors.push(`${key}: configure a real HTTPS purchase page`);}
}
if (!commerce.wechatQr && !commerce.wechatUrl && !commerce.alipayUrl) errors.push('Configure at least one purchase channel');
if (commerce.wechatQr && !commerce.wechatQr.startsWith('data:image/png;base64,')) errors.push('WeChat QR must be a bundled PNG');
for (const key of ['publicKey', 'priceLabel', 'support']) if (!commerce[key]) errors.push(`${key}: required before paid release`);
for (const file of ['README.md', 'LICENSE', 'docs/privacy.md', 'docs/commercial-launch.md']) await readFile(file);
if (errors.length) {console.error('Paid release blocked:\n' + errors.join('\n')); process.exitCode = 1;}
else console.log('Release metadata ready. Merchant payment verification and Obsidian review are still required.');
