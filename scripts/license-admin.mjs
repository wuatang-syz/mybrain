// Operator-only utility. Never ship private keys or this tool to customers.
import {generateKeyPairSync, createPrivateKey, sign, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const [command, keyPath, orderReference, outputPath] = process.argv.slice(2);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (!keyPath) throw new Error('Usage: node scripts/license-admin.mjs keygen <private-key-outside-repo.pem> | issue <private-key.pem> <verified-order-reference> <token-output.txt>');
const keyFile = resolve(keyPath), rel = relative(root, keyFile);
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Private keys must be stored outside the project.');
if (command === 'keygen') {
  const {publicKey, privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  await writeFile(keyFile, privateKey.export({format: 'pem', type: 'pkcs8'}), {flag: 'wx', mode: 0o600});
  console.log('Set commerce.publicKey to this public SPKI key (keep the private key backed up securely):');
  console.log(publicKey.export({format: 'der', type: 'spki'}).toString('base64'));
} else if (command === 'issue') {
  if (!orderReference || !outputPath) throw new Error('An operator-verified paid order reference and output file are required.');
  // This utility does NOT verify payment. Operator must verify settlement in merchant dashboard.
  const key = createPrivateKey(await readFile(keyFile));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Expected a P-256 key.');
  const payload = Buffer.from(JSON.stringify({version: 1, product: 'mybrain', plan: 'lifetime', id: randomUUID(), issuedAt: Date.now()})).toString('base64url');
  const message = `MB1.${payload}`;
  const signature = sign('sha256', Buffer.from(message), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url');
  await writeFile(resolve(outputPath), `${message}.${signature}\n`, {flag: 'wx', mode: 0o600});
  console.log('License written. Keep the verified order reference and token together in your private order records.');
} else throw new Error('Unknown command. Use keygen or issue.');
