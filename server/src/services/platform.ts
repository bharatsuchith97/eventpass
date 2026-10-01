import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { pool, withTx } from '../db/pools';
import { AppError, conflict, notFound, parse, unauthorized } from '../lib/errors';
import { DUMMY_HASH, emailSchema, rounds } from './auth';
import { escapeHtml, trySendMail } from './mailer';
import { createCompany } from './tenants';

/**
 * Superadmins run the platform: they approve company signups and can suspend companies. They live only in the
 * platform DB and never receive a tenant session, so they cannot read any company's events or guests.
 */
const AUDIENCE = 'platform-admin';

export interface AdminCtx {
  adminId: string;
  email: string;
}

/** Create or update the superadmin named in SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD. */
export async function syncBootstrapAdmin(): Promise<void> {
  const { SUPERADMIN_EMAIL: email, SUPERADMIN_PASSWORD: password } = config();
  if (!email || !password) return;
  const platform = pool();
  const r = await platform.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM platform_admins WHERE lower(email) = $1', [email]);
  const existing = r.rows[0];
  if (!existing) {
    await platform.query('INSERT INTO platform_admins (email, password_hash) VALUES ($1, $2)', [email, await bcrypt.hash(password, rounds())]);
    if (config().LOG_LEVEL !== 'silent') console.log(`[superadmin] created ${email}`);
  } else if (!(await bcrypt.compare(password, existing.password_hash))) {
    // Bumping updated_at also ends every existing superadmin session.
    await platform.query('UPDATE platform_admins SET password_hash = $2, updated_at = now() WHERE id = $1', [existing.id, await bcrypt.hash(password, rounds())]);
    if (config().LOG_LEVEL !== 'silent') console.log(`[superadmin] password updated for ${email}`);
  }
}

function signAdminToken(adminId: string, updatedAt: Date): string {
  const c = config();
  return jwt.sign({ sub: adminId, pv: updatedAt.getTime() }, c.JWT_SECRET, {
    algorithm: 'HS256',
    audience: AUDIENCE,
    expiresIn: `${Math.round(c.SESSION_HOURS * 3600)}s`,
  });
}

export async function adminLogin(input: unknown): Promise<{ token: string; admin: AdminCtx }> {
  const d = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128) }), input);
  const r = await pool().query<{ id: string; email: string; password_hash: string; updated_at: Date }>(
    'SELECT id, email, password_hash, updated_at FROM platform_admins WHERE lower(email) = $1',
    [d.email],
  );
  const row = r.rows[0];
  const ok = await bcrypt.compare(d.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw unauthorized('Invalid email or password');
  return { token: signAdminToken(row.id, row.updated_at), admin: { adminId: row.id, email: row.email } };
}

export async function loadAdmin(token: string): Promise<AdminCtx> {
  let payload: jwt.JwtPayload;
  try {
    const p = jwt.verify(token, config().JWT_SECRET, { algorithms: ['HS256'], audience: AUDIENCE });
    if (typeof p === 'string' || typeof p.sub !== 'string') throw new Error('bad payload');
    payload = p;
  } catch {
    throw unauthorized('Session expired or invalid');
  }
  const r = await pool().query<{ id: string; email: string; updated_at: Date }>('SELECT id, email, updated_at FROM platform_admins WHERE id = $1', [payload.sub]);
  const a = r.rows[0];
  if (!a || payload.pv !== a.updated_at.getTime()) throw unauthorized('Session expired or invalid');
  return { adminId: a.id, email: a.email };
}

// ---- Company requests ------------------------------------------------------

const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export async function listRequests(query: unknown) {
  const { status } = parse(z.object({ status: z.enum(REQUEST_STATUSES).default('PENDING') }), query);
  const r = await pool().query(
    `SELECT r.id, r.company_name AS "companyName", r.full_name AS "fullName", r.email, r.timezone, r.status,
            r.reject_reason AS "rejectReason", r.company_id AS "companyId", a.email AS "decidedBy",
            r.decided_at AS "decidedAt", r.created_at AS "createdAt"
       FROM company_requests r LEFT JOIN platform_admins a ON a.id = r.decided_by
      WHERE r.status = $1
      ORDER BY r.created_at ${status === 'PENDING' ? 'ASC' : 'DESC'}
      LIMIT 500`,
    [status],
  );
  return r.rows;
}

/** 404 if the request does not exist, 409 if someone already approved or rejected it. */
async function alreadyDecided(id: string): Promise<AppError> {
  const r = await pool().query('SELECT 1 FROM company_requests WHERE id = $1', [id]);
  return r.rowCount ? conflict('This request has already been decided') : notFound('Request');
}

