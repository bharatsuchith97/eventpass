import type { Express } from 'express';
import request from 'supertest';
import { prepareDatabases } from '../src/server';
import { createApp } from '../src/app';
import { pool } from '../src/db/pools';

export type Agent = ReturnType<typeof request.agent>;

let app: Express | undefined;
export async function getApp(): Promise<Express> {
  if (!app) {
    await prepareDatabases();
    app = createApp();
  }
  return app;
}

/** supertest agent (keeps the session cookie) that always sends the CSRF header. */
export function client(a: Express) {
  const agent = request.agent(a);
  const h = (t: request.Test) => t.set('X-Requested-With', 'eventpass');
  return {
    agent,
    get: (url: string) => h(agent.get(url)),
    post: (url: string, body?: object) => h(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => h(agent.put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => h(agent.patch(url)).send(body ?? {}),
    delete: (url: string) => h(agent.delete(url)),
  };
}
export type Client = ReturnType<typeof client>;

let n = 0;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${n++}`;
export const PASSWORD = 'CorrectHorse42';

export const SUPERADMIN = { email: 'root@example.com', password: 'SuperSecret-42x' }; // see globalSetup

/** Logged-in superadmin client. */
export async function superadmin(a: Express) {
  const c = client(a);
  const res = await c.post('/api/admin/login', SUPERADMIN);
  if (res.status !== 200) throw new Error(`superadmin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

/** Submit a company request as an anonymous visitor. */
export async function requestCompany(a: Express, label = 'Acme', over: Record<string, unknown> = {}) {
  const email = `${uniq(label.toLowerCase())}@example.com`;
  const res = await client(a).post('/api/auth/register', { companyName: `${label} ${uniq('Co')}`, fullName: `${label} Admin`, email, password: PASSWORD, ...over });
  if (res.status !== 202) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, requestId: res.body.requestId as string };
}

/** Request a company, have the superadmin approve it, and sign in as its first admin. */
export async function signup(a: Express, label = 'Acme', over: Record<string, unknown> = {}) {
  const { email, requestId } = await requestCompany(a, label, over);
  const root = await superadmin(a);
  const ok = await root.post(`/api/admin/requests/${requestId}/approve`);
  if (ok.status !== 200) throw new Error(`approve failed: ${ok.status} ${JSON.stringify(ok.body)}`);
  const c = client(a);
  const res = await c.post('/api/auth/login', { email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login after approval failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { c, email, user: res.body.user as { id: string; companySlug: string; companyId: string } };
}

export async function login(a: Express, email: string, password = PASSWORD) {
  const c = client(a);
  const res = await c.post('/api/auth/login', { email, password });
  return { c, res };
}

export async function addUser(admin: Client, a: Express, role: 'EVENT_MANAGER' | 'CHECKIN_STAFF' | 'COMPANY_ADMIN') {
  const email = `${uniq(role.toLowerCase())}@example.com`;
  const res = await admin.post('/api/users', { email, fullName: role, role, password: PASSWORD });
  if (res.status !== 201) throw new Error(`addUser failed: ${JSON.stringify(res.body)}`);
  const { c } = await login(a, email);
  return { c, email, id: res.body.id as string };
}

export const future = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

export async function makeEvent(c: Client, over: Record<string, unknown> = {}) {
  const res = await c.post('/api/events', { name: uniq('Summit'), startDatetime: future(24), endDatetime: future(30), ...over });
  if (res.status !== 201) throw new Error(`makeEvent failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; status: string };
}

export async function publish(c: Client, id: string) {
  const res = await c.post(`/api/events/${id}/status`, { action: 'publish' });
  if (res.status !== 200) throw new Error(`publish failed: ${JSON.stringify(res.body)}`);
}

export async function makeGuest(c: Client, over: Record<string, unknown> = {}) {
  const res = await c.post('/api/guests', { firstName: 'Ada', lastName: 'Lovelace', email: `${uniq('g')}@example.com`, ...over });
  if (res.status !== 201) throw new Error(`makeGuest failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; email: string };
}

/** Issue one pass and return its raw QR token (only obtainable at issue/reissue time). */
export async function issuePass(c: Client, eventId: string, guestId: string) {
  const t = await c.post(`/api/events/${eventId}/tickets`, { guestIds: [guestId] });
  if (t.status !== 201 || t.body.issued !== 1) throw new Error(`issue failed: ${JSON.stringify(t.body)}`);
  const ticketId = t.body.tickets[0].ticketId as string;
  const re = await c.post(`/api/tickets/${ticketId}/reissue`);
  return { ticketId, token: re.body.token as string };
}

/** Direct access to the shared database, for assertions and for forcing edge states. */
export const db = () => pool();
