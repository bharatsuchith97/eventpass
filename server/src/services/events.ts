import { z } from 'zod';
import type { Ctx } from '../context';
import { AppError, conflict, forbidden, notFound, parse, validation } from '../lib/errors';
import { generateEventCode } from '../lib/crypto';
import { audit } from './audit';

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';

const isoDate = z.string().datetime({ offset: true });
const nullableUrl = z.union([z.string().url().max(500).startsWith('https://'), z.literal('')]).nullable();

const baseSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(5000).default(''),
  eventCode: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/, 'Use 3-32 letters, digits, - or _').optional(),
  venueName: z.string().trim().max(150).default(''),
  venueAddress: z.string().trim().max(300).default(''),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  startDatetime: isoDate,
  endDatetime: isoDate,
  capacity: z.number().int().positive().max(1_000_000).nullable().default(null),
  bannerUrl: nullableUrl.default(null),
});
const createSchema = baseSchema.refine((d) => new Date(d.endDatetime) > new Date(d.startDatetime), {
  message: 'End must be after start',
  path: ['endDatetime'],
});
const updateSchema = baseSchema.partial();

const COLS = `e.id, e.name, e.description, e.event_code AS "eventCode", e.venue_name AS "venueName",
  e.venue_address AS "venueAddress", e.latitude, e.longitude, e.start_datetime AS "startDatetime",
  e.end_datetime AS "endDatetime", e.capacity, e.status, e.banner_url AS "bannerUrl",
  e.created_by AS "createdBy", e.created_at AS "createdAt", e.updated_at AS "updatedAt"`;

const COUNTS = `
  (SELECT count(*) FROM tickets t WHERE t.event_id = e.id AND t.status <> 'CANCELLED')::int AS "guestCount",
  (SELECT count(*) FROM checkins c WHERE c.event_id = e.id)::int AS "checkedInCount"`;

/**
 * SQL fragment restricting which events this user may see: always their own company, then by role.
 * Uses parameters $first (company) and, for managers, $first+1 (user).
 */
function visibility(ctx: Ctx, first: number): { sql: string; params: unknown[] } {
  const company = `e.company_id = $${first}`;
  switch (ctx.role) {
    case 'COMPANY_ADMIN':
      return { sql: company, params: [ctx.companyId] };
    case 'EVENT_MANAGER':
      return {
        sql: `${company} AND (e.created_by = $${first + 1} OR EXISTS (SELECT 1 FROM event_managers m WHERE m.event_id = e.id AND m.user_id = $${first + 1}))`,
        params: [ctx.companyId, ctx.userId],
      };
    default:
      return { sql: `${company} AND e.status IN ('PUBLISHED','ONGOING')`, params: [ctx.companyId] };
  }
}

export async function listEvents(ctx: Ctx, q: { status?: string; search?: string }) {
  const params: unknown[] = [];
  const where: string[] = [];
  const vis = visibility(ctx, 1);
  params.push(...vis.params);
  where.push(vis.sql);
  if (q.status) {
    params.push(q.status);
    where.push(`e.status = $${params.length}`);
  }
  if (q.search) {
    params.push(`%${q.search.replace(/[\\%_]/g, '\\$&').toLowerCase()}%`);
    where.push(`lower(e.name) LIKE $${params.length}`);
  }
  const r = await ctx.db.query(
    `SELECT ${COLS}, ${COUNTS} FROM events e WHERE ${where.join(' AND ')} ORDER BY e.start_datetime DESC LIMIT 500`,
    params,
  );
  return r.rows;
}

export async function getEvent(ctx: Ctx, id: string) {
  const vis = visibility(ctx, 2);
  const r = await ctx.db.query(`SELECT ${COLS}, ${COUNTS} FROM events e WHERE e.id = $1 AND ${vis.sql}`, [id, ...vis.params]);
  if (!r.rows[0]) throw notFound('Event');
  return r.rows[0];
}

/**
 * Write-access check: admins any event; managers only events they created or are assigned to.
 * Returns the event's current status.
 */
export async function assertManageEvent(ctx: Ctx, id: string): Promise<{ id: string; status: EventStatus; endDatetime: string; name: string }> {
  const vis = visibility(ctx, 2);
  const r = await ctx.db.query(
    `SELECT e.id, e.status, e.end_datetime AS "endDatetime", e.name FROM events e WHERE e.id = $1 AND ${vis.sql}`,
    [id, ...vis.params],
  );
  if (!r.rows[0]) {
    const exists = await ctx.db.query('SELECT 1 FROM events WHERE id = $1 AND company_id = $2', [id, ctx.companyId]);
    throw exists.rowCount ? forbidden('You are not assigned to this event') : notFound('Event');
  }
  if (ctx.role === 'CHECKIN_STAFF') throw forbidden();
  return r.rows[0];
}