export async function approveRequest(admin: AdminCtx, id: string) {
  // One transaction: the conditional UPDATE locks the request row, so a second superadmin approving at the
  // same moment waits, then finds it no longer PENDING (409). A failure leaves the request pending.
  let created: { req: { company_name: string; full_name: string; email: string }; companyId: string };
  try {
    created = await withTx(pool(), async (tx) => {
      const claimed = await tx.query<{ company_name: string; full_name: string; email: string; password_hash: string; timezone: string | null }>(
        `UPDATE company_requests SET status = 'APPROVED', decided_by = $2, decided_at = now()
          WHERE id = $1 AND status = 'PENDING'
          RETURNING company_name, full_name, email, password_hash, timezone`,
        [id, admin.adminId],
      );
      const req = claimed.rows[0];
      if (!req) throw await alreadyDecided(id);
      const { companyId } = await createCompany(tx, {
        companyName: req.company_name,
        adminEmail: req.email,
        adminName: req.full_name,
        passwordHash: req.password_hash,
        timezone: req.timezone ?? undefined,
      });
      // The hash now lives in auth_credentials; do not keep a second copy.
      await tx.query('UPDATE company_requests SET company_id = $2, password_hash = NULL WHERE id = $1', [id, companyId]);
      return { req, companyId };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('Someone already has an account with this email. Reject this request instead.');
    throw e;
  }
  const { req, companyId } = created;

  const link = `${config().APP_URL}/login`;
  await trySendMail({
    to: req.email,
    subject: 'Your Inviteley account is ready',
    text: `Hi ${req.full_name},\n\nYour Inviteley account for ${req.company_name} has been approved. Sign in with the email and password you chose:\n${link}\n`,
    html: `<p>Hi ${escapeHtml(req.full_name)},</p><p>Your Inviteley account for <b>${escapeHtml(req.company_name)}</b> has been approved. Sign in with the email and password you chose.</p><p><a href="${escapeHtml(link)}">Sign in</a></p>`,
  });
  return { id, status: 'APPROVED' as const, companyId };
}

export async function rejectRequest(admin: AdminCtx, id: string, input: unknown) {
  const { reason } = parse(z.object({ reason: z.string().trim().max(500).optional() }), input ?? {});
  const r = await pool().query<{ company_name: string; full_name: string; email: string }>(
    `UPDATE company_requests
        SET status = 'REJECTED', reject_reason = $3, password_hash = NULL, decided_by = $2, decided_at = now()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING company_name, full_name, email`,
    [id, admin.adminId, reason || null],
  );
  const req = r.rows[0];
  if (!req) throw await alreadyDecided(id);
  const why = reason ? `\n\nReason: ${reason}` : '';
  await trySendMail({
    to: req.email,
    subject: 'Your Inviteley request',
    text: `Hi ${req.full_name},\n\nYour request for an Inviteley account for ${req.company_name} was not approved.${why}\n`,
    html: `<p>Hi ${escapeHtml(req.full_name)},</p><p>Your request for an Inviteley account for <b>${escapeHtml(req.company_name)}</b> was not approved.</p>${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}`,
  });
  return { id, status: 'REJECTED' as const };
}

// ---- Companies ---------------------------------------------------------------

export async function listPlans() {
  const r = await pool().query(
    'SELECT code, name, max_events AS "maxEvents", max_guests_per_event AS "maxGuestsPerEvent" FROM plans ORDER BY max_events NULLS LAST',
  );
  return r.rows;
}

export async function listCompanies() {
  const r = await pool().query(
    `SELECT c.id, c.name, c.slug, c.status, p.code AS plan, c.created_at AS "createdAt",
            (SELECT u.email FROM users u WHERE u.company_id = c.id ORDER BY u.created_at LIMIT 1) AS "ownerEmail",
            (SELECT count(*)::int FROM users u WHERE u.company_id = c.id) AS "userCount"
       FROM companies c JOIN plans p ON p.id = c.plan_id
      WHERE c.status <> 'DELETED'
      ORDER BY c.created_at DESC`,
  );
  return r.rows;
}

export async function updateCompany(id: string, input: unknown) {
  const d = parse(
    z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), plan: z.string().max(40).optional() })
      .refine((v) => v.status !== undefined || v.plan !== undefined, 'Nothing to change'),
    input,
  );
  const platform = pool();
  let planId: string | null = null;
  if (d.plan !== undefined) {
    const p = await platform.query<{ id: string }>('SELECT id FROM plans WHERE code = $1', [d.plan]);
    if (!p.rows[0]) throw new AppError('VALIDATION_ERROR', 400, 'Unknown plan', { issues: [{ field: 'plan', message: 'Unknown plan' }] });
    planId = p.rows[0].id;
  }
  // Suspension takes effect on the next request: login, sessions and public pass pages all check company status.
  const r = await platform.query(
    `UPDATE companies SET status = COALESCE($2, status), plan_id = COALESCE($3, plan_id), updated_at = now()
      WHERE id = $1 AND status IN ('ACTIVE', 'SUSPENDED')
      RETURNING id, status`,
    [id, d.status ?? null, planId],
  );
  if (!r.rows[0]) throw notFound('Company');
  return r.rows[0];
}
