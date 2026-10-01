import { z } from 'zod';
import type { Ctx } from '../context';
import { AppError, parse } from '../lib/errors';
import { extractToken, sha256Hex } from '../lib/crypto';
import { audit } from './audit';
import { getEvent } from './events';

const gateSchema = z.string().trim().max(60).optional();
const deviceSchema = z.string().trim().max(100).optional();

const scanSchema = z.object({
  token: z.string().min(1).max(600),
  eventId: z.string().uuid().optional(),
  gate: gateSchema,
  deviceId: deviceSchema,
});
const manualSchema = z.object({
  ticketId: z.string().uuid(),
  gate: gateSchema,
  deviceId: deviceSchema,
});

type Lookup = { by: 'token'; hash: string } | { by: 'ticket'; id: string };

interface Guestish {
  firstName: string;
  lastName: string;
  category: string;
  companyName: string | null;
}

function reject(ctx: Ctx, code: ConstructorParameters<typeof AppError>[0], status: number, message: string, ticketId: string | null, extra?: Record<string, unknown>): AppError {
  // Fire-and-forget audit so a slow log write never delays the scanner's red screen.
  void audit(ctx.db, ctx, 'CHECKIN_REJECTED', 'ticket', ticketId, { reason: code }).catch(() => undefined);
  return new AppError(code, status, message, extra);
}

