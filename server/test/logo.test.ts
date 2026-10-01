import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { outbox } from '../src/services/mailer';
import { addUser, client, future, getApp, signup, uniq, type Client } from './helpers';

let app: Express;
beforeAll(async () => {
  app = await getApp();
});

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const putLogo = (c: Client, body: Buffer, type = 'image/png') => c.agent.put('/api/company/logo').set('X-Requested-With', 'eventpass').set('Content-Type', type).send(body);

describe('company logo', () => {
  it('upload shows up in settings, the public logo URL, the guest pass, the PDF and the invitation email', async () => {
    const { c, user } = await signup(app, 'Logo');
    expect((await c.get('/api/company/settings')).body.logoUrl).toBeNull();

    const up = await putLogo(c, PNG);
    expect(up.status).toBe(200);
    const logoUrl = up.body.logoUrl as string;
    expect(logoUrl).toMatch(new RegExp(`^/api/public/logo/${user.companySlug}\\?v=\\d+$`));

    // served publicly (guests and email clients), as the stored bytes
    const img = await request(app).get(logoUrl).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);

    // event, guest, pass + invitation
    const ev = (await c.post('/api/events', { name: uniq('E'), startDatetime: future(1), endDatetime: future(4) })).body;
    await c.post(`/api/events/${ev.id}/status`, { action: 'publish' });
    const g = (await c.post('/api/guests', { firstName: 'Logo', lastName: 'Guest', email: `${uniq('lg')}@example.com` })).body;
    const t = (await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id], send: true })).body.tickets[0];

    const mail = outbox.filter((m) => m.to === g.email).at(-1)!;
    expect(mail.html).toContain('cid:logo');
    expect(mail.attachments?.some((a) => a.cid === 'logo' && a.contentType === 'image/png')).toBe(true);

    const { token } = (await c.get(`/api/tickets/${t.ticketId}/pass`)).body;
    const pub = await client(app).get(`/api/public/pass/${user.companySlug}/${token}`);
    expect(pub.body.logoUrl).toBe(logoUrl);

    const pdf = await c.post(`/api/tickets/${t.ticketId}/pass-pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('refuses files that are not really PNG/JPG, oversized files, and non-admins', async () => {
    const { c } = await signup(app, 'Badlogo');
    expect((await putLogo(c, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status).toBe(400); // claims PNG, isn't
    expect((await putLogo(c, Buffer.from('hello'), 'text/plain')).status).toBe(400);
    expect((await putLogo(c, Buffer.concat([PNG, Buffer.alloc(600 * 1024)]))).status).toBe(413);
    const staff = await addUser(c, app, 'CHECKIN_STAFF');
    expect((await putLogo(staff.c, PNG)).status).toBe(403);
    expect((await staff.c.delete('/api/company/logo')).status).toBe(403);
    expect((await c.get('/api/company/settings')).body.logoUrl).toBeNull();
  });

  it('removing the logo stops serving it, and one company cannot affect another', async () => {
    const a = await signup(app, 'Alogo');
    const b = await signup(app, 'Blogo');
    const url = (await putLogo(a.c, PNG)).body.logoUrl as string;
    await putLogo(b.c, PNG);
    expect((await b.c.delete('/api/company/logo')).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(200); // A's logo untouched by B
    expect((await a.c.delete('/api/company/logo')).body.logoUrl).toBeNull();
    expect((await request(app).get(url)).status).toBe(404);
  });
});
