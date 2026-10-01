import { describe, expect, it } from 'vitest';
import { extractToken, generateQrToken, generateTicketNumber, isWellFormedToken, sha256Hex } from '../src/lib/crypto';
import { toCsv } from '../src/lib/csv';
import { can, PERMISSIONS, ROLES, type Permission, type Role } from '../src/lib/permissions';
import { guestSchema } from '../src/services/guests';
import { loadMigrations, migrationsDir } from '../src/db/migrator';

describe('QR token generation', () => {
  it('produces 64-char hex tokens that are unique', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateQrToken));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it('hash is SHA-256 of the token and differs from it', () => {
    const t = generateQrToken();
    const h = sha256Hex(t);
    expect(h).toHaveLength(64);
    expect(h).not.toBe(t);
    expect(sha256Hex(t)).toBe(h);
  });
  it('ticket numbers look like EVT-XXXXXX and are not sequential', () => {
    const a = generateTicketNumber();
    const b = generateTicketNumber();
    expect(a).toMatch(/^EVT-[0-9A-F]{6}$/);
    expect(a).not.toBe(b);
  });
  it('extracts a token from a bare value or scanned URL, rejects junk', () => {
    const t = generateQrToken();
    expect(extractToken(t)).toBe(t);
    expect(extractToken(`https://app.eventpass.com/checkin/${t}`)).toBe(t);
    expect(extractToken(`  ${t.toUpperCase()}  `)).toBe(t);
    expect(extractToken('hello')).toBeNull();
    expect(extractToken(t.slice(1))).toBeNull();
    expect(isWellFormedToken('../../etc/passwd')).toBe(false);
  });
});

describe('role permission matrix', () => {
  const expected: Record<Permission, Role[]> = {
    'company:manage': ['COMPANY_ADMIN'],
    'users:manage': ['COMPANY_ADMIN'],
    'audit:view': ['COMPANY_ADMIN'],
    'events:read': ['COMPANY_ADMIN', 'EVENT_MANAGER', 'CHECKIN_STAFF'],
    'events:write': ['COMPANY_ADMIN', 'EVENT_MANAGER'],
    'guests:manage': ['COMPANY_ADMIN', 'EVENT_MANAGER'],
    'guests:export': ['COMPANY_ADMIN', 'EVENT_MANAGER'],
    'tickets:manage': ['COMPANY_ADMIN', 'EVENT_MANAGER'],
    'invitations:send': ['COMPANY_ADMIN', 'EVENT_MANAGER'],
    'reports:view': ['COMPANY_ADMIN', 'EVENT_MANAGER'],
    'integrations:manage': ['COMPANY_ADMIN'],
    'checkin:scan': ['COMPANY_ADMIN', 'EVENT_MANAGER', 'CHECKIN_STAFF'],
  };
  for (const p of Object.keys(PERMISSIONS) as Permission[]) {
    it(`${p}`, () => {
      for (const role of ROLES) expect(can(role, p)).toBe(expected[p].includes(role));
    });
  }
});

describe('guest validation', () => {
  const ok = { firstName: 'Ada', lastName: 'Lovelace', email: ' ADA@Example.com ' };
  it('normalises email and defaults category', () => {
    const g = guestSchema.parse(ok);
    expect(g.email).toBe('ada@example.com');
    expect(g.category).toBe('ATTENDEE');
  });
  it('rejects bad email, missing names, bad phone, bad category', () => {
    expect(guestSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false);
    expect(guestSchema.safeParse({ ...ok, firstName: '' }).success).toBe(false);
    expect(guestSchema.safeParse({ ...ok, phone: 'abc' }).success).toBe(false);
    expect(guestSchema.safeParse({ ...ok, category: 'BOSS' }).success).toBe(false);
  });
  it('normalises phone numbers', () => {
    expect(guestSchema.parse({ ...ok, phone: '+1 (555) 123-4567' }).phone).toBe('+15551234567');
    expect(guestSchema.parse({ ...ok, phone: '' }).phone).toBeNull();
  });
});

describe('CSV export safety', () => {
  it('escapes quotes/commas and neutralises formula injection', () => {
    const csv = toCsv(['a', 'b'], [['=HYPERLINK("x")', 'hello, "world"']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"hello, ""world"""');
  });
});

describe('migrations', () => {
  it('are numbered, ordered, and have down scripts', async () => {
    const m = await loadMigrations(migrationsDir());
    expect(m.length).toBeGreaterThan(0);
    expect(m.map((x) => x.version)).toEqual([...m.map((x) => x.version)].sort());
    for (const x of m) expect(x.down.trim().length).toBeGreaterThan(0);
  });
});
