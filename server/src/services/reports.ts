import type { Ctx } from '../context';
import { toCsv } from '../lib/csv';
import { validation } from '../lib/errors';
import { audit } from './audit';
import { assertViewReports } from './events';

export const REPORT_KINDS = ['full', 'attendance', 'noshow', 'rsvp'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface Report {
  kind: ReportKind;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | Date | null>[];
  summary?: Record<string, number>;
}

const name = `g.first_name || ' ' || g.last_name`;

// ---- Complete report: one row per guest per pass, with every guest field and all linked data ----------

/** Columns of the complete report, in spreadsheet order. */
export const FULL_COLUMNS: { key: string; label: string }[] = [
  { key: 'guestId', label: 'Guest ID' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'category', label: 'Category' },
  { key: 'notes', label: 'Notes' },
  { key: 'guestStatus', label: 'Guest status' },
  { key: 'guestAdded', label: 'Guest added' },
  { key: 'event', label: 'Event' },
  { key: 'eventCode', label: 'Event code' },
  { key: 'eventStart', label: 'Event start' },
  { key: 'venue', label: 'Venue' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'ticketStatus', label: 'Ticket status' },
  { key: 'issuedAt', label: 'Pass issued' },
  { key: 'rsvp', label: 'RSVP' },
  { key: 'rsvpAt', label: 'RSVP at' },
  { key: 'invitation', label: 'Invitation' },
  { key: 'invitedAt', label: 'Invitation sent' },
  { key: 'openedAt', label: 'Invitation opened' },
  { key: 'checkedIn', label: 'Checked in' },
  { key: 'checkedInAt', label: 'Check-in time' },
  { key: 'gate', label: 'Gate' },
  { key: 'checkinMethod', label: 'Check-in method' },
  { key: 'checkedInBy', label: 'Checked in by' },
];

const FULL_SELECT = `
  g.external_id AS "guestId", g.first_name AS "firstName", g.last_name AS "lastName", g.email, g.phone,
  g.company_name AS company, g.category, g.notes, g.status AS "guestStatus", g.created_at AS "guestAdded",
  e.name AS event, e.event_code AS "eventCode", e.start_datetime AS "eventStart",
  NULLIF(concat_ws(', ', NULLIF(e.venue_name, ''), NULLIF(e.venue_address, '')), '') AS venue,
  t.ticket_number AS ticket, t.status AS "ticketStatus", t.issued_at AS "issuedAt",
  t.rsvp_status AS rsvp, t.rsvp_at AS "rsvpAt",
  inv.delivery_status AS invitation, inv.sent_at AS "invitedAt", inv.opened_at AS "openedAt",
  CASE WHEN t.id IS NULL THEN NULL WHEN c.id IS NULL THEN 'No' ELSE 'Yes' END AS "checkedIn",
  c.checked_in_at AS "checkedInAt", c.gate, c.method AS "checkinMethod", cu.email AS "checkedInBy"`;

const FULL_LINKED_JOINS = `
  LEFT JOIN checkins c ON c.ticket_id = t.id
  LEFT JOIN users cu ON cu.id = c.checked_in_by
  LEFT JOIN LATERAL (SELECT i.delivery_status, i.sent_at, i.opened_at FROM invitations i
                      WHERE i.ticket_id = t.id ORDER BY i.created_at DESC LIMIT 1) inv ON true`;

async function fullRowsForEvent(ctx: Ctx, eventId: string) {
  const r = await ctx.db.query(
    `SELECT ${FULL_SELECT}
       FROM tickets t JOIN events e ON e.id = t.event_id JOIN guests g ON g.id = t.guest_id
       ${FULL_LINKED_JOINS}
      WHERE t.event_id = $1 AND t.company_id = $2
      ORDER BY lower(g.last_name), lower(g.first_name), t.issued_at`,
    [eventId, ctx.companyId],
  );
  return r.rows;
}

/**
 * Every guest of the company with every pass they hold, across all events the user may see: the one spreadsheet
 * with everything. Guests without passes get one row with empty event columns. Event managers only see passes for
 * events they created or manage.
 */
export async function fullExportCsv(ctx: Ctx): Promise<string> {
  const params: unknown[] = [ctx.companyId];
  let visible = 'TRUE';
  if (ctx.role === 'EVENT_MANAGER') {
    params.push(ctx.userId);
    visible = `(e.created_by = $2 OR EXISTS (SELECT 1 FROM event_managers m WHERE m.event_id = e.id AND m.user_id = $2))`;
  }
  const r = await ctx.db.query(
    `SELECT ${FULL_SELECT}
       FROM guests g
       LEFT JOIN (tickets t JOIN events e ON e.id = t.event_id AND ${visible}) ON t.guest_id = g.id
       ${FULL_LINKED_JOINS}
      WHERE g.company_id = $1 AND (g.status = 'ACTIVE' OR t.id IS NOT NULL)
      ORDER BY lower(g.last_name), lower(g.first_name), e.start_datetime NULLS LAST, t.issued_at`,
    params,
  );
  await audit(ctx.db, ctx, 'GUEST_EXPORTED', 'guest', null, { kind: 'full', rows: r.rowCount });
  return reportToCsv({ columns: FULL_COLUMNS, rows: r.rows });
}

// ---- Per-event reports ---------------------------------------------------------------------------

export async function buildReport(ctx: Ctx, eventId: string, kind: string): Promise<Report> {
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) throw validation('Unknown report');
  await assertViewReports(ctx, eventId);
  if (kind === 'full') {
    const rows = await fullRowsForEvent(ctx, eventId);
    const count = (k: string, v: string) => rows.filter((x) => x[k] === v).length;
    return {
      kind,
      columns: FULL_COLUMNS,
      rows,
      summary: { passes: rows.length, checkedIn: count('checkedIn', 'Yes'), confirmed: count('rsvp', 'CONFIRMED'), declined: count('rsvp', 'DECLINED') },
    };
  }
  if (kind === 'attendance') {
    const r = await ctx.db.query(
      `SELECT g.external_id AS "guestId", ${name} AS guest, g.company_name AS company, g.category, t.ticket_number AS ticket, t.rsvp_status AS rsvp,
              CASE WHEN c.id IS NULL THEN 'Not checked in' ELSE 'Checked in' END AS status,
              c.checked_in_at AS "checkedInAt", c.gate
         FROM tickets t JOIN guests g ON g.id = t.guest_id LEFT JOIN checkins c ON c.ticket_id = t.id
        WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' ORDER BY lower(g.last_name), lower(g.first_name)`,
      [eventId, ctx.companyId],
    );
    return {
      kind,
      columns: [
        { key: 'guestId', label: 'Guest ID' },
        { key: 'guest', label: 'Guest' },
        { key: 'company', label: 'Company' },
        { key: 'category', label: 'Category' },
        { key: 'ticket', label: 'Ticket' },
        { key: 'rsvp', label: 'RSVP' },
        { key: 'status', label: 'Check-in status' },
        { key: 'checkedInAt', label: 'Check-in time' },
        { key: 'gate', label: 'Gate' },
      ],
      rows: r.rows,
    };
  }
  if (kind === 'noshow') {
    const r = await ctx.db.query(
      `SELECT g.external_id AS "guestId", ${name} AS guest, g.email, g.phone, g.company_name AS company, g.category, t.ticket_number AS ticket, t.rsvp_status AS rsvp
         FROM tickets t JOIN guests g ON g.id = t.guest_id LEFT JOIN checkins c ON c.ticket_id = t.id
        WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' AND c.id IS NULL ORDER BY lower(g.last_name), lower(g.first_name)`,
      [eventId, ctx.companyId],
    );
    return {
      kind,
      columns: [
        { key: 'guestId', label: 'Guest ID' },
        { key: 'guest', label: 'Guest' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'company', label: 'Company' },
        { key: 'category', label: 'Category' },
        { key: 'ticket', label: 'Ticket' },
        { key: 'rsvp', label: 'RSVP' },
      ],
      rows: r.rows,
      summary: { noShows: r.rowCount ?? 0 },
    };
  }
  const r = await ctx.db.query(
    `SELECT g.external_id AS "guestId", ${name} AS guest, g.email, g.phone, t.ticket_number AS ticket, t.rsvp_status AS rsvp, t.rsvp_at AS "rsvpAt"
       FROM tickets t JOIN guests g ON g.id = t.guest_id
      WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' ORDER BY t.rsvp_status, lower(g.last_name)`,
    [eventId, ctx.companyId],
  );
  const count = (s: string) => r.rows.filter((x) => x.rsvp === s).length;
  return {
    kind: 'rsvp',
    columns: [
      { key: 'guestId', label: 'Guest ID' },
      { key: 'guest', label: 'Guest' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'ticket', label: 'Ticket' },
      { key: 'rsvp', label: 'RSVP' },
      { key: 'rsvpAt', label: 'Responded at' },
    ],
    rows: r.rows,
    summary: { confirmed: count('CONFIRMED'), declined: count('DECLINED'), pending: count('PENDING') },
  };
}

export function reportToCsv(report: Pick<Report, 'columns' | 'rows'>): string {
  return toCsv(
    report.columns.map((c) => c.label),
    report.rows.map((row) => report.columns.map((c) => row[c.key] as string | number | Date | null)),
  );
}
