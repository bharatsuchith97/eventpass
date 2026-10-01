import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { addUser, future, getApp, makeEvent, publish, signup, uniq, type Client } from './helpers';

let app: Express;
beforeAll(async () => {
  app = await getApp();
});

const csvText = async (c: Client, url: string) => {
  const r = await c.get(url).buffer(true).parse((res, cb) => {
    let s = '';
    res.on('data', (d: Buffer) => (s += d.toString('utf8')));
    res.on('end', () => cb(null, s));
  });
  return { status: r.status, text: r.body as string };
};

describe('guest ID', () => {
  it('is optional, unique within a company (case-insensitive), searchable, and free across companies', async () => {
    const a = await signup(app, 'Gida');
    const b = await signup(app, 'Gidb');
    const g = await a.c.post('/api/guests', { externalId: 'M-0042', firstName: 'Ada', lastName: 'Lovelace', email: `${uniq('a')}@example.com`, notes: 'Vegetarian' });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ externalId: 'M-0042', notes: 'Vegetarian', passes: 0, checkIns: 0 });
    expect((await a.c.post('/api/guests', { firstName: 'No', lastName: 'Id', email: `${uniq('n')}@example.com` })).body.externalId).toBeNull();

    const dup = await a.c.post('/api/guests', { externalId: 'm-0042', firstName: 'X', lastName: 'Y', email: `${uniq('d')}@example.com` });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.issues[0].field).toBe('externalId');
    expect((await a.c.post('/api/guests', { externalId: 'bad id!', firstName: 'X', lastName: 'Y', email: `${uniq('e')}@example.com` })).status).toBe(400);
    // another company may use the same ID
    expect((await b.c.post('/api/guests', { externalId: 'M-0042', firstName: 'Z', lastName: 'Z', email: `${uniq('z')}@example.com` })).status).toBe(201);

    expect((await a.c.get('/api/guests?search=m-00')).body.items.map((x: { externalId: string }) => x.externalId)).toEqual(['M-0042']);
    // editing other fields keeps the ID; it can be changed and cleared
    expect((await a.c.patch(`/api/guests/${g.body.id}`, { phone: '+15550000009' })).body.externalId).toBe('M-0042');
    expect((await a.c.patch(`/api/guests/${g.body.id}`, { externalId: null })).body.externalId).toBeNull();
  });

  it('is found by door search, imported from CSV with duplicate checks, and round-trips through the export', async () => {
    const { c } = await signup(app, 'Gidimp');
    const csv = 'Member No,First Name,Last Name,Email,Notes\nK-1,Ada,Lovelace,ada1@example.com,Front row\nK-2,Alan,Turing,alan1@example.com,\nk-1,Grace,Hopper,grace1@example.com,dup id\n';
    const pre = await c.post('/api/guests/import/preview', { csv });
    expect(pre.body.validRows).toBe(2);
    expect(pre.body.errors).toEqual([{ row: 4, field: 'externalId', message: 'Duplicate guest ID (also on row 2)' }]);
    expect((await c.post('/api/guests/import/commit', { csv, skipInvalid: true })).body.imported).toBe(2);
    // importing K-2 again is refused as an existing ID
    const again = await c.post('/api/guests/import/preview', { csv: 'guest_id,first_name,last_name,email\nK-2,Other,Person,other1@example.com\n' });
    expect(again.body.errors[0]).toMatchObject({ field: 'externalId', message: 'A guest with this ID already exists' });

    const exp = await csvText(c, '/api/guests/export.csv');
    expect(exp.text.split('\r\n')[0]).toBe('﻿guest_id,first_name,last_name,email,phone,company_name,category,notes,passes,check_ins,created_at');
    expect(exp.text).toContain('K-1,Ada,Lovelace,ada1@example.com,,,ATTENDEE,Front row,0,0,');

    const ev = await makeEvent(c);
    await publish(c, ev.id);
    const ada = (await c.get('/api/guests?search=K-1')).body.items[0];
    await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [ada.id] });
    const hits = (await c.get(`/api/checkin/search?eventId=${ev.id}&q=k-1`)).body.items;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ externalId: 'K-1', firstName: 'Ada' });
  });
});

