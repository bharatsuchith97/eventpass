import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { migrateUp, migrationsDir } from './db/migrator';
import { closePool, ensureDatabase, pool } from './db/pools';
import { syncBootstrapAdmin } from './services/platform';

/** Bring the shared database up to the latest schema. No manual DB steps needed. */
export async function prepareDatabases(): Promise<void> {
  await ensureDatabase();
  const ran = await migrateUp(pool(), migrationsDir());
  if (ran.length) console.log(`[migrate] applied ${ran.join(', ')}`);
  await syncBootstrapAdmin();
}

export async function startServer(): Promise<{ server: Server; stop: () => Promise<void> }> {
  await prepareDatabases();
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(config().PORT, () => resolve(s));
  });
  console.log(`EventPass API listening on :${config().PORT}`);
  const stop = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await closePool();
  };
  return { server, stop };
}
