import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import type { Ctx } from '../context';
import { withTx } from '../db/pools';
import { toCsv } from '../lib/csv';
import { AppError, conflict, notFound, parse, validation } from '../lib/errors';
import { audit } from './audit';
import { issueTickets } from './tickets';

export const CATEGORIES = ['VIP', 'SPEAKER', 'SPONSOR', 'STAFF', 'ATTENDEE', 'FAMILY', 'OTHER'] as const;

const phoneSchema = z
  .string()
  .trim()
  .transform((p) => p.replace(/[\s().-]/g, ''))
  .refine((p) => p === '' || /^\+?\d{6,15}$/.test(p), 'Invalid phone number')
  .transform((p) => (p === '' ? null : p));

export const guestSchema = z.object({
  firstName: z.string().trim().min(1, 'Missing first name').max(100),
  lastName: z.string().trim().min(1, 'Missing last name').max(100),
  email: z.string().trim().toLowerCase().min(1, 'Missing email').email('Invalid email').max(254),
  phone: phoneSchema.nullish().transform((p) => p ?? null),
  companyName: z.string().trim().max(150).nullish().transform((v) => v || null),
  category: z.enum(CATEGORIES).default('ATTENDEE'),
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
});
export type GuestInput = z.infer<typeof guestSchema>;

const COLS = `id, first_name AS "firstName", last_name AS "lastName", email, phone, company_name AS "companyName",
  category, notes, created_at AS "createdAt", updated_at AS "updatedAt"`;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export async function listGuests(ctx: Ctx, q: { search?: string; category?: string; page: number; pageSize: number }) {
  const params: unknown[] = [ctx.companyId];
  const where = ['company_id = $1', "status = 'ACTIVE'"];
  if (q.category) {
    params.push(q.category);
    where.push(`category = $${params.length}`);
  }
  if (q.search) {
    params.push(`${likeEscape(q.search.toLowerCase())}%`);
    const p = `$${params.length}`;
    where.push(
      `(lower(first_name) LIKE ${p} OR lower(last_name) LIKE ${p} OR lower(email) LIKE ${p}
        OR lower(first_name || ' ' || last_name) LIKE ${p} OR phone LIKE ${p})`,
    );
  }
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const r = await ctx.db.query(
    `SELECT ${COLS}, count(*) OVER()::int AS total FROM guests WHERE ${where.join(' AND ')}
      ORDER BY lower(last_name), lower(first_name) LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows.map(({ total: _t, ...g }) => g), total: (r.rows[0]?.total as number | undefined) ?? 0 };
}

export async function getGuest(ctx: Ctx, id: string) {
  const r = await ctx.db.query(`SELECT ${COLS} FROM guests WHERE id = $1 AND company_id = $2 AND status = 'ACTIVE'`, [id, ctx.companyId]);
  if (!r.rows[0]) throw new AppError('GUEST_NOT_FOUND', 404, 'Guest not found');
  return r.rows[0];
}

async function assertPhoneFree(ctx: Ctx, phone: string | null, exceptId?: string) {
  if (!phone) return;
  const r = await ctx.db.query(
    "SELECT 1 FROM guests WHERE company_id = $3 AND phone = $1 AND status = 'ACTIVE' AND ($2::uuid IS NULL OR id <> $2)",
    [phone, exceptId ?? null, ctx.companyId],
  );
  if (r.rowCount) throw conflict('A guest with this phone number already exists');
}

export async function createGuest(ctx: Ctx, input: unknown) {
  const d = parse(guestSchema, input);
  await assertPhoneFree(ctx, d.phone);
  try {
    const r = await ctx.db.query<{ id: string }>(
      `INSERT INTO guests (company_id, first_name, last_name, email, phone, company_name, category, notes)
       VALUES ($8,$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.firstName, d.lastName, d.email, d.phone, d.companyName, d.category, d.notes, ctx.companyId],
    );
    await audit(ctx.db, ctx, 'GUEST_CREATED', 'guest', r.rows[0]!.id);
    return getGuest(ctx, r.rows[0]!.id);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('A guest with this email already exists');
    throw e;
  }
}

export async function updateGuest(ctx: Ctx, id: string, input: unknown) {
  const cur = await getGuest(ctx, id);
  const d = parse(guestSchema, { ...cur, ...(input as object) });
  await assertPhoneFree(ctx, d.phone, id);
  try {
    await ctx.db.query(
      `UPDATE guests SET first_name=$2, last_name=$3, email=$4, phone=$5, company_name=$6, category=$7, notes=$8, updated_at=now()
        WHERE id=$1 AND company_id=$9`,
      [id, d.firstName, d.lastName, d.email, d.phone, d.companyName, d.category, d.notes, ctx.companyId],
    );
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('A guest with this email already exists');
    throw e;
  }
  await audit(ctx.db, ctx, 'GUEST_UPDATED', 'guest', id);
  return getGuest(ctx, id);
}

