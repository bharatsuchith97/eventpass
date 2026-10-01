import { z } from 'zod';
import type { Ctx } from '../context';
import type { Db } from '../db/pools';
import { notFound, parse, validation } from '../lib/errors';
import { audit } from './audit';

const schema = z.object({
  companyName: z.string().trim().min(2).max(100),
  primaryBrandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #1565c0'),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
  defaultLanguage: z.string().regex(/^[a-z]{2}$/, 'Use an ISO 639-1 code like "en"'),
  contactEmail: z.union([z.string().email().max(254), z.literal('')]).nullable(),
  contactPhone: z.string().max(40).nullable(),
});

/** Same-origin URL of a company's logo; `v` changes on every upload so browsers never show a stale one. */
export const logoPath = (slug: string, updatedAt: Date) => `/api/public/logo/${slug}?v=${updatedAt.getTime()}`;

export async function getSettings(ctx: Ctx) {
  const r = await ctx.db.query<{
    companyName: string; primaryBrandColor: string; timezone: string; defaultLanguage: string;
    contactEmail: string | null; contactPhone: string | null; logoUpdatedAt: Date | null;
  }>(
    `SELECT company_name AS "companyName", primary_brand_color AS "primaryBrandColor", timezone,
            default_language AS "defaultLanguage", contact_email AS "contactEmail", contact_phone AS "contactPhone",
            CASE WHEN logo_data IS NULL THEN NULL ELSE logo_updated_at END AS "logoUpdatedAt"
       FROM company_settings WHERE company_id = $1`,
    [ctx.companyId],
  );
  const { logoUpdatedAt, ...s } = r.rows[0]!;
  return { ...s, logoUrl: logoUpdatedAt ? logoPath(ctx.companySlug, logoUpdatedAt) : null };
}

export async function updateSettings(ctx: Ctx, input: unknown) {
  const d = parse(schema, input);
  await ctx.db.query(
    `UPDATE company_settings SET company_name=$1, primary_brand_color=$2, timezone=$3,
       default_language=$4, contact_email=NULLIF($5,''), contact_phone=NULLIF($6,'')
     WHERE company_id = $7`,
    [d.companyName, d.primaryBrandColor, d.timezone, d.defaultLanguage, d.contactEmail ?? '', d.contactPhone ?? '', ctx.companyId],
  );
  await audit(ctx.db, ctx, 'SETTINGS_UPDATED', 'company_settings', null);
  return getSettings(ctx);
}

// ---- Logo -------------------------------------------------------------------

export const MAX_LOGO_BYTES = 512 * 1024;

/** Trust the file's own bytes, not the Content-Type the browser claimed. */
function sniffImage(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function setLogo(ctx: Ctx, body: unknown) {
  if (!Buffer.isBuffer(body) || body.length === 0) throw validation('Upload a PNG or JPG image');
  if (body.length > MAX_LOGO_BYTES) throw validation('The logo must be 512 KB or smaller');
  const mime = sniffImage(body);
  if (!mime) throw validation('Upload a PNG or JPG image');
  await ctx.db.query(
    'UPDATE company_settings SET logo_data = $2, logo_mime = $3, logo_updated_at = now() WHERE company_id = $1',
    [ctx.companyId, body, mime],
  );
  await audit(ctx.db, ctx, 'SETTINGS_UPDATED', 'company_settings', null, { logo: 'uploaded', bytes: body.length });
  return getSettings(ctx);
}

export async function removeLogo(ctx: Ctx) {
  await ctx.db.query('UPDATE company_settings SET logo_data = NULL, logo_mime = NULL, logo_updated_at = now() WHERE company_id = $1', [ctx.companyId]);
  await audit(ctx.db, ctx, 'SETTINGS_UPDATED', 'company_settings', null, { logo: 'removed' });
  return getSettings(ctx);
}

export interface Logo {
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
}

/** The logo bytes for PDFs and emails, or null if the company has none. */
export async function loadLogo(db: Db, companyId: string): Promise<Logo | null> {
  const r = await db.query<{ data: Buffer; mime: Logo['mime'] }>(
    'SELECT logo_data AS data, logo_mime AS mime FROM company_settings WHERE company_id = $1 AND logo_data IS NOT NULL',
    [companyId],
  );
  return r.rows[0] ?? null;
}

/** Public: the logo of an active company, by slug (used on guest pass pages and in the app header). */
export async function publicLogo(db: Db, slug: string): Promise<Logo> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) throw notFound('Logo');
  const r = await db.query<{ data: Buffer; mime: Logo['mime'] }>(
    `SELECT s.logo_data AS data, s.logo_mime AS mime
       FROM company_settings s JOIN companies c ON c.id = s.company_id
      WHERE c.slug = $1 AND c.status = 'ACTIVE' AND s.logo_data IS NOT NULL`,
    [slug],
  );
  if (!r.rows[0]) throw notFound('Logo');
  return r.rows[0];
}