async function performCheckIn(
  ctx: Ctx,
  lookup: Lookup,
  opts: { eventId?: string; gate?: string; deviceId?: string; method: 'QR' | 'MANUAL' },
) {
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    // Row lock: concurrent scans of one ticket serialise here.
    const t = await client.query<{
      id: string;
      event_id: string;
      guest_id: string;
      status: string;
      expires_at: Date;
      ticket_number: string;
      event_status: string;
      event_name: string;
      first_name: string;
      last_name: string;
      category: string;
      company_name: string | null;
    }>(
      `SELECT t.id, t.event_id, t.guest_id, t.status, t.expires_at, t.ticket_number,
              e.status AS event_status, e.name AS event_name,
              g.first_name, g.last_name, g.category, g.company_name
         FROM tickets t JOIN events e ON e.id = t.event_id JOIN guests g ON g.id = t.guest_id
        WHERE ${lookup.by === 'token' ? 't.qr_token_hash = $1' : 't.id = $1'} AND t.company_id = $2
        FOR UPDATE OF t`,
      [lookup.by === 'token' ? lookup.hash : lookup.id, ctx.companyId],
    );
    const row = t.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      throw reject(ctx, 'INVALID_TICKET', 404, 'This ticket is not valid', null);
    }
    const guest: Guestish = { firstName: row.first_name, lastName: row.last_name, category: row.category, companyName: row.company_name };

    if (opts.eventId && row.event_id !== opts.eventId) {
      await client.query('ROLLBACK');
      throw reject(ctx, 'INVALID_TICKET', 404, 'This ticket is for a different event', row.id);
    }
    if (row.status === 'CANCELLED') {
      await client.query('ROLLBACK');
      throw reject(ctx, 'TICKET_CANCELLED', 410, 'This ticket has been cancelled', row.id, { guest });
    }
    if (row.status === 'USED') {
      const c = await client.query<{ checked_in_at: Date; gate: string | null }>(
        'SELECT checked_in_at, gate FROM checkins WHERE ticket_id = $1 AND company_id = $2',
        [row.id, ctx.companyId],
      );
      await client.query('ROLLBACK');
      throw reject(ctx, 'TICKET_ALREADY_USED', 409, 'This ticket has already been checked in', row.id, {
        guest,
        checkedInAt: c.rows[0]?.checked_in_at,
        gate: c.rows[0]?.gate ?? null,
      });
    }
    if (row.status === 'EXPIRED' || row.expires_at.getTime() < Date.now()) {
      await client.query('ROLLBACK');
      throw reject(ctx, 'TICKET_EXPIRED', 410, 'This ticket has expired', row.id, { guest });
    }
    if (!['PUBLISHED', 'ONGOING'].includes(row.event_status)) {
      await client.query('ROLLBACK');
      throw reject(ctx, 'EVENT_NOT_ACTIVE', 409, 'Check-in is not open for this event', row.id, { eventStatus: row.event_status });
    }

    const ins = await client.query<{ id: string; checked_in_at: Date }>(
      `INSERT INTO checkins (company_id, ticket_id, event_id, guest_id, checked_in_by, gate, device_id, method)
       VALUES ($8,$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ticket_id) DO NOTHING RETURNING id, checked_in_at`,
      [row.id, row.event_id, row.guest_id, ctx.userId, opts.gate || null, opts.deviceId || null, opts.method, ctx.companyId],
    );
    if (!ins.rows[0]) {
      await client.query('ROLLBACK');
      throw reject(ctx, 'TICKET_ALREADY_USED', 409, 'This ticket has already been checked in', row.id, { guest });
    }
    await client.query("UPDATE tickets SET status = 'USED' WHERE id = $1 AND company_id = $2", [row.id, ctx.companyId]);
    if (row.event_status === 'PUBLISHED') {
      await client.query("UPDATE events SET status = 'ONGOING', updated_at = now() WHERE id = $1 AND company_id = $2 AND status = 'PUBLISHED'", [row.event_id, ctx.companyId]);
    }
    await audit(client, ctx, 'CHECKIN_CREATED', 'ticket', row.id, { method: opts.method, gate: opts.gate ?? null });
    await client.query('COMMIT');
    return {
      ok: true as const,
      checkinId: ins.rows[0].id,
      checkedInAt: ins.rows[0].checked_in_at,
      ticketNumber: row.ticket_number,
      eventId: row.event_id,
      eventName: row.event_name,
      guest,
    };
  } catch (e) {
    if (!(e instanceof AppError)) await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function scanCheckIn(ctx: Ctx, input: unknown) {
  const d = parse(scanSchema, input);
  const token = extractToken(d.token);
  if (!token) throw reject(ctx, 'INVALID_TICKET', 404, 'This is not an EventPass QR code', null);
  return performCheckIn(ctx, { by: 'token', hash: sha256Hex(token) }, { eventId: d.eventId, gate: d.gate, deviceId: d.deviceId, method: 'QR' });
}

export async function manualCheckIn(ctx: Ctx, input: unknown) {
  const d = parse(manualSchema, input);
  return performCheckIn(ctx, { by: 'ticket', id: d.ticketId }, { gate: d.gate, deviceId: d.deviceId, method: 'MANUAL' });
}

const maskEmail = (e: string) => {
  const [u = '', d = ''] = e.split('@');
  return `${u.slice(0, 1)}***@${d}`;
};

/** Door-side lookup by name / email / ticket number. Returns minimal PII (masked email). */
export async function searchForCheckin(ctx: Ctx, eventId: string, q: string) {
  await getEvent(ctx, eventId); // visibility check
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const p = `${term.replace(/[\\%_]/g, '\\$&')}%`;
  const r = await ctx.db.query(
    `SELECT t.id AS "ticketId", t.ticket_number AS "ticketNumber", t.status, g.first_name AS "firstName", g.last_name AS "lastName",
            g.email, g.category, g.company_name AS "companyName", c.checked_in_at AS "checkedInAt"
       FROM tickets t JOIN guests g ON g.id = t.guest_id LEFT JOIN checkins c ON c.ticket_id = t.id
      WHERE t.event_id = $1 AND t.company_id = $3 AND t.status <> 'CANCELLED' AND g.status = 'ACTIVE'
        AND (lower(g.first_name) LIKE $2 OR lower(g.last_name) LIKE $2 OR lower(g.email) LIKE $2
             OR lower(g.first_name || ' ' || g.last_name) LIKE $2 OR lower(t.ticket_number) LIKE $2)
      ORDER BY lower(g.last_name), lower(g.first_name) LIMIT 20`,
    [eventId, p, ctx.companyId],
  );
  return r.rows.map((row) => ({ ...row, email: maskEmail(row.email as string) }));
}

export async function listCheckins(ctx: Ctx, eventId: string, query: { page: number; pageSize: number }) {
  await getEvent(ctx, eventId);
  const r = await ctx.db.query(
    `SELECT c.id, c.checked_in_at AS "checkedInAt", c.gate, c.method, g.first_name AS "firstName", g.last_name AS "lastName",
            g.category, t.ticket_number AS "ticketNumber", u.email AS "checkedInBy", count(*) OVER()::int AS total
       FROM checkins c JOIN tickets t ON t.id = c.ticket_id JOIN guests g ON g.id = c.guest_id JOIN users u ON u.id = c.checked_in_by
      WHERE c.event_id = $1 AND c.company_id = $4 ORDER BY c.checked_in_at DESC LIMIT $2 OFFSET $3`,
    [eventId, query.pageSize, (query.page - 1) * query.pageSize, ctx.companyId],
  );
  return { items: r.rows.map(({ total: _t, ...row }) => row), total: (r.rows[0]?.total as number | undefined) ?? 0 };
}
