import type { Db } from './db/pools';
import type { Role } from './lib/permissions';

/**
 * Everything a service needs to act for one authenticated user inside exactly one company.
 * All companies share one database, so every query MUST filter by `companyId` (or join through a row that does).
 * `companyId` comes only from the session, never from the request.
 */
export interface Ctx {
  userId: string;
  email: string;
  role: Role;
  companyId: string;
  companySlug: string;
  db: Db;
  limits: { maxEvents: number | null; maxGuestsPerEvent: number | null };
  features: Record<string, boolean>;
  ip?: string;
}
