import { Router } from 'express';
import { notFound } from '../lib/errors';
import {
  ADMIN_COOKIE_NAME, adminOf, asyncHandler, authenticateAdmin, authLimiter, clearSessionCookie, idParam, setSessionCookie,
} from '../middleware/http';
import * as platform from '../services/platform';

/** Superadmin API, mounted at /api/admin. Separate cookie and token audience from tenant sessions. */
export function adminRouter(): Router {
  const r = Router();
  const wrap = asyncHandler;

  r.post('/login', authLimiter, wrap(async (req, res) => {
    const { token, admin } = await platform.adminLogin(req.body);
    setSessionCookie(res, token, ADMIN_COOKIE_NAME);
    res.json({ admin: { id: admin.adminId, email: admin.email } });
  }));
  r.post('/logout', (_req, res) => {
    clearSessionCookie(res, ADMIN_COOKIE_NAME);
    res.json({ ok: true });
  });

  r.use(authenticateAdmin);

  r.get('/me', (req, res) => {
    const a = adminOf(req);
    res.json({ admin: { id: a.adminId, email: a.email } });
  });
  r.get('/requests', wrap(async (req, res) => res.json({ items: await platform.listRequests(req.query) })));
  r.post('/requests/:id/approve', wrap(async (req, res) => res.json(await platform.approveRequest(adminOf(req), idParam(req)))));
  r.post('/requests/:id/reject', wrap(async (req, res) => res.json(await platform.rejectRequest(adminOf(req), idParam(req), req.body))));
  r.get('/companies', wrap(async (_req, res) => res.json({ items: await platform.listCompanies() })));
  r.patch('/companies/:id', wrap(async (req, res) => res.json(await platform.updateCompany(idParam(req), req.body))));
  r.get('/plans', wrap(async (_req, res) => res.json({ items: await platform.listPlans() })));

  // Never fall through to the tenant routes (and their session cookie).
  r.use((_req, _res, next) => next(notFound('Endpoint')));
  return r;
}
