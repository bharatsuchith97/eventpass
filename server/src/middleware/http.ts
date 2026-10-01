import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError, z } from 'zod';
import { config } from '../config';
import type { Ctx } from '../context';
import { AppError, forbidden, notFound, unauthorized, zodToAppError } from '../lib/errors';
import { can, type Permission } from '../lib/permissions';
import { loadContext } from '../services/auth';
import { loadAdmin, type AdminCtx } from '../services/platform';

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: Ctx;
    admin?: AdminCtx;
  }
}

export const COOKIE_NAME = 'ep_session';
/** Superadmin sessions use their own cookie so they never mix with a tenant session in the same browser. */
export const ADMIN_COOKIE_NAME = 'ep_admin';

export function setSessionCookie(res: Response, token: string, name = COOKIE_NAME): void {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config().NODE_ENV === 'production',
    maxAge: config().SESSION_HOURS * 3600_000,
    path: '/',
  });
}
export function clearSessionCookie(res: Response, name = COOKIE_NAME): void {
  res.clearCookie(name, { httpOnly: true, sameSite: 'strict', secure: config().NODE_ENV === 'production', path: '/' });
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/**
 * CSRF defence in depth (on top of SameSite=Strict cookies): every state-changing request must carry a custom
 * header (which cross-site forms cannot set) and, when the browser sends an Origin, it must match our host or APP_URL.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'eventpass') return next(forbidden('Missing CSRF header'));
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([new URL(config().APP_URL).origin, `${req.protocol}://${req.get('host')}`]);
    if (!allowed.has(origin)) return next(forbidden('Cross-origin request blocked'));
  }
  next();
};

/** Authenticate: session cookie -> tenant-bound Ctx. company_id is only ever derived here. */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = (req.cookies as Record<string, string | undefined> | undefined)?.[COOKIE_NAME];
  if (!token) throw unauthorized();
  req.ctx = await loadContext(token, req.ip);
  next();
});

export const authenticateAdmin: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = (req.cookies as Record<string, string | undefined> | undefined)?.[ADMIN_COOKIE_NAME];
  if (!token) throw unauthorized();
  req.admin = await loadAdmin(token);
  next();
});

export function adminOf(req: Request): AdminCtx {
  if (!req.admin) throw unauthorized();
  return req.admin;
}

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.ctx) return next(unauthorized());
    if (!can(req.ctx.role, permission)) return next(forbidden());
    next();
  };

export function ctxOf(req: Request): Ctx {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}

const uuid = z.string().uuid();
/** Route params are untrusted: anything that is not a UUID is simply "not found". */
export function idParam(req: Request, name = 'id'): string {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw notFound();
  return r.data;
}

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const pagination = (req: Request) => pageSchema.parse(req.query);

const skipInTest = () => config().NODE_ENV === 'test' && !process.env.TEST_RATE_LIMIT;
const limitHandler = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError('RATE_LIMITED', 429, 'Too many requests. Please slow down and try again shortly.'));

export const globalLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: skipInTest, handler: limitHandler });
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: skipInTest, handler: limitHandler });
export const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: skipInTest, handler: limitHandler });

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Endpoint'));

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof ZodError) e = zodToAppError(err);
  else if ((err as { type?: string }).type === 'entity.too.large') e = new AppError('VALIDATION_ERROR', 413, 'The request is too large');
  else if ((err as { type?: string }).type === 'entity.parse.failed') e = new AppError('VALIDATION_ERROR', 400, 'Malformed JSON');
  else {
    // Stack goes to server logs only; the client never sees internals.
    if (config().LOG_LEVEL !== 'silent') console.error('[error]', err instanceof Error ? err.stack : err);
    e = new AppError('INTERNAL', 500, 'Something went wrong. Please try again.');
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } });
};
