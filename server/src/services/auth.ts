import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import type { Ctx } from '../context';
import { pool } from '../db/pools';
import { AppError, conflict, forbidden, parse, unauthorized } from '../lib/errors';
import { generateQrToken, sha256Hex } from '../lib/crypto';
import type { Role } from '../lib/permissions';
import { escapeHtml, sendMail, trySendMail } from './mailer';

export const rounds = () => (config().NODE_ENV === 'test' ? 4 : 12);
// Compared against when the email is unknown so response time does not reveal which emails exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Include letters and at least one number');
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  fullName: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  companyId: string;
  companyName: string;
  companySlug: string;
  features: Record<string, boolean>;
}

function signToken(userId: string, credentialsUpdatedAt: Date): string {
  const c = config();
  return jwt.sign({ sub: userId, pv: credentialsUpdatedAt.getTime() }, c.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${Math.round(c.SESSION_HOURS * 3600)}s`,
  });
}

/**
 * Self-service signup only files a request. Nothing is provisioned (no database, no login) until a superadmin
 * approves it in services/platform.ts.
 */
export async function register(input: unknown): Promise<{ requestId: string }> {
  const d = parse(registerSchema, input);
  const platform = pool();
  const exists = await platform.query('SELECT 1 FROM users WHERE lower(email) = $1', [d.email]);
  if (exists.rowCount) throw conflict('An account with this email already exists');
  const passwordHash = await bcrypt.hash(d.password, rounds());
  let requestId: string;
  try {
    const r = await platform.query<{ id: string }>(
      `INSERT INTO company_requests (company_name, full_name, email, password_hash, timezone)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [d.companyName, d.fullName, d.email, passwordHash, d.timezone ?? null],
    );
    requestId = r.rows[0]!.id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('A request for this email is already waiting for approval');
    throw e;
  }
  await notifySuperadmins(d.companyName, d.fullName, d.email);
  await trySendMail({
    to: d.email,
    subject: 'We received your EventPass request',
    text: `Hi ${d.fullName},

Thanks for requesting an EventPass account for ${d.companyName}. We will email you as soon as it has been reviewed.
`,
    html: `<p>Hi ${escapeHtml(d.fullName)},</p><p>Thanks for requesting an EventPass account for <b>${escapeHtml(d.companyName)}</b>. We will email you as soon as it has been reviewed.</p>`,
  });
  return { requestId };
}

async function notifySuperadmins(companyName: string, fullName: string, email: string): Promise<void> {
  const admins = await pool().query<{ email: string }>('SELECT email FROM platform_admins');
  const link = `${config().APP_URL}/admin`;
  for (const a of admins.rows) {
    await trySendMail({
      to: a.email,
      subject: `New EventPass company request: ${companyName}`,
      text: `${fullName} <${email}> asked for a company account for ${companyName}.

Review it: ${link}
`,
      html: `<p>${escapeHtml(fullName)} &lt;${escapeHtml(email)}&gt; asked for a company account for <b>${escapeHtml(companyName)}</b>.</p><p><a href="${escapeHtml(link)}">Review requests</a></p>`,
    });
  }
}

export async function login(input: unknown) {
  const d = parse(loginSchema, input);
  const r = await pool().query<{
    id: string;
    status: string;
    company_status: string;
    password_hash: string;
    cred_updated: Date;
  }>(
    `SELECT u.id, u.status, c.status AS company_status, cr.password_hash, cr.updated_at AS cred_updated
       FROM users u
       JOIN companies c ON c.id = u.company_id
       JOIN auth_credentials cr ON cr.user_id = u.id
      WHERE lower(u.email) = $1`,
    [d.email],
  );
  const row = r.rows[0];
  if (!row) {
    // Only someone who knows the password learns that a request is pending: no account enumeration.
    const p = await pool().query<{ password_hash: string }>(
      "SELECT password_hash FROM company_requests WHERE lower(email) = $1 AND status = 'PENDING'",
      [d.email],
    );
    const pendingOk = await bcrypt.compare(d.password, p.rows[0]?.password_hash ?? DUMMY_HASH);
    if (p.rows[0] && pendingOk) {
      throw new AppError('PENDING_APPROVAL', 403, 'Your company is waiting for approval. We will email you once it has been reviewed.');
    }
    throw unauthorized('Invalid email or password');
  }
  const ok = await bcrypt.compare(d.password, row.password_hash);
  if (!ok) throw unauthorized('Invalid email or password');
  if (row.status !== 'ACTIVE') throw new AppError('USER_DISABLED', 403, 'This account has been deactivated');
  if (row.company_status !== 'ACTIVE') throw forbidden('This company account is not active');
  return { token: signToken(row.id, row.cred_updated), userId: row.id };
}

