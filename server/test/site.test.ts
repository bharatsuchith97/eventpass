import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { getApp } from './helpers';

describe('public site and crawlers', () => {
  it('robots.txt keeps crawlers away from tokens and private areas, and points at the sitemap', async () => {
    const res = await request(await getApp()).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const path of ['/api/', '/pass/', '/checkin', '/admin']) expect(res.text).toContain(`Disallow: ${path}`);
    expect(res.text).toContain('Sitemap: http://localhost:5173/sitemap.xml');
  });

  it('sitemap.xml lists the landing page', async () => {
    const res = await request(await getApp()).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<loc>http://localhost:5173/</loc>');
  });

  describe('with a built web app', () => {
    const dist = mkdtempSync(join(tmpdir(), 'eventpass-dist-'));
    const prev = process.env.WEB_DIST;
    beforeAll(async () => {
      await getApp(); // databases ready
      writeFileSync(join(dist, 'index.html'), '<link rel="canonical" href="__APP_URL__/"><h1>Landing</h1>');
      writeFileSync(join(dist, 'app.html'), '<div id="root"></div>');
      process.env.WEB_DIST = dist;
    });
    afterAll(() => {
      process.env.WEB_DIST = prev;
      rmSync(dist, { recursive: true, force: true });
    });

    it('serves the indexable landing page at / with the real site URL', async () => {
      const res = await request(createApp()).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<link rel="canonical" href="http://localhost:5173/">');
      expect(res.headers['x-robots-tag']).toBeUndefined();
    });

    it('serves the app shell, marked noindex, for app and pass routes', async () => {
      const app = createApp();
      for (const path of ['/login', '/dashboard', '/admin', `/pass/acme/${'a'.repeat(64)}`]) {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);
        expect(res.text).toContain('<div id="root">');
        expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      }
    });
  });
});
