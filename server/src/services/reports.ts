import type { Ctx } from '../context';
import { toCsv } from '../lib/csv';
import { validation } from '../lib/errors';
import { assertViewReports } from './events';

export const REPORT_KINDS = ['attendance', 'noshow', 'rsvp'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface Report {
  kind: ReportKind;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | Date | null>[];
  summary?: Record<string, number>;
}

const name = `g.first_name || ' ' || g.last_name`;

export async function buildReport(ctx: Ctx, eventId: string, kind: string): Promise<Report> {
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) throw validation('Unknown report');
  await assertViewReports(ctx, eventId);
  if (kind === 'attendance') {
    const r = await ctx.db.query(
      `SELECT ${name} AS guest, g.company_name AS company, g.category, t.ticket_number AS ticket, t.rsvp_status AS rsvp,
              CASE WHEN c.id IS NULL THEN 'Not checked in' ELSE 'Checked in' END AS status,
              c.checked_in_at AS "checkedInAt", c.gate
         FROM tickets t JOIN guests g ON g.id = t.guest_id LEFT JOIN checkins c ON c.ticket_id = t.id
        WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' ORDER BY lower(g.last_name), lower(g.first_name)`,
      [eventId, ctx.companyId],
    );
    return {
      kind,
      columns: [
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
      `SELECT ${name} AS guest, g.email, g.company_name AS company, g.category, t.ticket_number AS ticket, t.rsvp_status AS rsvp
         FROM tickets t JOIN guests g ON g.id = t.guest_id LEFT JOIN checkins c ON c.ticket_id = t.id
        WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' AND c.id IS NULL ORDER BY lower(g.last_name), lower(g.first_name)`,
      [eventId, ctx.companyId],
    );
    return {
      kind,
      columns: [
        { key: 'guest', label: 'Guest' },
        { key: 'email', label: 'Email' },
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
    `SELECT ${name} AS guest, g.email, t.rsvp_status AS rsvp, t.rsvp_at AS "rsvpAt"
       FROM tickets t JOIN guests g ON g.id = t.guest_id
      WHERE t.event_id = $1 AND t.company_id = $2 AND t.status <> 'CANCELLED' ORDER BY t.rsvp_status, lower(g.last_name)`,
    [eventId, ctx.companyId],
  );
  const count = (s: string) => r.rows.filter((x) => x.rsvp === s).length;
  return {
    kind: 'rsvp',
    columns: [
      { key: 'guest', label: 'Guest' },
      { key: 'email', label: 'Email' },
      { key: 'rsvp', label: 'RSVP' },
      { key: 'rsvpAt', label: 'Responded at' },
    ],
    rows: r.rows,
    summary: { confirmed: count('CONFIRMED'), declined: count('DECLINED'), pending: count('PENDING') },
  };
}

export function reportToCsv(report: Report): string {
  return toCsv(
    report.columns.map((c) => c.label),
    report.rows.map((row) => report.columns.map((c) => row[c.key] as string | number | Date | null)),
  );
}