/** Resolve a session token to a company-bound context. The company is derived here, never from the request. */
export async function loadContext(token: string, ip?: string): Promise<Ctx> {
  let payload: jwt.JwtPayload;
  try {
    const p = jwt.verify(token, config().JWT_SECRET, { algorithms: ['HS256'] });
    // Superadmin tokens carry an audience; company sessions never do.
    if (typeof p === 'string' || typeof p.sub !== 'string' || p.aud !== undefined) throw new Error('bad payload');
    payload = p;
  } catch {
    throw unauthorized('Session expired or invalid');
  }
  const r = await pool().query<{
    id: string;
    email: string;
    role: Role;
    status: string;
    company_id: string;
    slug: string;
    company_status: string;
    max_events: number | null;
    max_guests_per_event: number | null;
    features: Record<string, boolean>;
    cred_updated: Date;
  }>(
    `SELECT u.id, u.email, u.role, u.status, u.company_id, c.slug, c.status AS company_status,
            p.max_events, p.max_guests_per_event, p.features, cr.updated_at AS cred_updated
       FROM users u
       JOIN companies c ON c.id = u.company_id
       JOIN plans p ON p.id = c.plan_id
       JOIN auth_credentials cr ON cr.user_id = u.id
      WHERE u.id = $1`,
    [payload.sub],
  );
  const u = r.rows[0];
  if (!u || payload.pv !== u.cred_updated.getTime()) throw unauthorized('Session expired or invalid');
  if (u.status !== 'ACTIVE') throw new AppError('USER_DISABLED', 403, 'This account has been deactivated');
  if (u.company_status !== 'ACTIVE') throw forbidden('This company account is not active');
  return {
    userId: u.id,
    email: u.email,
    role: u.role,
    companyId: u.company_id,
    companySlug: u.slug,
    db: pool(),
    limits: { maxEvents: u.max_events, maxGuestsPerEvent: u.max_guests_per_event },
    features: u.features,
    ip,
  };
}

export async function sessionUser(ctx: Ctx): Promise<SessionUser> {
  const [u, s] = await Promise.all([
    ctx.db.query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1 AND company_id = $2', [ctx.userId, ctx.companyId]),
    ctx.db.query<{ company_name: string }>('SELECT company_name FROM company_settings WHERE company_id = $1', [ctx.companyId]),
  ]);
  return {
    id: ctx.userId,
    email: ctx.email,
    fullName: u.rows[0]?.full_name ?? '',
    role: ctx.role,
    companyId: ctx.companyId,
    companyName: s.rows[0]?.company_name ?? '',
    companySlug: ctx.companySlug,
    features: ctx.features,
  };
}

export async function changePassword(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }), input);
  const r = await pool().query<{ password_hash: string }>('SELECT password_hash FROM auth_credentials WHERE user_id = $1', [ctx.userId]);
  if (!r.rows[0] || !(await bcrypt.compare(d.currentPassword, r.rows[0].password_hash))) {
    throw new AppError('VALIDATION_ERROR', 400, 'Current password is incorrect', { issues: [{ field: 'currentPassword', message: 'Incorrect password' }] });
  }
  const hash = await bcrypt.hash(d.newPassword, rounds());
  const up = await pool().query<{ updated_at: Date }>(
    'UPDATE auth_credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1 RETURNING updated_at',
    [ctx.userId, hash],
  );
  // All other sessions are invalidated (pv changed); hand back a fresh token for this one.
  return { token: signToken(ctx.userId, up.rows[0]!.updated_at) };
}

export async function requestPasswordReset(input: unknown): Promise<void> {
  const { email } = parse(z.object({ email: emailSchema }), input);
  const r = await pool().query<{ id: string; status: string }>('SELECT id, status FROM users WHERE lower(email) = $1', [email]);
  const u = r.rows[0];
  if (!u || u.status !== 'ACTIVE') return; // identical response either way: no account enumeration
  const raw = generateQrToken();
  await pool().query(
    "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [sha256Hex(raw), u.id],
  );
  const link = `${config().APP_URL}/reset-password?token=${raw}`;
  await sendMail({
    to: email,
    subject: 'Reset your EventPass password',
    text: `Use this link within one hour to reset your password:\n${link}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Use this link within one hour to reset your password:</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}

export async function resetPassword(input: unknown): Promise<void> {
  const d = parse(z.object({ token: z.string().length(64), newPassword: passwordSchema }), input);
  const hash = await bcrypt.hash(d.newPassword, rounds());
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const t = await client.query<{ user_id: string }>(
      `UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256Hex(d.token)],
    );
    if (!t.rows[0]) throw new AppError('VALIDATION_ERROR', 400, 'This reset link is invalid or has expired');
    await client.query('UPDATE auth_credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1', [t.rows[0].user_id, hash]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
