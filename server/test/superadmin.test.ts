import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { pool } from '../src/db/pools';
import { outbox } from '../src/services/mailer';
import { client, getApp, login, PASSWORD, requestCompany, signup, SUPERADMIN, superadmin } from './helpers';

let app: Express;
beforeAll(async () => {
  app = await getApp();
});

describe('Company signup requires superadmin approval', () => {
  it('a new signup gets no session and no company until approved', async () => {
    const reg = await client(app).post('/api/auth/register', { companyName: 'Pending Co', fullName: 'P', email: 'pending1@example.com', password: PASSWORD });
    expect(reg.status).toBe(202);
    expect(reg.body.status).toBe('PENDING');
    expect(reg.headers['set-cookie']).toBeUndefined();
    const companies = await pool().query("SELECT 1 FROM companies WHERE name = 'Pending Co'");
    expect(companies.rowCount).toBe(0);
    expect(outbox.some((m) => m.to === SUPERADMIN.email && m.subject.includes('Pending Co'))).toBe(true);
  });

  it('login explains the wait only to someone who knows the password', async () => {
    const { email } = await requestCompany(app, 'Waiting');
    const right = await login(app, email);
    expect(right.res.status).toBe(403);
    expect(right.res.body.error.code).toBe('PENDING_APPROVAL');
    const wrong = await login(app, email, 'WrongPassword99');
    const unknown = await login(app, 'nobody-here@example.com', 'WrongPassword99');
    expect(wrong.res.status).toBe(401);
    expect(wrong.res.body).toEqual(unknown.res.body);
  });

  it('rejects a second pending request for the same email', async () => {
    const { email } = await requestCompany(app, 'Twice');
    const again = await client(app).post('/api/auth/register', { companyName: 'Twice Again', fullName: 'T', email, password: PASSWORD });
    expect(again.status).toBe(409);
  });

  it('approval provisions the company, emails the owner and lets them sign in', async () => {
    const { email, requestId } = await requestCompany(app, 'Approve');
    const root = await superadmin(app);
    const pending = await root.get('/api/admin/requests');
    expect(pending.body.items.some((r: { id: string }) => r.id === requestId)).toBe(true);

    const ok = await root.post(`/api/admin/requests/${requestId}/approve`);
    expect(ok.status).toBe(200);
    expect(outbox.some((m) => m.to === email && m.subject.includes('ready'))).toBe(true);
    // the stored hash is discarded once it has moved to auth_credentials
    const req = await pool().query('SELECT password_hash FROM company_requests WHERE id = $1', [requestId]);
    expect(req.rows[0].password_hash).toBeNull();

    const { res } = await login(app, email);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('COMPANY_ADMIN');

    // deciding twice is a conflict, not a second company
    expect((await root.post(`/api/admin/requests/${requestId}/approve`)).status).toBe(409);
    expect((await root.post(`/api/admin/requests/${requestId}/reject`)).status).toBe(409);
  });

  it('concurrent approvals provision exactly once', async () => {
    const { requestId } = await requestCompany(app, 'Race');
    const root = await superadmin(app);
    const results = await Promise.all([1, 2, 3].map(() => root.post(`/api/admin/requests/${requestId}/approve`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it('rejection emails the reason and never creates an account', async () => {
    const { email, requestId } = await requestCompany(app, 'Reject');
    const root = await superadmin(app);
    const r = await root.post(`/api/admin/requests/${requestId}/reject`, { reason: 'Unknown organisation' });
    expect(r.status).toBe(200);
    expect(outbox.find((m) => m.to === email && m.text.includes('Unknown organisation'))).toBeTruthy();
    expect((await login(app, email)).res.status).toBe(401);
    const rejected = await root.get('/api/admin/requests?status=REJECTED');
    expect(rejected.body.items.some((x: { id: string }) => x.id === requestId)).toBe(true);
    // the email is free to request again
    expect((await client(app).post('/api/auth/register', { companyName: 'Reject Again', fullName: 'R', email, password: PASSWORD })).status).toBe(202);
  });

  it('suspending a company cuts off its sessions and logins; reactivating restores them', async () => {
    const owner = await signup(app, 'Suspend');
    const root = await superadmin(app);
    expect((await root.patch(`/api/admin/companies/${owner.user.companyId}`, { status: 'SUSPENDED' })).status).toBe(200);
    expect((await owner.c.get('/api/events')).status).toBe(403);
    expect((await login(app, owner.email)).res.status).toBe(403);
    expect((await root.patch(`/api/admin/companies/${owner.user.companyId}`, { status: 'ACTIVE' })).status).toBe(200);
    expect((await login(app, owner.email)).res.status).toBe(200);
  });

  it('changes a company plan', async () => {
    const owner = await signup(app, 'Plan');
    const root = await superadmin(app);
    expect((await root.patch(`/api/admin/companies/${owner.user.companyId}`, { plan: 'business' })).status).toBe(200);
    const list = await root.get('/api/admin/companies');
    expect(list.body.items.find((c: { id: string }) => c.id === owner.user.companyId).plan).toBe('business');
    expect((await root.patch(`/api/admin/companies/${owner.user.companyId}`, { plan: 'platinum' })).status).toBe(400);
  });
});

describe('Superadmin boundaries', () => {
  it('admin endpoints need a superadmin session', async () => {
    expect((await client(app).get('/api/admin/requests')).status).toBe(401);
    const tenant = await signup(app, 'Tenant');
    // a company admin's session cookie is not a superadmin session
    expect((await tenant.c.get('/api/admin/companies')).status).toBe(401);
    expect((await tenant.c.post('/api/admin/login', { email: tenant.email, password: PASSWORD })).status).toBe(401);
  });

  it('a superadmin token cannot be used as a tenant session', async () => {
    const root = await superadmin(app);
    const cookie = root.agent.jar.getCookie('ep_admin', { domain: '127.0.0.1', path: '/', secure: false, script: false });
    expect(cookie).toBeTruthy();
    const forged = await client(app).get('/api/auth/me').set('Cookie', `ep_session=${cookie!.value}`);
    expect(forged.status).toBe(401);
    // and the superadmin has no tenant session of its own
    expect((await root.get('/api/events')).status).toBe(401);
  });

  it('wrong superadmin password is rejected like an unknown account', async () => {
    const wrong = await client(app).post('/api/admin/login', { email: SUPERADMIN.email, password: 'nope-nope-nope' });
    const unknown = await client(app).post('/api/admin/login', { email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('admin logout ends the superadmin session', async () => {
    const root = await superadmin(app);
    expect((await root.post('/api/admin/logout')).status).toBe(200);
    expect((await root.get('/api/admin/me')).status).toBe(401);
  });
});
