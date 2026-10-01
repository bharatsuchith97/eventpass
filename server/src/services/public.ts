import { z } from 'zod';
import { pool } from '../db/pools';
import { isWellFormedToken, sha256Hex } from '../lib/crypto';
import { conflict, notFound, parse } from '../lib/errors';
import { logoPath } from './settings';

/**
 * Unauthenticated guest-facing pass. The company is resolved from the slug in the emailed link (the QR itself
 * carries only the random token), and every lookup below is limited to that company.
 * Responses expose the minimum needed to show a pass.
 */
async function resolve(slug: string, token: string): Promise<string> {
  if (!isWellFormedToken(token) || !/^[a-z0-9-]{1,60}$/.test(slug)) throw notFound('Pass');
  const c = await pool().query<{ id: string }>("SELECT id FROM companies WHERE slug = $1 AND status = 'ACTIVE'", [slug]);
  if (!c.rows[0]) throw notFound('Pass');
  return c.rows[0].id;
}

export async function getPublicPass(slug: string, token: string) {
  const companyId = await resolve(slug, token);
  const db = pool();
  const r = await db.query(
    `SELECT t.id AS "ticketId", t.ticket_number AS "ticketNumber", t.status, t.rsvp_status AS "rsvpStatus",
            e.name AS "eventName", e.start_datetime AS "startDatetime", e.end_datetime AS "endDatetime",
            e.venue_name AS "venueName", e.venue_address AS "venueAddress", e.status AS "eventStatus",
            g.first_name AS "firstName", g.last_name AS "lastName", g.category,
            s.company_name AS "companyName", s.primary_brand_color AS "brandColor",
            CASE WHEN s.logo_data IS NULL THEN NULL ELSE s.logo_updated_at END AS "logoUpdatedAt"
       FROM tickets t JOIN events e ON e.id = t.event_id JOIN guests g ON g.id = t.guest_id
       JOIN company_settings s ON s.company_id = t.company_id
      WHERE t.qr_token_hash = $1 AND t.company_id = $2`,
    [sha256Hex(token), companyId],
  );
  const row = r.rows[0];
  if (!row) throw notFound('Pass');
  await db.query(
    `UPDATE invitations SET opened_at = COALESCE(opened_at, now()), clicked_at = COALESCE(clicked_at, now()),
            delivery_status = 'OPENED' WHERE ticket_id = $1 AND company_id = $2 AND sent`,
    [row.ticketId, companyId],
  );
  const { ticketId: _id, logoUpdatedAt, ...pass } = row;
  return { ...pass, logoUrl: logoUpdatedAt ? logoPath(slug, logoUpdatedAt as Date) : null };
}

export async function publicRsvp(slug: string, token: string, input: unknown) {
  const { response } = parse(z.object({ response: z.enum(['CONFIRMED', 'DECLINED']) }), input);
  const companyId = await resolve(slug, token);
  const db = pool();
  const r = await db.query(
    `UPDATE tickets t SET rsvp_status = $2, rsvp_at = now() FROM events e
      WHERE e.id = t.event_id AND t.qr_token_hash = $1 AND t.company_id = $3
        AND t.status IN ('ACTIVE') AND e.status IN ('PUBLISHED','ONGOING')
      RETURNING t.rsvp_status AS "rsvpStatus"`,
    [sha256Hex(token), response, companyId],
  );
  if (!r.rows[0]) {
    const exists = await db.query('SELECT 1 FROM tickets WHERE qr_token_hash = $1 AND company_id = $2', [sha256Hex(token), companyId]);
    if (!exists.rowCount) throw notFound('Pass');
    throw conflict('RSVP is closed for this pass');
  }
  return r.rows[0] as { rsvpStatus: string };
}

