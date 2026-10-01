import { z } from 'zod';
import type { Ctx } from '../context';
import { parse } from '../lib/errors';
import { audit } from './audit';

const schema = z.object({
  companyName: z.string().trim().min(2).max(100),
  logoUrl: z.union([z.string().url().max(500).startsWith('https://'), z.literal('')]).nullable(),
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

const select = `company_name AS "companyName", logo_url AS "logoUrl", primary_brand_color AS "primaryBrandColor",
  timezone, default_language AS "defaultLanguage", contact_email AS "contactEmail", contact_phone AS "contactPhone"`;

export async function getSettings(ctx: Ctx) {
  const r = await ctx.db.query(`SELECT ${select} FROM company_settings WHERE company_id = $1`, [ctx.companyId]);
  return r.rows[0];
}

export async function updateSettings(ctx: Ctx, input: unknown) {
  const d = parse(schema, input);
  await ctx.db.query(
    `UPDATE company_settings SET company_name=$1, logo_url=NULLIF($2,''), primary_brand_color=$3, timezone=$4,
       default_language=$5, contact_email=NULLIF($6,''), contact_phone=NULLIF($7,'')
     WHERE company_id = $8`,
    [d.companyName, d.logoUrl ?? '', d.primaryBrandColor, d.timezone, d.defaultLanguage, d.contactEmail ?? '', d.contactPhone ?? '', ctx.companyId],
  );
  await audit(ctx.db, ctx, 'SETTINGS_UPDATED', 'company_settings', null);
  return getSettings(ctx);
}
