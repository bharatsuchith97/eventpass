import express, { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pools';
import { AppError, notFound, parse } from '../lib/errors';
import {
  asyncHandler, authenticate, authLimiter, clearSessionCookie, ctxOf, idParam, pagination, publicLimiter, requirePermission, setSessionCookie,
} from '../middleware/http';
import { listAuditLogs } from '../services/audit';
import * as auth from '../services/auth';
import { adminRouter } from './admin';
import * as checkin from '../services/checkin';
import * as events from '../services/events';
import * as guests from '../services/guests';
import * as pub from '../services/public';
import * as reports from '../services/reports';
import * as settings from '../services/settings';
import * as tickets from '../services/tickets';
import * as users from '../services/users';

export function apiRouter(): Router {
  const r = Router();
  const wrap = asyncHandler;

  // ---- Public (no session) ----------------------------------------------
  r.post('/auth/register', authLimiter, wrap(async (req, res) => {
    const { requestId } = await auth.register(req.body);
    res.status(202).json({ requestId, status: 'PENDING' }); // no session until a superadmin approves
  }));
  r.post('/auth/login', authLimiter, wrap(async (req, res) => {
    const { token } = await auth.login(req.body);
    setSessionCookie(res, token);
    const ctx = await auth.loadContext(token, req.ip);
    res.json({ user: await auth.sessionUser(ctx) });
  }));
  r.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });
  r.post('/auth/forgot-password', authLimiter, wrap(async (req, res) => {
    await auth.requestPasswordReset(req.body);
    res.json({ ok: true }); // same response whether or not the account exists
  }));
  r.post('/auth/reset-password', authLimiter, wrap(async (req, res) => {
    await auth.resetPassword(req.body);
    res.json({ ok: true });
  }));
  r.get('/public/pass/:slug/:token', publicLimiter, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await pub.getPublicPass(String(req.params.slug), String(req.params.token)));
  }));
  r.get('/public/logo/:slug', publicLimiter, wrap(async (req, res) => {
    const logo = await settings.publicLogo(pool(), String(req.params.slug));
    // Logo URLs carry ?v=<upload time>, so a long cache is safe; cross-origin so email clients may load it too.
    res.set({ 'Content-Type': logo.mime, 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(logo.data);
  }));
  r.post('/public/pass/:slug/:token/rsvp', publicLimiter, wrap(async (req, res) => {
    res.json(await pub.publicRsvp(String(req.params.slug), String(req.params.token), req.body));
  }));

  // ---- Superadmin (own cookie, own middleware) -----------------------------
  r.use('/admin', adminRouter());

  // ---- Everything below requires a session -------------------------------
  r.use(authenticate);

  r.get('/auth/me', wrap(async (req, res) => {
    res.json({ user: await auth.sessionUser(ctxOf(req)) });
  }));
  r.post('/auth/change-password', wrap(async (req, res) => {
    const { token } = await auth.changePassword(ctxOf(req), req.body);
    setSessionCookie(res, token);
    res.json({ ok: true });
  }));

  // Company settings / users / audit
  r.get('/company/settings', wrap(async (req, res) => res.json(await settings.getSettings(ctxOf(req)))));
  r.put('/company/settings', requirePermission('company:manage'), wrap(async (req, res) => res.json(await settings.updateSettings(ctxOf(req), req.body))));
  r.put(
    '/company/logo',
    requirePermission('company:manage'),
    express.raw({ type: ['image/png', 'image/jpeg'], limit: settings.MAX_LOGO_BYTES }),
    wrap(async (req, res) => res.json(await settings.setLogo(ctxOf(req), req.body))),
  );
  r.delete('/company/logo', requirePermission('company:manage'), wrap(async (req, res) => res.json(await settings.removeLogo(ctxOf(req)))));
  r.get('/users', requirePermission('users:manage'), wrap(async (req, res) => res.json({ items: await users.listUsers(ctxOf(req)) })));
  r.post('/users', requirePermission('users:manage'), wrap(async (req, res) => res.status(201).json(await users.createUser(ctxOf(req), req.body))));
  r.patch('/users/:id', requirePermission('users:manage'), wrap(async (req, res) => res.json(await users.updateUser(ctxOf(req), idParam(req), req.body))));
  r.get('/audit-logs', requirePermission('audit:view'), wrap(async (req, res) => {
    const q = z.object({ action: z.string().max(40).optional(), entityType: z.string().max(40).optional() }).parse(req.query);
    res.json(await listAuditLogs(ctxOf(req), { ...pagination(req), ...q }));
  }));

  // Events
  r.get('/events', requirePermission('events:read'), wrap(async (req, res) => {
    const q = z.object({ status: z.string().max(20).optional(), search: z.string().max(100).optional() }).parse(req.query);
    res.json({ items: await events.listEvents(ctxOf(req), q) });
  }));
  r.post('/events', requirePermission('events:write'), wrap(async (req, res) => res.status(201).json(await events.createEvent(ctxOf(req), req.body))));
  r.get('/events/:id', requirePermission('events:read'), wrap(async (req, res) => res.json(await events.getEvent(ctxOf(req), idParam(req)))));
  r.patch('/events/:id', requirePermission('events:write'), wrap(async (req, res) => res.json(await events.updateEvent(ctxOf(req), idParam(req), req.body))));
  r.post('/events/:id/status', requirePermission('events:write'), wrap(async (req, res) => {
    const { action } = parse(z.object({ action: z.string().max(20) }), req.body);
    res.json(await events.changeEventStatus(ctxOf(req), idParam(req), action));
  }));
  r.post('/events/:id/duplicate', requirePermission('events:write'), wrap(async (req, res) => res.status(201).json(await events.duplicateEvent(ctxOf(req), idParam(req)))));
  r.get('/events/:id/managers', requirePermission('events:read'), wrap(async (req, res) => res.json({ items: await events.listManagers(ctxOf(req), idParam(req)) })));
  r.put('/events/:id/managers', requirePermission('users:manage'), wrap(async (req, res) => res.json({ items: await events.setManagers(ctxOf(req), idParam(req), req.body) })));
  r.get('/events/:id/stats', requirePermission('reports:view'), wrap(async (req, res) => res.json(await events.eventStats(ctxOf(req), idParam(req)))));

  // Tickets & invitations
  r.get('/events/:id/tickets', requirePermission('tickets:manage'), wrap(async (req, res) => res.json(await tickets.listEventTickets(ctxOf(req), idParam(req), req.query))));
  r.post('/events/:id/tickets', requirePermission('tickets:manage'), wrap(async (req, res) => res.status(201).json(await tickets.issueTickets(ctxOf(req), idParam(req), req.body))));
  r.post('/tickets/:id/cancel', requirePermission('tickets:manage'), wrap(async (req, res) => res.json(await tickets.cancelTicket(ctxOf(req), idParam(req)))));
  r.get('/tickets/:id/pass', requirePermission('tickets:manage'), wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await tickets.getTicketPass(ctxOf(req), idParam(req)));
  }));
  r.post('/tickets/:id/reissue', requirePermission('tickets:manage'), wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await tickets.reissueTicket(ctxOf(req), idParam(req)));
  }));
  r.post('/tickets/:id/pass-pdf', requirePermission('tickets:manage'), wrap(async (req, res) => {
    const { pdf, filename } = await tickets.ticketPassPdf(ctxOf(req), idParam(req));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }).send(pdf);
  }));
  r.post('/events/:id/invitations', requirePermission('invitations:send'), wrap(async (req, res) => res.json(await tickets.sendInvitations(ctxOf(req), idParam(req), req.body))));
  r.get('/invitations', requirePermission('invitations:send'), wrap(async (req, res) => {
    const q = z.object({ eventId: z.string().uuid().optional() }).parse(req.query);
    res.json(await tickets.listInvitations(ctxOf(req), { ...q, ...pagination(req) }));
  }));

  // Guests
  r.get('/guests', requirePermission('guests:manage'), wrap(async (req, res) => {
    const q = z.object({ search: z.string().trim().max(100).optional(), category: z.enum(guests.CATEGORIES).optional() }).parse(req.query);
    res.json(await guests.listGuests(ctxOf(req), { ...q, ...pagination(req) }));
  }));
  r.post('/guests', requirePermission('guests:manage'), wrap(async (req, res) => res.status(201).json(await guests.createGuest(ctxOf(req), req.body))));
  r.post('/guests/import/preview', requirePermission('guests:manage'), wrap(async (req, res) => res.json(await guests.previewImport(ctxOf(req), req.body))));
  r.post('/guests/import/commit', requirePermission('guests:manage'), wrap(async (req, res) => res.status(201).json(await guests.commitImport(ctxOf(req), req.body))));
  r.post('/guests/bulk-delete', requirePermission('guests:manage'), wrap(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }), req.body);
    res.json(await guests.deleteGuests(ctxOf(req), ids));
  }));
  r.get('/guests/export.csv', requirePermission('guests:export'), wrap(async (req, res) => {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="guests.csv"', 'Cache-Control': 'no-store' }).send(await guests.exportGuestsCsv(ctxOf(req)));
  }));
  r.get('/guests/:id', requirePermission('guests:manage'), wrap(async (req, res) => res.json(await guests.getGuest(ctxOf(req), idParam(req)))));
  r.patch('/guests/:id', requirePermission('guests:manage'), wrap(async (req, res) => res.json(await guests.updateGuest(ctxOf(req), idParam(req), req.body))));
  r.delete('/guests/:id', requirePermission('guests:manage'), wrap(async (req, res) => {
    const out = await guests.deleteGuests(ctxOf(req), [idParam(req)]);
    if (!out.deleted) throw new AppError('GUEST_NOT_FOUND', 404, 'Guest not found');
    res.json(out);
  }));

  // Check-in
  r.post('/checkin', requirePermission('checkin:scan'), wrap(async (req, res) => res.json(await checkin.scanCheckIn(ctxOf(req), req.body))));
  r.post('/checkin/manual', requirePermission('checkin:scan'), wrap(async (req, res) => res.json(await checkin.manualCheckIn(ctxOf(req), req.body))));
  r.get('/checkin/search', requirePermission('checkin:scan'), wrap(async (req, res) => {
    const q = z.object({ eventId: z.string().uuid(), q: z.string().max(100) }).parse(req.query);
    res.json({ items: await checkin.searchForCheckin(ctxOf(req), q.eventId, q.q) });
  }));
  r.get('/events/:id/checkins', requirePermission('checkin:scan'), wrap(async (req, res) => res.json(await checkin.listCheckins(ctxOf(req), idParam(req), pagination(req)))));

  // Reports
  r.get('/events/:id/reports/:kind', requirePermission('reports:view'), wrap(async (req, res) => {
    const report = await reports.buildReport(ctxOf(req), idParam(req), String(req.params.kind));
    if (req.query.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${report.kind}-report.csv"`, 'Cache-Control': 'no-store' }).send(reports.reportToCsv(report));
      return;
    }
    res.json(report);
  }));

  // Integrations are designed for (interface stub); Google Sheets ships after the MVP.
  r.get('/integrations', requirePermission('integrations:manage'), wrap(async (req, res) => {
    res.json({ items: [{ id: 'google-sheets', name: 'Google Sheets', status: 'COMING_SOON', available: ctxOf(req).features.googleSheets === true }] });
  }));

  r.use((_req, _res, next) => next(notFound('Endpoint')));
  return r;
}
