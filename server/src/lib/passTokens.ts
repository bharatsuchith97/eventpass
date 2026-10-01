import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';

/**
 * Pass tokens are stored twice: as a SHA-256 hash (what check-in looks up) and encrypted with a key derived from
 * JWT_SECRET (so the same pass can be shown again). A copy of the database alone therefore still cannot produce
 * working passes. Changing JWT_SECRET makes stored tokens unreadable; such passes keep working at the door and
 * simply get a new QR the next time they are shown.
 */
const VERSION = 'v1';

function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', config().JWT_SECRET, 'inviteley-pass-tokens', 'pass-token-v1', 32));
}

export function encryptPassToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return `${VERSION}.${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url')}`;
}

/** Returns the token, or null if the value is missing or was encrypted with a different secret. */
export function decryptPassToken(stored: string | null | undefined): string | null {
  if (!stored?.startsWith(`${VERSION}.`)) return null;
  try {
    const buf = Buffer.from(stored.slice(VERSION.length + 1), 'base64url');
    const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