/** Soft delete; live tickets that were never used are cancelled so they can no longer be scanned. */
export async function deleteGuests(ctx: Ctx, ids: string[]) {
  if (ids.length === 0) return { deleted: 0 };
  return withTx(ctx.db, async (tx) => {
    const r = await tx.query<{ id: string }>(
      "UPDATE guests SET status = 'DELETED', updated_at = now() WHERE company_id = $2 AND id = ANY($1::uuid[]) AND status = 'ACTIVE' RETURNING id",
      [ids, ctx.companyId],
    );
    const done = r.rows.map((x) => x.id);
    await tx.query("UPDATE tickets SET status = 'CANCELLED' WHERE company_id = $2 AND guest_id = ANY($1::uuid[]) AND status = 'ACTIVE'", [done, ctx.companyId]);
    for (const id of done) await audit(tx, ctx, 'GUEST_DELETED', 'guest', id);
    return { deleted: done.length };
  });
}

export async function exportGuestsCsv(ctx: Ctx): Promise<string> {
  const r = await ctx.db.query(
    `SELECT first_name, last_name, email, phone, company_name, category, created_at FROM guests
      WHERE company_id = $1 AND status='ACTIVE' ORDER BY lower(last_name), lower(first_name)`,
    [ctx.companyId],
  );
  await audit(ctx.db, ctx, 'GUEST_EXPORTED', 'guest', null, { count: r.rowCount });
  return toCsv(
    ['first_name', 'last_name', 'email', 'phone', 'company_name', 'category', 'created_at'],
    r.rows.map((g) => [g.first_name, g.last_name, g.email, g.phone, g.company_name, g.category, g.created_at]),
  );
}

// ---- Bulk import ---------------------------------------------------------

const ALIASES: Record<string, string> = {
  firstname: 'first_name', first: 'first_name', given_name: 'first_name',
  lastname: 'last_name', last: 'last_name', surname: 'last_name', family_name: 'last_name',
  e_mail: 'email', email_address: 'email', mail: 'email',
  mobile: 'phone', phone_number: 'phone', telephone: 'phone', tel: 'phone',
  company: 'company_name', organization: 'company_name', organisation: 'company_name',
  type: 'category', group: 'category',
};
const normHeader = (h: string) => {
  const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[k] ?? k;
};

export const MAX_IMPORT_ROWS = 5000;

export interface RowError {
  row: number;
  field: string;
  message: string;
}
export interface ImportAnalysis {
  totalRows: number;
  valid: (GuestInput & { row: number })[];
  errors: RowError[];
}

