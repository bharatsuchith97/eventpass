import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config';
import type { Ctx } from '../context';
import { AppError, conflict, notFound, parse, validation } from '../lib/errors';
import { generateQrToken, generateTicketNumber, sha256Hex } from '../lib/crypto';
import { decryptPassToken, encryptPassToken } from '../lib/passTokens';
import { audit } from './audit';
import { assertManageEvent } from './events';
import { escapeHtml, sendMail } from './mailer';
import { loadLogo, type Logo } from './settings';

export const checkinUrl = (token: string) => `${config().APP_URL}/checkin/${token}`;
export const passUrl = (slug: string, token: string) => `${config().APP_URL}/pass/${slug}/${token}`;

const closedStatuses = ['COMPLETED', 'CANCELLED', 'ARCHIVED'];

const issueSchema = z
  .object({
    guestIds: z.array(z.string().uuid()).max(5000).optional(),
    allGuests: z.boolean().optional(),
    send: z.boolean().default(false),
  })
  .refine((d) => d.guestIds?.length || d.allGuests, { message: 'Choose guests or "all guests"' });

interface Issued {
  ticketId: string;
  guestId: string;
  token: string;
}

export async function issueTickets(ctx: Ctx, eventId: string, input: unknown) {
  const d = parse(issueSchema, input);
  const ev = await assertManageEvent(ctx, eventId);
  if (closedStatuses.includes(ev.status)) throw conflict(`Cannot issue passes for a ${ev.status.toLowerCase()} event`);

  const candidates = await ctx.db.query<{ id: string }>(
    `SELECT g.id FROM guests g
      WHERE g.company_id = $4 AND g.status = 'ACTIVE' AND ($1::boolean OR g.id = ANY($2::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.guest_id = g.id AND t.event_id = $3 AND t.status <> 'CANCELLED')`,
    [d.allGuests ?? false, d.guestIds ?? [], eventId, ctx.companyId],
  );
  if (d.guestIds && !d.allGuests) {
    const found = await ctx.db.query("SELECT 1 FROM guests WHERE company_id = $2 AND id = ANY($1::uuid[]) AND status = 'ACTIVE'", [d.guestIds, ctx.companyId]);
    if (found.rowCount !== new Set(d.guestIds).size) throw notFound('Guest');
  }
  const guestIds = candidates.rows.map((r) => r.id);
  if (guestIds.length === 0) return { issued: 0, invited: 0, failed: 0, tickets: [] as { ticketId: string; guestId: string }[] };

  if (ctx.limits.maxGuestsPerEvent !== null) {
    const n = await ctx.db.query("SELECT count(*)::int AS n FROM tickets WHERE company_id = $2 AND event_id = $1 AND status <> 'CANCELLED'", [eventId, ctx.companyId]);
    if ((n.rows[0]!.n as number) + guestIds.length > ctx.limits.maxGuestsPerEvent) {
      throw new AppError('PLAN_LIMIT', 402, `Your plan allows ${ctx.limits.maxGuestsPerEvent} guests per event.`);
    }
  }

  let issued: Issued[] = [];
  for (let attempt = 0; ; attempt++) {
    const tokens = guestIds.map(() => generateQrToken());
    try {
      const r = await ctx.db.query<{ id: string; guest_id: string; qr_token_hash: string }>(
        `INSERT INTO tickets (company_id, event_id, guest_id, ticket_number, qr_token_hash, qr_token_enc, expires_at)
         SELECT $6::uuid, $1, g, n, h, x.enc, $5 FROM unnest($2::uuid[], $3::text[], $4::text[], $7::text[]) AS x(g, n, h, enc)
         ON CONFLICT (event_id, guest_id) WHERE status <> 'CANCELLED' DO NOTHING
         RETURNING id, guest_id, qr_token_hash`,
        [eventId, guestIds, guestIds.map(generateTicketNumber), tokens.map(sha256Hex), ev.endDatetime, ctx.companyId, tokens.map(encryptPassToken)],
      );
      const byHash = new Map(tokens.map((t) => [sha256Hex(t), t]));
      issued = r.rows.map((row) => ({ ticketId: row.id, guestId: row.guest_id, token: byHash.get(row.qr_token_hash)! }));
      break;
    } catch (e) {
      if ((e as { code?: string }).code === '23505' && attempt < 3) continue; // ticket number collision: retry with fresh numbers
      throw e;
    }
  }
  await audit(ctx.db, ctx, 'TICKET_GENERATED', 'event', eventId, { count: issued.length });

  let invited = 0;
  if (d.send && issued.length) invited = await deliverInvitations(ctx, eventId, issued);
  const failed = d.send ? issued.length - invited : 0; // emails the mail server refused; the passes still exist
  return { issued: issued.length, invited, failed, tickets: issued.map(({ ticketId, guestId }) => ({ ticketId, guestId })) };
}

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'CANCELLED', 'EXPIRED', 'USED']).optional(),
  rsvp: z.enum(['PENDING', 'CONFIRMED', 'DECLINED']).optional(),
  checkedIn: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listEventTickets(ctx: Ctx, eventId: string, query: unknown) {
  const q = parse(listSchema, query);
  await assertManageEvent(ctx, eventId);
  const params: unknown[] = [eventId, ctx.companyId];
  const where = ['t.event_id = $1', 't.company_id = $2'];
  if (q.status) {
    params.push(q.status);
    where.push(`t.status = $${params.length}`);
  } else where.push("t.status <> 'CANCELLED'");
  if (q.rsvp) {
    params.push(q.rsvp);
    where.push(`t.rsvp_status = $${params.length}`);
  }
  if (q.checkedIn) where.push(q.checkedIn === 'yes' ? 'c.id IS NOT NULL' : 'c.id IS NULL');
  if (q.search) {
    params.push(`${q.search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
    const p = `$${params.length}`;
    where.push(`(lower(g.first_name) LIKE ${p} OR lower(g.last_name) LIKE ${p} OR lower(g.email) LIKE ${p} OR lower(g.first_name || ' ' || g.last_name) LIKE ${p} OR lower(t.ticket_number) LIKE ${p})`);
  }
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const r = await ctx.db.query(
    `SELECT t.id, t.ticket_number AS "ticketNumber", t.status, t.rsvp_status AS "rsvpStatus", t.issued_at AS "issuedAt",
            g.id AS "guestId", g.first_name AS "firstName", g.last_name AS "lastName", g.email, g.company_name AS "companyName", g.category,
            c.checked_in_at AS "checkedInAt", c.gate,
            (SELECT i.delivery_status FROM invitations i WHERE i.ticket_id = t.id ORDER BY i.created_at DESC LIMIT 1) AS "invitationStatus",
            count(*) OVER()::int AS total
       FROM tickets t JOIN guests g ON g.id = t.guest_id LEFT JOIN checkins c ON c.ticket_id = t.id
      WHERE ${where.join(' AND ')}
      ORDER BY lower(g.last_name), lower(g.first_name) LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows.map(({ total: _t, ...row }) => row), total: (r.rows[0]?.total as number | undefined) ?? 0 };
}

async function loadTicketForManage(ctx: Ctx, ticketId: string) {
  const r = await ctx.db.query<{ id: string; event_id: string; status: string; ticket_number: string; guest_id: string; qr_token_enc: string | null }>(
    'SELECT id, event_id, status, ticket_number, guest_id, qr_token_enc FROM tickets WHERE id = $1 AND company_id = $2',
    [ticketId, ctx.companyId],
  );
  const t = r.rows[0];
  if (!t) throw notFound('Ticket');
  await assertManageEvent(ctx, t.event_id);
  return t;
}

export async function cancelTicket(ctx: Ctx, ticketId: string) {
  const t = await loadTicketForManage(ctx, ticketId);
  if (t.status === 'USED') throw conflict('This ticket has already been used');
  await ctx.db.query("UPDATE tickets SET status = 'CANCELLED' WHERE id = $1 AND company_id = $2 AND status <> 'USED'", [ticketId, ctx.companyId]);
  await audit(ctx.db, ctx, 'TICKET_CANCELLED', 'ticket', ticketId);
  return { id: ticketId, status: 'CANCELLED' };
}

/** Rotates the QR token: the previous QR stops working immediately. Returns the new raw token once. */
/** Gives the ticket a brand-new QR token: every earlier QR, PDF and emailed link for it stops working. */
async function rotateToken(ctx: Ctx, ticketId: string): Promise<string> {
  const token = generateQrToken();
  const r = await ctx.db.query(
    "UPDATE tickets SET qr_token_hash = $2, qr_token_enc = $4 WHERE id = $1 AND company_id = $3 AND status = 'ACTIVE'",
    [ticketId, sha256Hex(token), ctx.companyId, encryptPassToken(token)],
  );
  if (!r.rowCount) throw conflict('Only active tickets can be shown or sent');
  return token;
}

/**
 * The ticket's existing QR token, so showing, downloading or re-sending a pass never changes it.
 * Tickets without a readable stored token (issued before tokens were kept, or after a JWT_SECRET change) get one now.
 */
async function currentToken(ctx: Ctx, ticketId: string, stored: string | null): Promise<string> {
  return decryptPassToken(stored) ?? rotateToken(ctx, ticketId);
}

const passResponse = (ctx: Ctx, ticketId: string, ticketNumber: string, token: string) => ({
  ticketId,
  ticketNumber,
  token,
  qrValue: checkinUrl(token),
  passUrl: passUrl(ctx.companySlug, token),
});

/** Show the guest's current pass (same QR as in their email). */
export async function getTicketPass(ctx: Ctx, ticketId: string) {
  const t = await loadTicketForManage(ctx, ticketId);
  if (t.status !== 'ACTIVE') throw conflict('Only active tickets can be shown or sent');
  const token = await currentToken(ctx, ticketId, t.qr_token_enc);
  return passResponse(ctx, ticketId, t.ticket_number, token);
}

/** Issue a new QR on purpose (lost or leaked pass). The previous QR stops working immediately. */
export async function reissueTicket(ctx: Ctx, ticketId: string) {
  const t = await loadTicketForManage(ctx, ticketId);
  const token = await rotateToken(ctx, ticketId);
  await audit(ctx.db, ctx, 'TICKET_REISSUED', 'ticket', ticketId);
  return passResponse(ctx, ticketId, t.ticket_number, token);
}

interface PassData {
  eventName: string;
  venue: string;
  start: Date;
  firstName: string;
  lastName: string;
  category: string;
  ticketNumber: string;
  companyName: string;
}

async function loadPassData(ctx: Ctx, ticketId: string): Promise<PassData> {
  const r = await ctx.db.query(
    `SELECT e.name AS "eventName", concat_ws(', ', NULLIF(e.venue_name,''), NULLIF(e.venue_address,'')) AS venue, e.start_datetime AS start,
            g.first_name AS "firstName", g.last_name AS "lastName", g.category, t.ticket_number AS "ticketNumber",
            s.company_name AS "companyName"
       FROM tickets t JOIN events e ON e.id = t.event_id JOIN guests g ON g.id = t.guest_id
       JOIN company_settings s ON s.company_id = t.company_id
      WHERE t.id = $1 AND t.company_id = $2`,
    [ticketId, ctx.companyId],
  );
  if (!r.rows[0]) throw notFound('Ticket');
  return r.rows[0] as PassData;
}

export async function renderPassPdf(p: PassData, token: string, logo: Logo | null = null): Promise<Buffer> {
  const qr = await QRCode.toBuffer(checkinUrl(token), { errorCorrectionLevel: 'M', margin: 1, width: 400 });
  const doc = new PDFDocument({ size: [320, logo ? 560 : 520], margin: 24 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  if (logo) {
    try {
      // Company logo, centred at the top, scaled to fit a 160 x 52 box.
      doc.image(logo.data, (320 - 160) / 2, 24, { fit: [160, 52], align: 'center', valign: 'center' });
      doc.y = 24 + 52 + 10;
    } catch {
      /* unreadable image: the pass is still valid without it */
    }
  }
  doc.fontSize(9).fillColor('#666').text(p.companyName.toUpperCase(), { align: 'center' });
  doc.moveDown(0.5).fontSize(18).fillColor('#111').text(p.eventName, { align: 'center' });
  doc.moveDown(0.3).fontSize(10).fillColor('#444').text(p.start.toUTCString().replace(' GMT', ' UTC'), { align: 'center' });
  if (p.venue) doc.text(p.venue, { align: 'center' });
  doc.moveDown(1).image(qr, (320 - 200) / 2, doc.y, { width: 200 });
  doc.y += 210;
  doc.fontSize(16).fillColor('#111').text(`${p.firstName} ${p.lastName}`, { align: 'center' });
  doc.fontSize(10).fillColor('#444').text(`${p.category}  |  ${p.ticketNumber}`, { align: 'center' });
  doc.moveDown(1).fontSize(8).fillColor('#888').text('Present this QR code at the entrance. One entry per pass.', { align: 'center' });
  doc.end();
  return done;
}

/** Renders the PDF pass with the ticket's current QR (the same one as on screen and in the email). */
export async function ticketPassPdf(ctx: Ctx, ticketId: string) {
  const t = await loadTicketForManage(ctx, ticketId);
  if (t.status !== 'ACTIVE') throw conflict('Only active tickets can be shown or sent');
  const token = await currentToken(ctx, ticketId, t.qr_token_enc);
  const pdf = await renderPassPdf(await loadPassData(ctx, ticketId), token, await loadLogo(ctx.db, ctx.companyId));
  return { pdf, filename: `pass-${t.ticket_number}.pdf` };
}

// ---- Invitations ---------------------------------------------------------

async function deliverInvitations(ctx: Ctx, eventId: string, items: Issued[]): Promise<number> {
  const info = await ctx.db.query(
    `SELECT t.id AS "ticketId", g.id AS "guestId", g.first_name AS "firstName", g.email, t.ticket_number AS "ticketNumber",
            e.name AS "eventName", e.start_datetime AS start, concat_ws(', ', NULLIF(e.venue_name,''), NULLIF(e.venue_address,'')) AS venue,
            s.company_name AS "companyName"
       FROM tickets t JOIN guests g ON g.id = t.guest_id JOIN events e ON e.id = t.event_id
       JOIN company_settings s ON s.company_id = t.company_id
      WHERE t.company_id = $2 AND t.id = ANY($1::uuid[])`,
    [items.map((i) => i.ticketId), ctx.companyId],
  );
  const tokens = new Map(items.map((i) => [i.ticketId, i.token]));
  const logo = await loadLogo(ctx.db, ctx.companyId);
  const logoAttachment = logo ? [{ filename: logo.mime === 'image/png' ? 'logo.png' : 'logo.jpg', content: logo.data, cid: 'logo', contentType: logo.mime }] : [];
  const logoHtml = logo ? '<p style="text-align:center;margin:0 0 16px"><img src="cid:logo" alt="" style="max-height:64px;max-width:220px"></p>' : '';
  let sent = 0;
  const queue = [...info.rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const token = tokens.get(row.ticketId as string)!;
      const link = passUrl(ctx.companySlug, token);
      let ok = true;
      try {
        const qr = await QRCode.toBuffer(checkinUrl(token), { margin: 1, width: 300 });
        await sendMail({
          to: row.email as string,
          subject: `Your pass for ${row.eventName as string}`,
          text: `Hi ${row.firstName as string},\n\nYou are invited to ${row.eventName as string}.\n${(row.start as Date).toUTCString()}\n${row.venue as string}\n\nYour pass (ticket ${row.ticketNumber as string}): ${link}\nShow the QR code at the entrance.\n`,
          html: `${logoHtml}<p>Hi ${escapeHtml(row.firstName as string)},</p><p>You are invited to <b>${escapeHtml(row.eventName as string)}</b>.<br>${escapeHtml((row.start as Date).toUTCString())}<br>${escapeHtml(row.venue as string)}</p>
<p><img src="cid:qr" width="200" height="200" alt="Your QR pass"></p>
<p>Ticket <b>${escapeHtml(row.ticketNumber as string)}</b> - <a href="${escapeHtml(link)}">open your pass and RSVP</a></p>`,
          attachments: [{ filename: 'qr.png', content: qr, cid: 'qr', contentType: 'image/png' }, ...logoAttachment],
        });
        sent++;
      } catch (e) {
        ok = false;
        if (config().LOG_LEVEL !== 'silent') console.error(`[mail] invitation for ticket ${row.ticketNumber as string} failed: ${(e as Error).message}`);
      }
      await ctx.db.query(
        `INSERT INTO invitations (company_id, ticket_id, guest_id, event_id, sent, sent_at, delivery_status) VALUES ($7,$1,$2,$3,$4,$5,$6)`,
        [row.ticketId, row.guestId, eventId, ok, ok ? new Date() : null, ok ? 'SENT' : 'FAILED', ctx.companyId],
      );
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await audit(ctx.db, ctx, 'INVITATION_SENT', 'event', eventId, { sent, failed: items.length - sent });
  return sent;
}

const sendSchema = z.object({
  ticketIds: z.array(z.string().uuid()).max(5000).optional(),
  pendingOnly: z.boolean().default(false),
});

/** (Re)sends invitations with each ticket's current QR, so a guest's earlier email keeps working. */
export async function sendInvitations(ctx: Ctx, eventId: string, input: unknown) {
  const d = parse(sendSchema, input);
  if (!d.ticketIds?.length && !d.pendingOnly) throw validation('Choose tickets or "pending only"');
  const ev = await assertManageEvent(ctx, eventId);
  if (closedStatuses.includes(ev.status)) throw conflict(`Cannot send invitations for a ${ev.status.toLowerCase()} event`);
  const r = await ctx.db.query<{ id: string; guest_id: string; qr_token_enc: string | null }>(
    `SELECT t.id, t.guest_id, t.qr_token_enc FROM tickets t
      WHERE t.event_id = $1 AND t.company_id = $4 AND t.status = 'ACTIVE'
        AND ($2::uuid[] IS NULL OR t.id = ANY($2::uuid[]))
        AND ($3::boolean = false OR NOT EXISTS (SELECT 1 FROM invitations i WHERE i.ticket_id = t.id AND i.sent))`,
    [eventId, d.ticketIds ?? null, d.pendingOnly, ctx.companyId],
  );
  const items: Issued[] = [];
  for (const row of r.rows) items.push({ ticketId: row.id, guestId: row.guest_id, token: await currentToken(ctx, row.id, row.qr_token_enc) });
  const sent = items.length ? await deliverInvitations(ctx, eventId, items) : 0;
  return { attempted: items.length, sent, failed: items.length - sent };
}

export async function listInvitations(ctx: Ctx, query: { eventId?: string; page: number; pageSize: number }) {
  if (query.eventId) await assertManageEvent(ctx, query.eventId);
  const params: unknown[] = [ctx.companyId];
  let where = 'i.company_id = $1';
  if (query.eventId) {
    params.push(query.eventId);
    where += ` AND i.event_id = $2`;
  } else if (ctx.role === 'EVENT_MANAGER') {
    params.push(ctx.userId);
    where += ` AND EXISTS (SELECT 1 FROM event_managers m WHERE m.event_id = i.event_id AND m.user_id = $2)`;
  }
  params.push(query.pageSize, (query.page - 1) * query.pageSize);
  const r = await ctx.db.query(
    `SELECT i.id, i.sent, i.sent_at AS "sentAt", i.delivery_status AS "deliveryStatus", i.opened_at AS "openedAt", i.clicked_at AS "clickedAt",
            e.id AS "eventId", e.name AS "eventName", g.first_name AS "firstName", g.last_name AS "lastName", g.email, t.ticket_number AS "ticketNumber",
            count(*) OVER()::int AS total
       FROM invitations i JOIN events e ON e.id = i.event_id JOIN guests g ON g.id = i.guest_id JOIN tickets t ON t.id = i.ticket_id
      WHERE ${where} ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows.map(({ total: _t, ...row }) => row), total: (r.rows[0]?.total as number | undefined) ?? 0 };
}
