/**
 * Local development runner: starts an embedded PostgreSQL, generates persistent dev secrets on first run,
 * then boots the API. Data lives in server/.dev (git-ignored). NOT for production.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), '.dev');
mkdirSync(root, { recursive: true });
const secretsFile = join(root, 'dev-secrets.json');
if (!existsSync(secretsFile)) {
  writeFileSync(secretsFile, JSON.stringify({ jwt: randomBytes(48).toString('hex') }));
}
const s = JSON.parse(readFileSync(secretsFile, 'utf8')) as { jwt: string; superadmin?: string };
if (!s.superadmin) {
  // Added to older dev-secrets.json files too, so existing dev setups get a superadmin without resetting.
  s.superadmin = randomBytes(12).toString('base64url');
  writeFileSync(secretsFile, JSON.stringify(s));
}

const { startEmbeddedPostgres } = await import('../src/dev/embeddedPg');
const pgPort = Number(process.env.DEV_PG_PORT ?? 5544);
const pg = await startEmbeddedPostgres({ dataDir: join(root, 'pgdata'), port: pgPort, persistent: true });

process.env.NODE_ENV ??= 'development';
// The shared database "eventpass" is created on first start. (Databases from the earlier one-database-per-company
// design may still exist in this local server; they are no longer used.)
process.env.DATABASE_URL ??= pg.adminUrl.replace(/\/postgres$/, '/eventpass');
process.env.JWT_SECRET ??= s.jwt;
process.env.PORT ??= '4000';
process.env.SUPERADMIN_EMAIL ??= 'admin@eventpass.local';
process.env.SUPERADMIN_PASSWORD ??= s.superadmin;

const { startServer } = await import('../src/server');
const { stop } = await startServer();
// Only echo the generated dev password, never one supplied by the environment.
const shownPassword = process.env.SUPERADMIN_PASSWORD === s.superadmin ? s.superadmin : '<from SUPERADMIN_PASSWORD>';
console.log(`Superadmin: ${process.env.APP_URL ?? 'http://localhost:5173'}/admin  ${process.env.SUPERADMIN_EMAIL} / ${shownPassword}`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await stop().catch(() => undefined);
  await pg.stop().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