export async function createEvent(ctx: Ctx, input: unknown) {
  const d = parse(createSchema, input);
  if (ctx.limits.maxEvents !== null) {
    const n = await ctx.db.query("SELECT count(*)::int AS n FROM events WHERE company_id = $1 AND status NOT IN ('ARCHIVED','CANCELLED')", [ctx.companyId]);
    if ((n.rows[0]!.n as number) >= ctx.limits.maxEvents) {
      throw new AppError('PLAN_LIMIT', 402, `Your plan allows ${ctx.limits.maxEvents} active events. Archive one or upgrade.`);
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = d.eventCode ?? generateEventCode();
    try {
      const r = await ctx.db.query<{ id: string }>(
        `INSERT INTO events (company_id, name, description, event_code, venue_name, venue_address, latitude, longitude,
            start_datetime, end_datetime, capacity, banner_url, created_by)
         VALUES ($13,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''),$12) RETURNING id`,
        [d.name, d.description, code, d.venueName, d.venueAddress, d.latitude, d.longitude, d.startDatetime, d.endDatetime, d.capacity, d.bannerUrl ?? '', ctx.userId, ctx.companyId],
      );
      const id = r.rows[0]!.id;
      await ctx.db.query('INSERT INTO event_managers (company_id, event_id, user_id) VALUES ($1, $2, $3)', [ctx.companyId, id, ctx.userId]);
      await audit(ctx.db, ctx, 'EVENT_CREATED', 'event', id);
      return getEvent(ctx, id);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        if (d.eventCode) throw conflict('That event code is already in use');
        continue;
      }
      throw e;
    }
  }
  throw new AppError('INTERNAL', 500, 'Could not allocate an event code');
}

