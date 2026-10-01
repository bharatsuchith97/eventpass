import { randomBytes } from 'node:crypto';
import type { Tx } from '../db/pools';

/** Creating a company ("tenant"). All companies share one database; a company is just rows keyed by company_id. */

export interface NewCompany {
  companyName: string;
  adminEmail: string;
  adminName: string;
  passwordHash: string;
  timezone?: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'company';
}

async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name);
  const taken = await tx.query('SELECT 1 FROM companies WHERE slug = $1', [base]);
  return taken.rowCount === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
}

/**
 * Company row -> default settings -> first COMPANY_ADMIN -> password hash, all inside the caller's transaction,
 * so a failure leaves nothing behind.
 */
export async function createCompany(tx: Tx, input: NewCompany): Promise<{ companyId: string; adminUserId: string }> {
  const slug = await uniqueSlug(tx, input.companyName);
  const c = await tx.query<{ id: string }>(
    "INSERT INTO companies (name, slug, plan_id) SELECT $1, $2, id FROM plans WHERE code = 'starter' RETURNING id",
    [input.companyName, slug],
  );
  const companyId = c.rows[0]!.id;
  await tx.query('INSERT INTO company_settings (company_id, company_name, contact_email, timezone) VALUES ($1, $2, $3, $4)', [
    companyId,
    input.companyName,
    input.adminEmail,
    input.timezone ?? 'UTC',
  ]);
  const u = await tx.query<{ id: string }>(
    "INSERT INTO users (company_id, email, full_name, role) VALUES ($1, $2, $3, 'COMPANY_ADMIN') RETURNING id",
    [companyId, input.adminEmail, input.adminName],
  );
  const adminUserId = u.rows[0]!.id;
  await tx.query('INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1, $2)', [adminUserId, input.passwordHash]);
  return { companyId, adminUserId };
}
