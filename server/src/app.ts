import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { csrfGuard, errorHandler, globalLimiter, notFoundHandler } from './middleware/http';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config().TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' }, // pass links carry a secret token
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config().NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  // Camera access is needed for the scanner on our own origin only.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });

  app.use('/api', globalLimiter);
  app.use('/api/guests/import', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', csrfGuard, apiRouter());
  app.use('/api', notFoundHandler);

  // Crawlers: index the public landing page only. Pass and check-in URLs carry secret tokens.
  // Origin only: safe to drop into HTML attributes, JSON-LD and XML without escaping.
  const siteUrl = new URL(config().APP_URL).origin;
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
      ['User-agent: *', 'Disallow: /api/', 'Disallow: /pass/', 'Disallow: /checkin', 'Disallow: /admin', 'Disallow: /app.html', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n'),
    );
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        `  <url><loc>${siteUrl}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n` +
        '</urlset>\n',
    );
  });

  // In production the API also serves the built web app: the static landing page at "/", the React app elsewhere.
  const dist = resolve(process.env.WEB_DIST ?? join(process.cwd(), '../web/dist'));
  if (existsSync(join(dist, 'index.html')) && existsSync(join(dist, 'app.html'))) {
    const landing = readFileSync(join(dist, 'index.html'), 'utf8').replaceAll('__APP_URL__', siteUrl);
    app.get(['/', '/index.html'], (_req, res) => {
      res.type('html').set('Cache-Control', 'public, max-age=300').send(landing);
    });
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.set('X-Robots-Tag', 'noindex, nofollow').sendFile(join(dist, 'app.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
