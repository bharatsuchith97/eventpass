import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token; this raw value (and only this) is what the QR code carries. */
export function generateQrToken(): string {
  return randomBytes(32).toString('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Human-readable ticket number, e.g. EVT-8F92A1. Not a secret; not sequential. */
export function generateTicketNumber(): string {
  return `EVT-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function generateEventCode(): string {
  return `E${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const TOKEN_RE = /^[0-9a-f]{64}$/;
export const isWellFormedToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);

/** Accepts either a bare token or a scanned URL like https://host/checkin/<token>. */
export function extractToken(scanned: string): string | null {
  const m = scanned.trim().match(/([0-9a-f]{64})(?:[/?#].*)?$/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}
