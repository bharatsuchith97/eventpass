import type pg from 'pg';
import type { Ctx } from '../context';
import { AppError } from '../lib/errors';
import { can } from '../lib/permissions';

export type AuditAction =
  | 'USER_CREATED'
  | 'USER_DISABLED'
  | 'USER_UPDATED'
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_CANCELLED'
  | 'EVENT_STATUS_CHANGED'
  | 'GUEST_CREATED'
  | 'GUEST_UPDATED'
  | 'GUEST_DELETED'
  | 'GUEST_IMPORTED'
  | 'GUEST_EXPORTED'
  | 'TICKET_GENERATED'
  | 'TICKET_CANCELLED'
  | 'TICKET_REISSUED'
  | 'INVITATION_SENT'
  | 'CHECKIN_CREATED'
  | 'CHECKIN_REJECTED'
  | 'SETTINGS_UPDATED';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

/** Never put PII (names, emails, raw tokens) in `metadata`; log ids and counts only. */
export async function audit(
  db: Queryable,
  who: { companyId: string; userId: string | null },
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    'INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [who.companyId, who.userId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  action?: string;
  entityType?: string;
}

export async function listAuditLogs(ctx: Ctx, q: AuditQuery) {
  if (!can(ctx.role, 'audit:view')) throw new AppError('FORBIDDEN', 403, 'Only administrators can view audit logs');
  const params: unknown[] = [ctx.companyId];
  const where = ['a.company_id = $1'];
  if (q.action) {
    params.push(q.action);
    where.push(`a.action = $${params.length}`);
  }
  if (q.entityType) {
    params.push(q.entityType);
    where.push(`a.entity_type = $${params.length}`);
  }
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const r = await ctx.db.query(
    `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.timestamp, a.metadata,
            u.email AS "userEmail", count(*) OVER()::int AS total
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.timestamp DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows.map(({ total: _t, ...row }) => row), total: (r.rows[0]?.total as number | undefined) ?? 0 };
}