export async function analyzeCsv(ctx: Ctx, csv: string): Promise<ImportAnalysis> {
  let records: Record<string, string>[];
  try {
    records = parseCsv(csv, {
      columns: (h: string[]) => h.map(normHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch {
    throw validation('Could not read the file. Make sure it is a valid CSV.');
  }
  if (records.length === 0) throw validation('The file has no data rows');
  if (records.length > MAX_IMPORT_ROWS) throw validation(`A maximum of ${MAX_IMPORT_ROWS} rows can be imported at once`);
  const headers = new Set(Object.keys(records[0]!));
  const missing = ['first_name', 'last_name', 'email'].filter((c) => !headers.has(c));
  if (missing.length) throw validation(`Missing required column(s): ${missing.join(', ')}`);

  const errors: RowError[] = [];
  const parsed: { row: number; data?: GuestInput }[] = [];
  records.forEach((rec, i) => {
    const row = i + 2; // spreadsheet row number: header is row 1
    const r = guestSchema.safeParse({
      firstName: rec.first_name ?? '',
      lastName: rec.last_name ?? '',
      email: rec.email ?? '',
      phone: rec.phone ?? '',
      companyName: rec.company_name,
      category: rec.category ? rec.category.toUpperCase() : undefined,
      notes: rec.notes,
    });
    if (!r.success) {
      for (const iss of r.error.issues) errors.push({ row, field: String(iss.path[0] ?? ''), message: iss.message });
      parsed.push({ row });
    } else parsed.push({ row, data: r.data });
  });

  // duplicates inside the file
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  for (const p of parsed) {
    if (!p.data) continue;
    const pe = seenEmail.get(p.data.email);
    if (pe) {
      errors.push({ row: p.row, field: 'email', message: `Duplicate email (also on row ${pe})` });
      p.data = undefined;
      continue;
    }
    seenEmail.set(p.data.email, p.row);
    if (p.data.phone) {
      const pp = seenPhone.get(p.data.phone);
      if (pp) {
        errors.push({ row: p.row, field: 'phone', message: `Duplicate phone number (also on row ${pp})` });
        p.data = undefined;
        continue;
      }
      seenPhone.set(p.data.phone, p.row);
    }
  }
  // duplicates against existing guests
  const emails = [...seenEmail.keys()];
  const phones = [...seenPhone.keys()];
  const ex = await ctx.db.query<{ email: string; phone: string | null }>(
    "SELECT lower(email) AS email, phone FROM guests WHERE company_id = $3 AND status = 'ACTIVE' AND (lower(email) = ANY($1::text[]) OR phone = ANY($2::text[]))",
    [emails, phones, ctx.companyId],
  );
  const exEmail = new Set(ex.rows.map((x) => x.email));
  const exPhone = new Set(ex.rows.map((x) => x.phone).filter(Boolean));
  for (const p of parsed) {
    if (!p.data) continue;
    if (exEmail.has(p.data.email)) {
      errors.push({ row: p.row, field: 'email', message: 'A guest with this email already exists' });
      p.data = undefined;
    } else if (p.data.phone && exPhone.has(p.data.phone)) {
      errors.push({ row: p.row, field: 'phone', message: 'Duplicate phone number (already exists)' });
      p.data = undefined;
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return {
    totalRows: records.length,
    valid: parsed.filter((p) => p.data).map((p) => ({ ...p.data!, row: p.row })),
    errors,
  };
}

export async function previewImport(ctx: Ctx, input: unknown) {
  const { csv } = parse(z.object({ csv: z.string().min(1).max(5_000_000) }), input);
  const a = await analyzeCsv(ctx, csv);
  return {
    totalRows: a.totalRows,
    validRows: a.valid.length,
    invalidRows: new Set(a.errors.map((e) => e.row)).size,
    errors: a.errors.slice(0, 500),
    sample: a.valid.slice(0, 10),
  };
}

const commitSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  skipInvalid: z.boolean().default(false),
  eventId: z.string().uuid().optional(),
  generatePasses: z.boolean().default(false),
  sendInvitations: z.boolean().default(false),
});

export async function commitImport(ctx: Ctx, input: unknown) {
  const d = parse(commitSchema, input);
  const a = await analyzeCsv(ctx, d.csv); // always re-validated server-side
  if (a.errors.length && !d.skipInvalid) {
    throw validation('The file has errors. Fix them or choose to skip invalid rows.', { errors: a.errors.slice(0, 500) });
  }
  if (a.valid.length === 0) throw validation('There are no valid rows to import');
  let ids: string[];
  try {
    ids = await withTx(ctx.db, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO guests (company_id, first_name, last_name, email, phone, company_name, category, notes)
         SELECT $8::uuid, f, l, e, p, c, k, n
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS x(f, l, e, p, c, k, n)
         RETURNING id`,
        [
          a.valid.map((g) => g.firstName),
          a.valid.map((g) => g.lastName),
          a.valid.map((g) => g.email),
          a.valid.map((g) => g.phone),
          a.valid.map((g) => g.companyName),
          a.valid.map((g) => g.category),
          a.valid.map((g) => g.notes),
          ctx.companyId,
        ],
      );
      await audit(tx, ctx, 'GUEST_IMPORTED', 'guest', null, { imported: r.rowCount, skipped: a.errors.length });
      return r.rows.map((x) => x.id);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('Some guests were added while importing. Please review the file again.');
    throw e;
  }
  const result: { imported: number; skippedRows: number; tickets?: { issued: number; invited: number; failed: number } } = {
    imported: ids.length,
    skippedRows: new Set(a.errors.map((e) => e.row)).size,
  };
  if (d.eventId && d.generatePasses) {
    const t = await issueTickets(ctx, d.eventId, { guestIds: ids, send: d.sendInvitations });
    result.tickets = { issued: t.issued, invited: t.invited, failed: t.failed };
  }
  return result;
}

export async function assertGuestsExist(ctx: Ctx, ids: string[]): Promise<void> {
  const r = await ctx.db.query("SELECT count(*)::int AS n FROM guests WHERE company_id = $2 AND id = ANY($1::uuid[]) AND status = 'ACTIVE'", [ids, ctx.companyId]);
  if ((r.rows[0]!.n as number) !== new Set(ids).size) throw notFound('Guest');
}
