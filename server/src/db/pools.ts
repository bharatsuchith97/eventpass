import pg from 'pg';
import { config } from '../config';

const { Pool } = pg;
export type Db = pg.Pool;
export type Tx = pg.PoolClient;

// int8 (count(*)) -> number. We never store integers beyond 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

let shared: pg.Pool | undefined;

/** The single connection pool for the shared database. Company scoping happens in every query (company_id). */
export function pool(): pg.Pool {
  if (!shared) {
    shared = new Pool({ connectionString: config().DATABASE_URL, max: config().DB_POOL_MAX });
    shared.on('error', () => undefined); // idle client errors must not crash the process
  }
  return shared;
}

/**
 * Create the database named in DATABASE_URL if it does not exist yet (local dev and tests).
 * Managed PostgreSQL services already have it, so a missing CREATEDB permission never matters there.
 */
export async function ensureDatabase(): Promise<void> {
  try {
    await pool().query('SELECT 1');
    return;
  } catch (e) {
    if ((e as { code?: string }).code !== '3D000') throw e; // 3D000 = database does not exist
  }
  await closePool();
  const url = new URL(config().DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres';
  const maintenance = new pg.Client({ connectionString: url.toString() });
  await maintenance.connect();
  try {
    await maintenance.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  } finally {
    await maintenance.end();
  }
}

export async function closePool(): Promise<void> {
  await shared?.end().catch(() => undefined);
  shared = undefined;
}

/** Run fn inside a transaction. */
export async function withTx<T>(db: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const out = await fn(tx);
    await tx.query('COMMIT');
    return out;
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    tx.release();
  }
}
