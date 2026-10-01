import { existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/** A real PostgreSQL server for development and tests (no Docker or local install needed). */
export async function startEmbeddedPostgres(opts: { dataDir: string; port: number; persistent: boolean }) {
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    user: 'postgres',
    password: 'postgres',
    port: opts.port,
    persistent: opts.persistent,
    onLog: () => undefined,
    onError: () => undefined,
  });
  if (!existsSync(join(opts.dataDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  return {
    adminUrl: `postgres://postgres:postgres@127.0.0.1:${opts.port}/postgres`,
    stop: () => pg.stop(),
  };
}
