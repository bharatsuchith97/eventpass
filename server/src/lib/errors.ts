import { ZodError, type ZodTypeAny, type z } from 'zod';

export type ErrorCode =
  | 'INVALID_TICKET'
  | 'TICKET_EXPIRED'
  | 'TICKET_ALREADY_USED'
  | 'TICKET_CANCELLED'
  | 'EVENT_NOT_ACTIVE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TENANT_NOT_FOUND'
  | 'GUEST_NOT_FOUND'
  | 'USER_DISABLED'
  | 'PENDING_APPROVAL'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PLAN_LIMIT'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (msg = 'Authentication required') => new AppError('UNAUTHORIZED', 401, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError('FORBIDDEN', 403, msg);
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found`);
export const conflict = (msg: string) => new AppError('CONFLICT', 409, msg);
export const validation = (msg: string, details?: unknown) => new AppError('VALIDATION_ERROR', 400, msg, details);

/** Parse untrusted input with a Zod schema, throwing a client-safe VALIDATION_ERROR. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw zodToAppError(r.error);
  return r.data;
}

export function zodToAppError(err: ZodError): AppError {
  const issues = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  return validation('Some fields are invalid', { issues });
}
