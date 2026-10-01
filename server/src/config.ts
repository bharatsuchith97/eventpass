import { z } from 'zod';

/** `FOO=` in a .env file means "not set". */
const unsetIfBlank = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** The one PostgreSQL database every company shares, e.g. postgres://user:pass@host:5432/eventpass */
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  SESSION_HOURS: z.coerce.number().positive().default(8),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Inviteley <no-reply@inviteley.com>'),
  TRUST_PROXY: z.coerce.number().int().default(0),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  /** Bootstrap superadmin, synced on every boot (changing the password here resets it). */
  SUPERADMIN_EMAIL: unsetIfBlank(z.string().trim().toLowerCase().email().optional()),
  SUPERADMIN_PASSWORD: unsetIfBlank(z.string().min(12, 'SUPERADMIN_PASSWORD must be at least 12 characters').optional()),
}).refine((c) => !c.SUPERADMIN_EMAIL === !c.SUPERADMIN_PASSWORD, {
  message: 'Set both SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD, or neither',
  path: ['SUPERADMIN_PASSWORD'],
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** Reads and validates env lazily so tests / dev scripts can set it up first. */
export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment configuration:\n${msg}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
