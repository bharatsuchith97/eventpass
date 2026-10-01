import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { migrationsDir, status } from '../src/db/migrator';
import { resetConfigForTests } from '../src/config';
import { outbox } from '../src/services/mailer';
import { client, db, future, getApp, login, PASSWORD, signup, uniq } from './helpers';

let app: Express;
beforeAll(async () => {
  app = await getApp();
});

describe('E2E happy path: signup -> event -> import -> pass -> scan -> report', () => {
  it('runs the whole primary user journey', async () => {
    // Company signs up and is approved; its admin belongs to that company
    const { email, user } = await signup(app, 'Journey');
    expect(user.companySlug).toBeTruthy();
    const owner = await db().query<{ company_id: string; role: string }>('SELECT company_id, role FROM users WHERE lower(email) = $1', [email]);
    expect(owner.rows[0]).toEqual({ company_id: user.companyId, role: 'COMPANY_ADMIN' });

    // Admin logs in (fresh session), creates + publishes an event
    const { c: admin, res: loginRes } = await login(app, email);
    expect(loginRes.status).toBe(200);
    const ev = await admin.post('/api/events', { name: 'Launch Party', venueName: 'Main Hall', startDatetime: future(1), endDatetime: future(6), capacity: 100 });
    expect(ev.status).toBe(201);
    const eventId = ev.body.id as string;
    expect((await admin.post(`/api/events/${eventId}/status`, { action: 'publish' })).body.status).toBe('PUBLISHED');

    // CSV import with row-level errors, preview then confirm
    const csv = [
      'First Name,Last Name,Email,Phone,Company,Category',
      'Ada,Lovelace,ada@example.com,+1 555 000 0001,Analytical,VIP',
      'Bob,,bob@example.com,,,',
      'Cy,Young,not-an-email,,,',
      'Dee,Ray,dee@example.com,+1 555 000 0001,,',
      'Eve,Ng,ada@example.com,,,',
      'Fay,Oh,fay@example.com,,Acme,speaker',
    ].join('\n');
    const preview = await admin.post('/api/guests/import/preview', { csv });
    expect(preview.status).toBe(200);
    expect(preview.body.totalRows).toBe(5 + 1);
    expect(preview.body.validRows).toBe(2);
    const msgs = (preview.body.errors as { row: number; message: string }[]).map((e) => `${e.row}:${e.message}`);
    expect(msgs).toContain('3:Missing last name');
    expect(msgs).toContain('4:Invalid email');
    expect(msgs.some((m) => m.startsWith('5:Duplicate phone number'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('6:Duplicate email'))).toBe(true);
    // nothing was inserted by the preview
    expect((await admin.get('/api/guests')).body.total).toBe(0);
    // committing with errors is refused unless the user opts to skip them
    expect((await admin.post('/api/guests/import/commit', { csv })).status).toBe(400);
    const commit = await admin.post('/api/guests/import/commit', { csv, skipInvalid: true, eventId, generatePasses: true, sendInvitations: true });
    expect(commit.status).toBe(201);
    expect(commit.body).toMatchObject({ imported: 2, skippedRows: 4, tickets: { issued: 2, invited: 2 } });

    // Guest received an email containing a pass link
    const mail = outbox.find((m) => m.to === 'ada@example.com');
    expect(mail).toBeTruthy();
    const link = /\/pass\/([a-z0-9-]+)\/([0-9a-f]{64})/.exec(mail!.text);
    expect(link).toBeTruthy();
    const [, slug, token] = link!;

    // Public pass page exposes only the minimum, and guest can RSVP
    const pass = await client(app).get(`/api/public/pass/${slug}/${token}`);
    expect(pass.status).toBe(200);
    expect(Object.keys(pass.body).sort()).not.toContain('email');
    expect(pass.body.firstName).toBe('Ada');
    const rsvp = await client(app).post(`/api/public/pass/${slug}/${token}/rsvp`, { response: 'CONFIRMED' });
    expect(rsvp.body.rsvpStatus).toBe('CONFIRMED');

    // Staff scans the QR: success with guest name; second scan rejected
    const scan = await admin.post('/api/checkin', { token: `https://app.eventpass.com/checkin/${token}`, eventId, gate: 'Gate A' });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({ ok: true, guest: { firstName: 'Ada', lastName: 'Lovelace', category: 'VIP' } });
    const again = await admin.post('/api/checkin', { token, eventId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TICKET_ALREADY_USED');

    // Dashboard + reports reflect it
    const stats = (await admin.get(`/api/events/${eventId}/stats`)).body;
    expect(stats).toMatchObject({ totalInvited: 2, checkedIn: 1, notCheckedIn: 1, rsvpConfirmed: 1, rsvpPending: 1, attendancePct: 50 });
    const att = (await admin.get(`/api/events/${eventId}/reports/attendance`)).body;
    expect(att.rows).toHaveLength(2);
    expect(att.rows.find((r: { guest: string }) => r.guest === 'Ada Lovelace').status).toBe('Checked in');
    const noshow = (await admin.get(`/api/events/${eventId}/reports/noshow`)).body;
    expect(noshow.rows.map((r: { guest: string }) => r.guest)).toEqual(['Fay Oh']);
    const csvOut = await admin.get(`/api/events/${eventId}/reports/attendance?format=csv`);
    expect(csvOut.headers['content-type']).toMatch(/text\/csv/);
    expect(csvOut.text).toContain('Ada Lovelace');

    // Audit trail exists
    const audit = (await admin.get('/api/audit-logs')).body.items as { action: string }[];
    for (const a of ['EVENT_CREATED', 'GUEST_IMPORTED', 'TICKET_GENERATED', 'INVITATION_SENT', 'CHECKIN_CREATED', 'CHECKIN_REJECTED']) {
      expect(audit.map((x) => x.action)).toContain(a);
    }
    // ...and never contains PII or raw tokens
    const raw = JSON.stringify(audit);
    expect(raw).not.toContain(token!);
    expect(raw).not.toContain('ada@example.com');
  });

  it('stores only the token hash, and the DB enforces one check-in per ticket', async () => {
    const { c } = await signup(app, 'Hash');
    const ev = (await c.post('/api/events', { name: uniq('E'), startDatetime: future(1), endDatetime: future(4) })).body;
    await c.post(`/api/events/${ev.id}/status`, { action: 'publish' });
    const g = (await c.post('/api/guests', { firstName: 'A', lastName: 'B', email: `${uniq('h')}@example.com` })).body;
    const t = (await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id] })).body.tickets[0];
    const { token } = (await c.post(`/api/tickets/${t.ticketId}/reissue`)).body;
    const tdb = db();
    const row = (await tdb.query('SELECT qr_token_hash FROM tickets WHERE id = $1', [t.ticketId])).rows[0];
    expect(row.qr_token_hash).not.toBe(token);
    expect(row.qr_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await tdb.query("SELECT 1 FROM tickets WHERE qr_token_hash = $1", [token])).rowCount).toBe(0);
    await c.post('/api/checkin', { token });
    await expect(
      tdb.query(
        `INSERT INTO checkins (company_id, ticket_id, event_id, guest_id, checked_in_by)
         SELECT company_id, ticket_id, event_id, guest_id, checked_in_by FROM checkins WHERE ticket_id = $1`,
        [t.ticketId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('reissuing a pass invalidates the previous QR', async () => {
    const { c } = await signup(app, 'Reissue');
    const ev = (await c.post('/api/events', { name: uniq('E'), startDatetime: future(1), endDatetime: future(4) })).body;
    await c.post(`/api/events/${ev.id}/status`, { action: 'publish' });
    const g = (await c.post('/api/guests', { firstName: 'A', lastName: 'B', email: `${uniq('r')}@example.com` })).body;
    const t = (await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id] })).body.tickets[0];
    const first = (await c.post(`/api/tickets/${t.ticketId}/reissue`)).body.token;
    const second = (await c.post(`/api/tickets/${t.ticketId}/reissue`)).body.token;
    expect((await c.post('/api/checkin', { token: first })).body.error.code).toBe('INVALID_TICKET');
    expect((await c.post('/api/checkin', { token: second })).status).toBe(200);
  });

  it('generates a PDF pass', async () => {
    const { c } = await signup(app, 'Pdf');
    const ev = (await c.post('/api/events', { name: uniq('E'), startDatetime: future(1), endDatetime: future(4) })).body;
    const g = (await c.post('/api/guests', { firstName: 'A', lastName: 'B', email: `${uniq('p')}@example.com` })).body;
    const t = (await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id] })).body.tickets[0];
    const res = await c.post(`/api/tickets/${t.ticketId}/pass-pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('captures the browser timezone at signup and rejects unknown zones', async () => {
    const { c } = await signup(app, 'Zone', { timezone: 'Asia/Kolkata' });
    expect((await c.get('/api/company/settings')).body.timezone).toBe('Asia/Kolkata');
    const bad = await client(app).post('/api/auth/register', { companyName: 'Bad Zone', fullName: 'Z', email: `${uniq('tz')}@example.com`, password: PASSWORD, timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(400);
  });

  it('the database is on the latest migration', async () => {
    const s = await status(db(), migrationsDir());
    expect(s.applied.length).toBeGreaterThan(0);
    expect(s.pending).toEqual([]);
  });

  it('password reset, change password and session invalidation', async () => {
    const { c, email } = await signup(app, 'Pw');
    outbox.length = 0;
    expect((await client(app).post('/api/auth/forgot-password', { email })).status).toBe(200);
    expect((await client(app).post('/api/auth/forgot-password', { email: 'nobody@example.com' })).status).toBe(200); // no enumeration
    const token = /token=([0-9a-f]{64})/.exec(outbox.find((m) => m.to === email)!.text)![1];
    expect((await client(app).post('/api/auth/reset-password', { token, newPassword: 'BrandNew12345' })).status).toBe(200);
    expect((await client(app).post('/api/auth/reset-password', { token, newPassword: 'AnotherOne123' })).status).toBe(400); // single use
    expect((await c.get('/api/auth/me')).status).toBe(401); // old session killed
    expect((await login(app, email, PASSWORD)).res.status).toBe(401);
    const { c: c2, res } = await login(app, email, 'BrandNew12345');
    expect(res.status).toBe(200);
    expect((await c2.post('/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'Whatever12345' })).status).toBe(400);
    expect((await c2.post('/api/auth/change-password', { currentPassword: 'BrandNew12345', newPassword: 'Whatever12345' })).status).toBe(200);
    expect((await c2.get('/api/auth/me')).status).toBe(200); // fresh cookie issued
  });
});

describe('email failures are reported, never hidden', () => {
  it('a pass is still created when its invitation cannot be emailed, and the failure is counted', async () => {
    const { c } = await signup(app, 'Mailfail');
    const ev = (await c.post('/api/events', { name: uniq('E'), startDatetime: future(1), endDatetime: future(4) })).body;
    await c.post(`/api/events/${ev.id}/status`, { action: 'publish' });
    const g = (await c.post('/api/guests', { firstName: 'No', lastName: 'Mail', email: `${uniq('nm')}@example.com` })).body;
    // point the mailer at a port where nothing listens, so every send is refused
    process.env.SMTP_URL = 'smtp://127.0.0.1:2';
    resetConfigForTests();
    try {
      const r = await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id], send: true });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ issued: 1, invited: 0, failed: 1 });
      const list = await c.get(`/api/events/${ev.id}/tickets`);
      expect(list.body.items[0].invitationStatus).toBe('FAILED');
    } finally {
      delete process.env.SMTP_URL;
      resetConfigForTests();
    }
  });
});
