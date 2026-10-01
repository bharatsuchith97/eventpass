/**
 * Migration CLI for the shared database.
 *   migrate up        apply pending migrations
 *   migrate status    show applied / pending (exit code 1 if anything is pending)
 *   migrate down      roll back the latest migration
 */
import 'dotenv/config';
import { migrateDown, migrateUp, migrationsDir, status } from '../src/db/migrator';
import { closePool, ensureDatabase, pool } from '../src/db/pools';

const cmd = process.argv[2] ?? 'status';

try {
  await ensureDatabase();
  if (cmd === 'up') {
    console.log('applied:', await migrateUp(pool(), migrationsDir()));
  } else if (cmd === 'status') {
    const s = await status(pool(), migrationsDir());
    console.log(`applied=${s.applied.length} pending=[${s.pending}] latest=${s.latest}`);
    if (s.pending.length) process.exitCode = 1;
  } else if (cmd === 'down') {
    console.log('rolled back:', await migrateDown(pool(), migrationsDir()));
  } else {
    console.error('Usage: migrate [up|status|down]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
