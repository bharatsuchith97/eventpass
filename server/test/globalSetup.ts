import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEmbeddedPostgres } from '../src/dev/embeddedPg';

/** One throw-away PostgreSQL for the whole run; each test file provisions its own tenants inside it. */
export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'eventpass-test-'));
  const port = 56000 + Math.floor(Math.random() * 2000);
  const pg = await startEmbeddedPostgres({ dataDir: join(dir, 'pg'), port, persistent: false });
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = pg.adminUrl.replace(/\/postgres$/, '/eventpass_test');
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.LOG_LEVEL = 'silent';
  process.env.APP_URL = 'http://localhost:5173';
  process.env.SUPERADMIN_EMAIL = 'root@example.com';
  process.env.SUPERADMIN_PASSWORD = 'SuperSecret-42x';
  return async () => {
    await pg.stop().catch(() => undefined);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
}