export async function updateEvent(ctx: Ctx, id: string, input: unknown) {
  const cur = await assertManageEvent(ctx, id);
  if (['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(cur.status)) throw conflict(`A ${cur.status.toLowerCase()} event cannot be edited`);
  const d = parse(updateSchema.strip(), input);
  const existing = await ctx.db.query<{ s: string; e: string }>(
    'SELECT start_datetime AS s, end_datetime AS e FROM events WHERE id = $1 AND company_id = $2',
    [id, ctx.companyId],
  );
  const start = new Date(d.startDatetime ?? existing.rows[0]!.s);
  const end = new Date(d.endDatetime ?? existing.rows[0]!.e);
  if (end <= start) throw validation('End must be after start', { issues: [{ field: 'endDatetime', message: 'End must be after start' }] });

  const map: Record<string, string> = {
    name: 'name', description: 'description', eventCode: 'event_code', venueName: 'venue_name', venueAddress: 'venue_address',
    latitude: 'latitude', longitude: 'longitude', startDatetime: 'start_datetime', endDatetime: 'end_datetime',
    capacity: 'capacity', bannerUrl: 'banner_url',
  };
  const sets: string[] = [];
  const params: unknown[] = [id, ctx.companyId];
  for (const [k, col] of Object.entries(map)) {
    const v = (d as Record<string, unknown>)[k];
    if (v === undefined) continue;
    params.push(k === 'bannerUrl' && v === '' ? null : v);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length) {
    try {
      await ctx.db.query(`UPDATE events SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND company_id = $2`, params);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('That event code is already in use');
      throw e;
    }
    await audit(ctx.db, ctx, 'EVENT_UPDATED', 'event', id, { fields: Object.keys(d) });
  }
  return getEvent(ctx, id);
}

const TRANSITIONS: Record<string, { from: EventStatus[]; to: EventStatus }> = {
  publish: { from: ['DRAFT'], to: 'PUBLISHED' },
  complete: { from: ['PUBLISHED', 'ONGOING'], to: 'COMPLETED' },
  cancel: { from: ['DRAFT', 'PUBLISHED', 'ONGOING'], to: 'CANCELLED' },
  archive: { from: ['COMPLETED', 'CANCELLED'], to: 'ARCHIVED' },
};

export async function changeEventStatus(ctx: Ctx, id: string, action: string) {
  const t = TRANSITIONS[action];
  if (!t) throw validation('Unknown action');
  const cur = await assertManageEvent(ctx, id);
  if (!t.from.includes(cur.status)) throw conflict(`Cannot ${action} an event that is ${cur.status.toLowerCase()}`);
  await ctx.db.query('UPDATE events SET status = $3, updated_at = now() WHERE id = $1 AND company_id = $2', [id, ctx.companyId, t.to]);
  await audit(ctx.db, ctx, action === 'cancel' ? 'EVENT_CANCELLED' : 'EVENT_STATUS_CHANGED', 'event', id, { from: cur.status, to: t.to });
  return getEvent(ctx, id);
}

export async function duplicateEvent(ctx: Ctx, id: string) {
  await assertManageEvent(ctx, id);
  const e = await getEvent(ctx, id);
  return createEvent(ctx, {
    name: `${e.name} (copy)`,
    description: e.description,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    latitude: e.latitude,
    longitude: e.longitude,
    startDatetime: new Date(e.startDatetime).toISOString(),
    endDatetime: new Date(e.endDatetime).toISOString(),
    capacity: e.capacity,
    bannerUrl: e.bannerUrl,
  });
}

export async function listManagers(ctx: Ctx, id: string) {
  await getEvent(ctx, id);
  const r = await ctx.db.query(
    `SELECT u.id, u.email, u.full_name AS "fullName" FROM event_managers m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = $1 AND m.company_id = $2 ORDER BY u.email`,
    [id, ctx.companyId],
  );
  return r.rows;
}

export async function setManagers(ctx: Ctx, id: string, input: unknown) {
  if (ctx.role !== 'COMPANY_ADMIN') throw forbidden('Only administrators can assign event managers');
  const { userIds } = parse(z.object({ userIds: z.array(z.string().uuid()).max(100) }), input);
  await assertManageEvent(ctx, id);
  const ok = await ctx.db.query<{ id: string }>(
    "SELECT id FROM users WHERE company_id = $2 AND id = ANY($1::uuid[]) AND role IN ('EVENT_MANAGER','COMPANY_ADMIN') AND status = 'ACTIVE'",
    [userIds, ctx.companyId],
  );
  if (ok.rowCount !== new Set(userIds).size) throw validation('Only active managers or administrators can be assigned');
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM event_managers WHERE event_id = $1 AND company_id = $2', [id, ctx.companyId]);
    if (userIds.length) {
      await client.query('INSERT INTO event_managers (company_id, event_id, user_id) SELECT $1, $2, unnest($3::uuid[])', [ctx.companyId, id, userIds]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  await audit(ctx.db, ctx, 'EVENT_UPDATED', 'event', id, { managers: userIds.length });
  return listManagers(ctx, id);
}

export async function eventStats(ctx: Ctx, id: string) {
  await assertViewReports(ctx, id);
  const m = await ctx.db.query(
    `SELECT
       count(*) FILTER (WHERE t.status <> 'CANCELLED')::int AS "totalInvited",
       count(*) FILTER (WHERE t.status <> 'CANCELLED' AND t.rsvp_status = 'CONFIRMED')::int AS "rsvpConfirmed",
       count(*) FILTER (WHERE t.status <> 'CANCELLED' AND t.rsvp_status = 'DECLINED')::int AS "rsvpDeclined",
       count(*) FILTER (WHERE t.status <> 'CANCELLED' AND t.rsvp_status = 'PENDING')::int AS "rsvpPending",
       count(c.id)::int AS "checkedIn"
     FROM tickets t LEFT JOIN checkins c ON c.ticket_id = t.id WHERE t.event_id = $1 AND t.company_id = $2`,
    [id, ctx.companyId],
  );
  const s = m.rows[0]!;
  const [overTime, categories, gates] = await Promise.all([
    ctx.db.query(
      `SELECT date_trunc('hour', checked_in_at) AS bucket, count(*)::int AS count FROM checkins
        WHERE event_id = $1 AND company_id = $2 GROUP BY 1 ORDER BY 1`,
      [id, ctx.companyId],
    ),
    ctx.db.query(
      `SELECT g.category, count(*)::int AS count FROM tickets t JOIN guests g ON g.id = t.guest_id
        WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' GROUP BY 1 ORDER BY 2 DESC`,
      [id, ctx.companyId],
    ),
    ctx.db.query(
      `SELECT COALESCE(NULLIF(gate,''), 'Unassigned') AS gate, count(*)::int AS count FROM checkins
        WHERE event_id = $1 AND company_id = $2 GROUP BY 1 ORDER BY 2 DESC`,
      [id, ctx.companyId],
    ),
  ]);
  const invited = s.totalInvited as number;
  const checked = s.checkedIn as number;
  return {
    ...s,
    notCheckedIn: Math.max(0, invited - checked),
    attendancePct: invited ? Math.round((checked / invited) * 1000) / 10 : 0,
    checkinsOverTime: overTime.rows,
    categories: categories.rows,
    gates: gates.rows,
  };
}

/** Reports/stats are visible to admins and to managers of that event. */
export async function assertViewReports(ctx: Ctx, id: string): Promise<void> {
  if (ctx.role === 'CHECKIN_STAFF') throw forbidden();
  await assertManageEvent(ctx, id);
}
