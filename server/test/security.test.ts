import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { addUser, client, db, getApp, issuePass, login, makeEvent, makeGuest, publish, signup, uniq, future } from './helpers';

let app: Express;
beforeAll(async () => {
  app = await getApp();
});

describe('tenant isolation (Company A vs Company B)', () => {
  it('B cannot read or touch any of A\'s resources, even with valid ids', async () => {
    const a = await signup(app, 'Alpha');
    const b = await signup(app, 'Bravo');
    const ev = await makeEvent(a.c);
    await publish(a.c, ev.id);
    const guest = await makeGuest(a.c);
    const { ticketId, token } = await issuePass(a.c, ev.id, guest.id);
    await a.c.post('/api/checkin', { token });
    const staffA = await addUser(a.c, app, 'CHECKIN_STAFF');

    const forbiddenOrMissing = (s: number) => expect([403, 404]).toContain(s);
    forbiddenOrMissing((await b.c.get(`/api/events/${ev.id}`)).status);
    forbiddenOrMissing((await b.c.patch(`/api/events/${ev.id}`, { name: 'hacked' })).status);
    forbiddenOrMissing((await b.c.post(`/api/events/${ev.id}/status`, { action: 'cancel' })).status);
    forbiddenOrMissing((await b.c.get(`/api/events/${ev.id}/stats`)).status);
    forbiddenOrMissing((await b.c.get(`/api/events/${ev.id}/tickets`)).status);
    forbiddenOrMissing((await b.c.get(`/api/events/${ev.id}/reports/attendance`)).status);
    forbiddenOrMissing((await b.c.get(`/api/events/${ev.id}/checkins`)).status);
    forbiddenOrMissing((await b.c.post(`/api/events/${ev.id}/tickets`, { guestIds: [guest.id] })).status);
    forbiddenOrMissing((await b.c.get(`/api/guests/${guest.id}`)).status);
    forbiddenOrMissing((await b.c.patch(`/api/guests/${guest.id}`, { firstName: 'x' })).status);
    forbiddenOrMissing((await b.c.delete(`/api/guests/${guest.id}`)).status);
    forbiddenOrMissing((await b.c.post(`/api/tickets/${ticketId}/cancel`)).status);
    forbiddenOrMissing((await b.c.post(`/api/tickets/${ticketId}/reissue`)).status);
    forbiddenOrMissing((await b.c.patch(`/api/users/${staffA.id}`, { status: 'DISABLED' })).status);
    forbiddenOrMissing((await b.c.put(`/api/events/${ev.id}/managers`, { userIds: [] })).status);

    // lists only ever contain B's own data
    expect((await b.c.get('/api/events')).body.items).toHaveLength(0);
    expect((await b.c.get('/api/guests')).body.total).toBe(0);
    const users = (await b.c.get('/api/users')).body.items as { email: string }[];
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe(b.email);
    const audit = (await b.c.get('/api/audit-logs')).body.items as { entityId: string }[];
    expect(audit.some((x) => x.entityId === ev.id || x.entityId === ticketId)).toBe(false);

    // A's ticket scanned by B's staff is simply unknown to B
    const scan = await b.c.post('/api/checkin', { token });
    expect(scan.status).toBe(404);
    expect(scan.body.error.code).toBe('INVALID_TICKET');
    // ...and B's scan attempt did not disturb A's records
    expect((await a.c.get(`/api/events/${ev.id}/stats`)).body.checkedIn).toBe(1);
  });

  it('company_id from the client is ignored; rows are stored under the session company', async () => {
    const a = await signup(app, 'Charlie');
    const b = await signup(app, 'Delta');
    const res = await b.c.post('/api/events', { name: 'Valid Name', startDatetime: future(1), endDatetime: future(2), companyId: a.user.companyId, company_id: a.user.companyId });
    expect(res.status).toBe(201);
    expect((await a.c.get('/api/events')).body.items).toHaveLength(0);
    const row = await db().query('SELECT company_id FROM events WHERE id = $1', [res.body.id]);
    expect(row.rows[0].company_id).toBe(b.user.companyId);
  });

  it('B cannot use A\'s ids inside its own requests (issuing, managers, check-in by ticket id)', async () => {
    const a = await signup(app, 'Golfa');
    const b = await signup(app, 'Hotelb');
    const evA = await makeEvent(a.c);
    await publish(a.c, evA.id);
    const gA = await makeGuest(a.c);
    const { ticketId } = await issuePass(a.c, evA.id, gA.id);
    const evB = await makeEvent(b.c);
    await publish(b.c, evB.id);
    // A's guest cannot be put on B's event
    expect((await b.c.post(`/api/events/${evB.id}/tickets`, { guestIds: [gA.id] })).status).toBe(404);
    // A's admin cannot be made a manager of B's event
    const adminA = (await a.c.get('/api/auth/me')).body.user.id as string;
    expect((await b.c.put(`/api/events/${evB.id}/managers`, { userIds: [adminA] })).status).toBe(400);
    // B cannot check in A's ticket by id
    expect((await b.c.post('/api/checkin/manual', { ticketId })).status).toBe(404);
    expect((await a.c.get(`/api/events/${evA.id}/stats`)).body.checkedIn).toBe(0);
    // B's bulk delete of A's guest affects nothing
    expect((await b.c.post('/api/guests/bulk-delete', { ids: [gA.id] })).body.deleted).toBe(0);
    expect((await a.c.get(`/api/guests/${gA.id}`)).status).toBe(200);
  });

  it('the database itself refuses rows that link two companies', async () => {
    const a = await signup(app, 'Indiaa');
    const b = await signup(app, 'Julietb');
    const evA = await makeEvent(a.c);
    const gB = await makeGuest(b.c);
    // a ticket for A's event and B's guest violates the composite (company_id, id) foreign keys
    await expect(
      db().query(
        `INSERT INTO tickets (company_id, event_id, guest_id, ticket_number, qr_token_hash, expires_at)
         VALUES ($1, $2, $3, 'EVT-XXXXXX', $4, now() + interval '1 day')`,
        [a.user.companyId, evA.id, gB.id, randomBytes(32).toString('hex')],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('public pass links do not leak across tenants', async () => {
    const a = await signup(app, 'Echo');
    const b = await signup(app, 'Foxtrot');
    const ev = await makeEvent(a.c);
    const g = await makeGuest(a.c);
    const { token } = await issuePass(a.c, ev.id, g.id);
    expect((await client(app).get(`/api/public/pass/${a.user.companySlug}/${token}`)).status).toBe(200);
    expect((await client(app).get(`/api/public/pass/${b.user.companySlug}/${token}`)).status).toBe(404);
    expect((await client(app).get(`/api/public/pass/no-such-company/${token}`)).status).toBe(404);
    expect((await client(app).get(`/api/public/pass/${a.user.companySlug}/not-a-token`)).status).toBe(404);
  });
});

describe('RBAC', () => {
  it('check-in staff cannot reach admin or management endpoints', async () => {
    const admin = await signup(app, 'Golf');
    const staff = await addUser(admin.c, app, 'CHECKIN_STAFF');
    const ev = await makeEvent(admin.c);
    const g = await makeGuest(admin.c);
    for (const [method, url] of [
      ['get', '/api/users'], ['get', '/api/audit-logs'], ['get', '/api/guests'], ['get', '/api/guests/export.csv'], ['get', '/api/invitations'],
      ['get', `/api/events/${ev.id}/stats`], ['get', `/api/events/${ev.id}/tickets`], ['get', `/api/events/${ev.id}/reports/attendance`],
      ['get', '/api/integrations'],
    ] as const) {
      expect((await staff.c[method](url)).status, `${method} ${url}`).toBe(403);
    }
    expect((await staff.c.post('/api/events', { name: 'n', startDatetime: future(1), endDatetime: future(2) })).status).toBe(403);
    expect((await staff.c.post('/api/users', { email: 'x@example.com', fullName: 'x', role: 'COMPANY_ADMIN', password: 'Password12345' })).status).toBe(403);
    expect((await staff.c.post('/api/guests', { firstName: 'a', lastName: 'b', email: 'c@example.com' })).status).toBe(403);
    expect((await staff.c.put('/api/company/settings', {})).status).toBe(403);
    expect((await staff.c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id] })).status).toBe(403);
    // ...but can see published events and use the scanner
    await publish(admin.c, ev.id);
    expect((await staff.c.get('/api/events')).body.items).toHaveLength(1);
    const { token } = await issuePass(admin.c, ev.id, g.id);
    expect((await staff.c.post('/api/checkin', { token })).status).toBe(200);
    expect((await staff.c.get(`/api/checkin/search?eventId=${ev.id}&q=ad`)).status).toBe(200);
  });

  it('staff do not see draft events', async () => {
    const admin = await signup(app, 'Hotel');
    const staff = await addUser(admin.c, app, 'CHECKIN_STAFF');
    const draft = await makeEvent(admin.c);
    expect((await staff.c.get('/api/events')).body.items).toHaveLength(0);
    expect((await staff.c.get(`/api/events/${draft.id}`)).status).toBe(404);
  });

  it('event managers cannot manage users/settings/audit and only touch their own events', async () => {
    const admin = await signup(app, 'India');
    const m1 = await addUser(admin.c, app, 'EVENT_MANAGER');
    const m2 = await addUser(admin.c, app, 'EVENT_MANAGER');
    expect((await m1.c.get('/api/users')).status).toBe(403);
    expect((await m1.c.get('/api/audit-logs')).status).toBe(403);
    expect((await m1.c.put('/api/company/settings', {})).status).toBe(403);
    expect((await m1.c.post('/api/users', { email: 'z@example.com', fullName: 'z', role: 'COMPANY_ADMIN', password: 'Password12345' })).status).toBe(403);

    const e1 = await makeEvent(m1.c);
    const e2 = await makeEvent(m2.c);
    expect(((await m1.c.get('/api/events')).body.items as { id: string }[]).map((e) => e.id)).toEqual([e1.id]);
    expect((await m1.c.get(`/api/events/${e2.id}`)).status).toBe(404);
    expect((await m1.c.patch(`/api/events/${e2.id}`, { name: 'nope' })).status).toBe(403);
    expect((await m1.c.get(`/api/events/${e2.id}/reports/attendance`)).status).toBe(403);
    expect((await m1.c.post(`/api/events/${e2.id}/tickets`, { allGuests: true })).status).toBe(403);
    // admin can assign m1 to e2 and then m1 gets access; m1 cannot self-assign
    expect((await m1.c.put(`/api/events/${e2.id}/managers`, { userIds: [m1.id] })).status).toBe(403);
    expect((await admin.c.put(`/api/events/${e2.id}/managers`, { userIds: [m1.id, m2.id] })).status).toBe(200);
    expect((await m1.c.get(`/api/events/${e2.id}`)).status).toBe(200);
  });

  it('admins cannot remove the last active administrator', async () => {
    const admin = await signup(app, 'Juliet');
    const me = (await admin.c.get('/api/auth/me')).body.user.id;
    expect((await admin.c.patch(`/api/users/${me}`, { role: 'EVENT_MANAGER' })).status).toBe(400);
    expect((await admin.c.patch(`/api/users/${me}`, { status: 'DISABLED' })).status).toBe(400);
  });
});

describe('authentication', () => {
  it('rejects unauthenticated and CSRF-less requests', async () => {
    const anon = client(app);
    expect((await anon.get('/api/events')).status).toBe(401);
    expect((await anon.get('/api/auth/me')).status).toBe(401);
    expect((await anon.post('/api/checkin', { token: 'x' })).status).toBe(401);
    // tampered / garbage cookie
    const bad = await request(app).get('/api/events').set('Cookie', 'ep_session=not.a.jwt');
    expect(bad.status).toBe(401);
    // valid session but no CSRF header on a state-changing request
    const { c } = await signup(app, 'Kilo');
    const noHeader = await c.agent.post('/api/events').send({ name: 'Valid Name', startDatetime: future(1), endDatetime: future(2) });
    expect(noHeader.status).toBe(403);
    // wrong origin
    const wrongOrigin = await c.post('/api/events', { name: 'Valid Name', startDatetime: future(1), endDatetime: future(2) }).set('Origin', 'https://evil.example');
    expect(wrongOrigin.status).toBe(403);
  });

  it('session cookie is httpOnly + SameSite=Strict, and errors never expose internals', async () => {
    const { c, email } = await signup(app, 'Lima');
    const res = await client(app).post('/api/auth/login', { email, password: 'CorrectHorse42' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const err = await c.get('/api/events/not-a-uuid');
    expect(JSON.stringify(err.body)).not.toMatch(/stack|select |pg_|node_modules/i);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('wrong password / unknown email are indistinguishable; disabled users are rejected everywhere', async () => {
    const admin = await signup(app, 'Mike');
    const u = await addUser(admin.c, app, 'CHECKIN_STAFF');
    const wrong = await login(app, u.email, 'WrongPassword1');
    const unknown = await login(app, 'ghost@example.com', 'WrongPassword1');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body).toEqual(unknown.res.body);
    // existing session is cut off the moment the account is disabled
    expect((await u.c.get('/api/events')).status).toBe(200);
    expect((await admin.c.patch(`/api/users/${u.id}`, { status: 'DISABLED' })).status).toBe(200);
    const after = await u.c.get('/api/events');
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('USER_DISABLED');
    const relog = await login(app, u.email);
    expect(relog.res.status).toBe(403);
    expect(relog.res.body.error.code).toBe('USER_DISABLED');
  });

  it('validates registration input and rejects duplicate emails', async () => {
    const { email } = await signup(app, 'November');
    const c = client(app);
    expect((await c.post('/api/auth/register', { companyName: 'X Y', fullName: 'n', email, password: 'CorrectHorse42' })).status).toBe(409);
    expect((await c.post('/api/auth/register', { companyName: 'X Y', fullName: 'n', email: 'new@example.com', password: 'short' })).status).toBe(400);
    expect((await c.post('/api/auth/register', { companyName: 'X Y', fullName: 'n', email: 'bad', password: 'CorrectHorse42' })).status).toBe(400);
  });
});

describe('QR check-in adversarial cases', () => {
  async function setup(label: string) {
    const admin = await signup(app, label);
    const ev = await makeEvent(admin.c);
    await publish(admin.c, ev.id);
    const g = await makeGuest(admin.c);
    const pass = await issuePass(admin.c, ev.id, g.id);
    return { admin, ev, g, ...pass, db: db() };
  }

  it('rejects invalid / malformed / random tokens', async () => {
    const { admin } = await setup('Oscar');
    for (const token of [randomBytes(32).toString('hex'), 'garbage', '', '0'.repeat(64), "' OR 1=1 --"]) {
      const r = await admin.c.post('/api/checkin', { token });
      expect([400, 404], token).toContain(r.status);
      if (r.status === 404) expect(r.body.error.code).toBe('INVALID_TICKET');
    }
    expect((await admin.c.post('/api/checkin', {})).status).toBe(400);
  });

  it('rejects expired tickets', async () => {
    const { admin, token, ticketId, db } = await setup('Papa');
    await db.query("UPDATE tickets SET expires_at = now() - interval '1 minute' WHERE id = $1", [ticketId]);
    const r = await admin.c.post('/api/checkin', { token });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('TICKET_EXPIRED');
  });

  it('rejects cancelled tickets', async () => {
    const { admin, token, ticketId } = await setup('Quebec');
    await admin.c.post(`/api/tickets/${ticketId}/cancel`);
    const r = await admin.c.post('/api/checkin', { token });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('TICKET_CANCELLED');
  });

  it('rejects when the event is not active, and when scanned at another event', async () => {
    const { admin, token, ev } = await setup('Romeo');
    const other = await makeEvent(admin.c);
    const wrong = await admin.c.post('/api/checkin', { token, eventId: other.id });
    expect(wrong.status).toBe(404);
    await admin.c.post(`/api/events/${ev.id}/status`, { action: 'cancel' });
    const r = await admin.c.post('/api/checkin', { token });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EVENT_NOT_ACTIVE');
  });

  it('rejects a sequential duplicate scan and reports when it was first checked in', async () => {
    const { admin, token } = await setup('Sierra');
    expect((await admin.c.post('/api/checkin', { token })).status).toBe(200);
    const dup = await admin.c.post('/api/checkin', { token });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TICKET_ALREADY_USED');
    expect(dup.body.error.details.checkedInAt).toBeTruthy();
  });

  it('concurrent duplicate scans: exactly one succeeds', async () => {
    const { admin, token, db, ticketId } = await setup('Tango');
    const results = await Promise.all(Array.from({ length: 12 }, () => admin.c.post('/api/checkin', { token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'TICKET_ALREADY_USED')).toHaveLength(11);
    expect((await db.query('SELECT count(*)::int AS n FROM checkins WHERE ticket_id = $1', [ticketId])).rows[0].n).toBe(1);
  });

  it('concurrent scan and manual check-in for the same ticket: exactly one wins', async () => {
    const { admin, token, ticketId } = await setup('Uniform');
    const rs = await Promise.all([
      admin.c.post('/api/checkin', { token }),
      admin.c.post('/api/checkin/manual', { ticketId }),
      admin.c.post('/api/checkin', { token }),
      admin.c.post('/api/checkin/manual', { ticketId }),
    ]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('manual check-in via search works and is recorded; search masks emails', async () => {
    const { admin, ev, ticketId } = await setup('Victor');
    const s = await admin.c.get(`/api/checkin/search?eventId=${ev.id}&q=lovel`);
    expect(s.body.items).toHaveLength(1);
    expect(s.body.items[0].email).toMatch(/^.\*\*\*@/);
    const m = await admin.c.post('/api/checkin/manual', { ticketId, gate: 'Door 2' });
    expect(m.status).toBe(200);
    const hist = (await admin.c.get(`/api/events/${ev.id}/checkins`)).body;
    expect(hist.total).toBe(1);
    expect(hist.items[0]).toMatchObject({ method: 'MANUAL', gate: 'Door 2' });
  });

  it('a random UUID ticket id is never found', async () => {
    const { admin } = await setup('Whiskey');
    const r = await admin.c.post('/api/checkin/manual', { ticketId: randomUUID() });
    expect(r.status).toBe(404);
  });
});

describe('input safety', () => {
  it('SQL-injection-shaped input is treated as data', async () => {
    const { c } = await signup(app, 'Xray');
    const g = await makeGuest(c, { firstName: "Robert'); DROP TABLE guests;--" });
    expect(g.id).toBeTruthy();
    const list = await c.get(`/api/guests?search=${encodeURIComponent("' OR '1'='1")}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    expect((await c.get('/api/guests')).body.total).toBe(1);
  });

  it('rejects invalid ids, oversized bodies and bad dates', async () => {
    const { c } = await signup(app, 'Yankee');
    expect((await c.get('/api/guests/123')).status).toBe(404);
    expect((await c.post('/api/events', { name: 'Valid Name', startDatetime: future(5), endDatetime: future(1) })).status).toBe(400);
    expect((await c.post('/api/events', { name: 'Valid Name', startDatetime: 'tomorrow', endDatetime: 'later' })).status).toBe(400);
    const big = await c.post('/api/guests', { firstName: 'a'.repeat(200_000), lastName: 'b', email: 'e@example.com' });
    expect(big.status).toBe(413);
  });

  it('enforces plan limits (Starter: 3 active events)', async () => {
    const { c } = await signup(app, 'Zulu');
    for (let i = 0; i < 3; i++) await makeEvent(c);
    const r = await c.post('/api/events', { name: uniq('four'), startDatetime: future(1), endDatetime: future(2) });
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('PLAN_LIMIT');
  });
});
