import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
}

function here(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/** Migration directory (only the *.sql files directly inside it). MIGRATIONS_DIR overrides for bundled/production layouts. */
export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? join(here(), 'migrations');
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const out: Migration[] = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8');
    const [up = '', down = ''] = text.split(/^-- @down\s*$/m);
    const m = /^(\d+)_(.+)\.sql$/.exec(f)!;
    out.push({ version: m[1]!, name: m[2]!, up, down });
  }
  return out;
}

const LOCK_KEY = 727_001;

async function ensureTable(db: pg.Pool | pg.PoolClient): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
}

export async function appliedVersions(db: pg.Pool): Promise<string[]> {
  await ensureTable(db);
  const r = await db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  return r.rows.map((x) => x.version);
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  latest: string | null;
}

export async function status(db: pg.Pool, dir: string): Promise<MigrationStatus> {
  const all = await loadMigrations(dir);
  const applied = await appliedVersions(db);
  return {
    applied,
    pending: all.filter((m) => !applied.includes(m.version)).map((m) => m.version),
    latest: all.at(-1)?.version ?? null,
  };
}

/** Apply all pending migrations in order, each in its own transaction, serialised by an advisory lock. */
export async function migrateUp(db: pg.Pool, dir: string): Promise<string[]> {
  const all = await loadMigrations(dir);
  const client = await db.connect();
  const ran: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    const done = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
    );
    for (const m of all) {
      if (done.has(m.version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.up);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
        await client.query('COMMIT');
        ran.push(m.version);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${m.version}_${m.name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return ran;
}

/** Roll back the most recent `steps` migrations (where a @down section exists). */
export async function migrateDown(db: pg.Pool, dir: string, steps = 1): Promise<string[]> {
  const all = await loadMigrations(dir);
  const applied = await appliedVersions(db);
  const targets = applied.slice(-steps).reverse();
  const rolled: string[] = [];
  for (const v of targets) {
    const m = all.find((x) => x.version === v);
    if (!m || !m.down.trim()) throw new Error(`Migration ${v} has no down script`);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.down);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [v]);
      await client.query('COMMIT');
      rolled.push(v);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  return rolled;
}
