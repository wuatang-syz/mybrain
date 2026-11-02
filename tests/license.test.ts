import {describe, expect, it, vi} from 'vitest';
import BrainPlugin from '../src/main';
import {BrainView} from '../src/ui/view';
import {generateKeyPairSync, sign} from 'node:crypto';
import {verifyLicense, checkoutUrl} from '../src/licensing/verify';
import {loadBrainData} from '../src/settings';
const keys = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
const publicKey = keys.publicKey.export({format: 'der', type: 'spki'}).toString('base64');
const claims = {version: 1, product: 'mybrain', plan: 'lifetime', id: 'order-test', issuedAt: Date.now()};
function issue(data: object): string {
  const message = `MB1.${Buffer.from(JSON.stringify(data)).toString('base64url')}`;
  return `${message}.${sign('sha256', Buffer.from(message), {key: keys.privateKey, dsaEncoding: 'ieee-p1363'}).toString('base64url')}`;
}
describe('offline lifetime license', () => {
  it('registers only activation when unpaid and never initializes vault services', async () => {
    const plugin = Object.create(BrainPlugin.prototype) as BrainPlugin;
    const addCommand = vi.fn(), registerView = vi.fn();
    Object.assign(plugin, {loadData: async () => ({focus: 'Keep.md'}), addCommand, registerView,
      addRibbonIcon: vi.fn(), addSettingTab: vi.fn()});
    await plugin.onload();
    expect(plugin.licensed).toBe(false);
    expect(plugin.indexer).toBeUndefined();
    expect(plugin.relations).toBeUndefined();
    expect(addCommand).toHaveBeenCalledTimes(1);
    expect(addCommand.mock.calls[0]![0].id).toBe('open-brain');
    expect(registerView).toHaveBeenCalledOnce();
  });
  it('does not overwrite saved navigation when an activation-only view closes', () => {
    const view = Object.create(BrainView.prototype) as BrainView;
    const saveNavigation = vi.fn(), captureLayout = vi.fn();
    Object.assign(view, {brain: {licensed: false}, saveNavigation, captureLayout});
    view.dispose();
    expect(saveNavigation).not.toHaveBeenCalled();
    expect(captureLayout).not.toHaveBeenCalled();
  });
  it('accepts a real signature and survives settings reload', async () => {
    const token = issue(claims);
    expect(await verifyLicense(loadBrainData({licenseToken: token}).licenseToken!, publicKey)).toEqual(claims);
  });
  it('rejects tampering, malformed tokens, missing keys and another signer', async () => {
    const token = issue(claims);
    const other = generateKeyPairSync('ec', {namedCurve: 'prime256v1'}).publicKey.export({format: 'der', type: 'spki'}).toString('base64');
    for (const [value, key] of [[token.replace('MB1.', 'MB2.'), publicKey], [token, ''], [token, other], ['MB1.e30.invalid', publicKey], ['x'.repeat(9000), publicKey]]) {
      expect(await verifyLicense(value!, key!)).toBeNull();
    }
    const [,payload,sig] = token.split('.');
    const altered = Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload!, 'base64url').toString()), id: 'changed'})).toString('base64url');
    expect(await verifyLicense(`MB1.${altered}.${sig}`, publicKey)).toBeNull();
  });
  it.each([{product: 'other'}, {plan: 'trial'}, {version: 2}, {issuedAt: Date.now() + 86400000}, {id: ''}])('rejects invalid signed claims %j', async patch => {
    expect(await verifyLicense(issue({...claims, ...patch}), publicKey)).toBeNull();
  });
  it('only opens HTTPS payment destinations', () => {
    for (const url of ['', 'javascript:alert(1)', 'http://pay.example', 'https://user:password@pay.example']) expect(checkoutUrl(url)).toBeNull();
    expect(checkoutUrl('https://pay.example/order')).toBe('https://pay.example/order');
  });
});