describe('complete report', () => {
  it('per event: every guest field and all linked pass, invitation and check-in data', async () => {
    const { c, email } = await signup(app, 'Full');
    const ev = await makeEvent(c, { venueName: 'Main Hall' });
    await publish(c, ev.id);
    const g = (await c.post('/api/guests', { externalId: 'F-1', firstName: 'Ada', lastName: 'Lovelace', email: `${uniq('f')}@example.com`, phone: '+15550000001', companyName: 'AE', category: 'VIP', notes: 'Wheelchair access' })).body;
    const t = (await c.post(`/api/events/${ev.id}/tickets`, { guestIds: [g.id], send: true })).body.tickets[0];
    const { token } = (await c.get(`/api/tickets/${t.ticketId}/pass`)).body;
    await c.post('/api/checkin', { token, gate: 'Door A' });

    const r = (await c.get(`/api/events/${ev.id}/reports/full`)).body;
    expect(r.columns.map((x: { label: string }) => x.label)).toContain('Notes');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      guestId: 'F-1', firstName: 'Ada', lastName: 'Lovelace', phone: '+15550000001', company: 'AE', category: 'VIP', notes: 'Wheelchair access',
      guestStatus: 'ACTIVE', venue: 'Main Hall', ticketStatus: 'USED', rsvp: 'PENDING', invitation: 'SENT', checkedIn: 'Yes', gate: 'Door A',
      checkinMethod: 'QR', checkedInBy: email,
    });
    expect(r.summary).toMatchObject({ passes: 1, checkedIn: 1 });

    const csv = await csvText(c, `/api/events/${ev.id}/reports/full?format=csv`);
    expect(csv.text).toContain('Guest ID,First name,Last name,Email,Phone,Company,Category,Notes');
    expect(csv.text).toContain('Wheelchair access');
  });

  it('all events: one row per guest per pass, guests without passes included, managers limited to their events', async () => {
    const admin = await signup(app, 'Master');
    const mgr = await addUser(admin.c, app, 'EVENT_MANAGER');
    const evAdmin = await makeEvent(admin.c, { name: uniq('AdminEv'), startDatetime: future(1), endDatetime: future(2) });
    const evMgr = await makeEvent(mgr.c, { name: uniq('MgrEv'), startDatetime: future(3), endDatetime: future(4) });
    const both = (await admin.c.post('/api/guests', { externalId: 'B-1', firstName: 'Both', lastName: 'Events', email: `${uniq('b')}@example.com` })).body;
    await admin.c.post('/api/guests', { firstName: 'No', lastName: 'Pass', email: `${uniq('np')}@example.com`, notes: 'Waitlist' });
    await admin.c.post(`/api/events/${evAdmin.id}/tickets`, { guestIds: [both.id] });
    await mgr.c.post(`/api/events/${evMgr.id}/tickets`, { guestIds: [both.id] });

    const all = await csvText(admin.c, '/api/guests/export-full.csv');
    expect(all.status).toBe(200);
    const lines = all.text.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 3); // header + Both x2 events + No Pass
    expect(lines.filter((l) => l.startsWith('B-1,Both,Events'))).toHaveLength(2);
    expect(lines.some((l) => l.includes('No,Pass') && l.includes('Waitlist'))).toBe(true);

    const mine = await csvText(mgr.c, '/api/guests/export-full.csv');
    const mgrLines = mine.text.trim().split('\r\n');
    expect(mgrLines.some((l) => l.includes(evMgr.id) || l.includes('MgrEv'))).toBe(true);
    expect(mgrLines.some((l) => l.includes('AdminEv'))).toBe(false);

    const staff = await addUser(admin.c, app, 'CHECKIN_STAFF');
    expect((await staff.c.get('/api/guests/export-full.csv')).status).toBe(403);
  });
});
