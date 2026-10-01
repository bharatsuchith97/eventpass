import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Ctx } from '../context';
import { withTx } from '../db/pools';
import { conflict, notFound, parse, validation } from '../lib/errors';
import { ROLES } from '../lib/permissions';
import { audit } from './audit';
import { passwordSchema, rounds } from './auth';

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  password: passwordSchema,
});
const updateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    role: z.enum(ROLES),
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .partial();

const cols = `id, email, full_name AS "fullName", role, status, created_at AS "createdAt"`;

export async function listUsers(ctx: Ctx) {
  const r = await ctx.db.query(`SELECT ${cols} FROM users WHERE company_id = $1 ORDER BY created_at`, [ctx.companyId]);
  return r.rows;
}

export async function createUser(ctx: Ctx, input: unknown) {
  const d = parse(createSchema, input);
  const hash = await bcrypt.hash(d.password, rounds());
  let id: string;
  try {
    id = await withTx(ctx.db, async (tx) => {
      const u = await tx.query<{ id: string }>(
        'INSERT INTO users (company_id, email, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [ctx.companyId, d.email, d.fullName, d.role],
      );
      await tx.query('INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1, $2)', [u.rows[0]!.id, hash]);
      return u.rows[0]!.id;
    });
  } catch (e) {
    // Emails are unique across the platform because people sign in by email alone.
    if ((e as { code?: string }).code === '23505') throw conflict('A user with this email already exists');
    throw e;
  }
  await audit(ctx.db, ctx, 'USER_CREATED', 'user', id, { role: d.role });
  const r = await ctx.db.query(`SELECT ${cols} FROM users WHERE id = $1 AND company_id = $2`, [id, ctx.companyId]);
  return r.rows[0];
}

export async function updateUser(ctx: Ctx, id: string, input: unknown) {
  const d = parse(updateSchema, input);
  const cur = await ctx.db.query<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = $1 AND company_id = $2', [id, ctx.companyId]);
  if (!cur.rows[0]) throw notFound('User');
  const newRole = d.role ?? cur.rows[0].role;
  const newStatus = d.status ?? cur.rows[0].status;
  const losesAdmin = cur.rows[0].role === 'COMPANY_ADMIN' && cur.rows[0].status === 'ACTIVE' && (newRole !== 'COMPANY_ADMIN' || newStatus !== 'ACTIVE');
  if (losesAdmin) {
    const others = await ctx.db.query(
      "SELECT 1 FROM users WHERE company_id = $2 AND role = 'COMPANY_ADMIN' AND status = 'ACTIVE' AND id <> $1",
      [id, ctx.companyId],
    );
    if (!others.rowCount) throw validation('A company must keep at least one active administrator');
  }
  await ctx.db.query(
    'UPDATE users SET full_name = COALESCE($2, full_name), role = $3, status = $4 WHERE id = $1 AND company_id = $5',
    [id, d.fullName ?? null, newRole, newStatus, ctx.companyId],
  );
  await audit(ctx.db, ctx, d.status === 'DISABLED' ? 'USER_DISABLED' : 'USER_UPDATED', 'user', id, { role: newRole, status: newStatus });
  const r = await ctx.db.query(`SELECT ${cols} FROM users WHERE id = $1 AND company_id = $2`, [id, ctx.companyId]);
  return r.rows[0];
}
