export interface License {version: 1; product: 'mybrain'; plan: 'lifetime'; id: string; issuedAt: number}
const decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
/** The exact encoded payload is signed. Client-side flags are never trusted. */
export async function verifyLicense(token: string, publicKey: string): Promise<License | null> {
  try {
    if (!publicKey || token.length > 8192) return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'MB1') return null;
    const payload = parts[1]!, signature = parts[2]!;
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
    const key = await crypto.subtle.importKey('spki', decode(publicKey), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    if (!await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, decode(signature), new TextEncoder().encode(`MB1.${payload}`))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload))) as Partial<License>;
    if (data.version !== 1 || data.product !== 'mybrain' || data.plan !== 'lifetime' ||
      typeof data.id !== 'string' || !data.id || data.id.length > 128 ||
      !Number.isSafeInteger(data.issuedAt) || data.issuedAt! <= 0 || data.issuedAt! > Date.now() + 300000) return null;
    return data as License;
  } catch { return null; }
}
export function checkoutUrl(value: string): string | null {
  try {const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;} catch {return null;}
}
