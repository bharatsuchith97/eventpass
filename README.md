# Inviteley

Multi-tenant event management and QR check-in. All companies share **one PostgreSQL database**; every company-owned row carries `company_id`, every query is scoped to the company in the session, and composite foreign keys stop rows of different companies from being linked.

## Run it locally (no Docker, no Postgres install)

```bash
npm install --ignore-scripts   # see "Windows note" below if a normal install fails
npm run dev                    # API on :4000 with a real embedded PostgreSQL (data in server/.dev)
npm run dev:web                # web app on http://localhost:5173 (proxies /api to :4000)
```

Open http://localhost:5173, choose **Request a company account**, then approve it as the superadmin at http://localhost:5173/admin (the dev login is printed in the API console on startup and stored in `server/.dev/dev-secrets.json`). After approval you can sign in as the new company's admin.
In development, emails (invitations, password reset, approvals) are printed to the API console instead of being sent.

```bash
npm test               # 69 tests against a real throw-away PostgreSQL
npm run typecheck      # strict TypeScript, both packages
npm run lint           # ESLint (no `any` allowed)
npm run migrate:status # applied / pending migrations
npm run migrate        # apply pending migrations
```

## Production

**Step-by-step guide: [DEPLOY.md](DEPLOY.md)**: Option A, Render + Neon (`render.yaml`, recommended); Option B, one free Oracle Cloud VM with Docker Compose. Option B in short:

```bash
cp .env.example .env    # fill in DOMAIN, DB_PASSWORD, JWT_SECRET, SUPERADMIN_*, SMTP_URL
docker compose up -d --build
```

`docker-compose.yml` runs Caddy (automatic Let's Encrypt HTTPS for `DOMAIN`), the app and PostgreSQL; only Caddy's ports 80/443 are published.
Set `DATABASE_URL` to use a managed PostgreSQL (Supabase, Neon, Render, ...) instead of the bundled container; no special database permissions are needed. Migrations run automatically on boot.
`deploy/backup.sh` dumps the database; `deploy/restore.sh` restores a dump.

## Architecture

Diagrams (deployment, request path, signup approval, creating a company, QR check-in, keeping companies apart, roles): open [docs/architecture.html](docs/architecture.html) in a browser.
Full technical reference (stack and versions, configuration, data model, business rules, every API route, security controls, tests): [docs/technical-reference.md](docs/technical-reference.md).

```
server/  Express + TypeScript (strict), pg, zod
  src/services/   all business logic and authorization (routes are thin)
  src/db/         connection pool, migrator, SQL migrations
web/     React 18 + TypeScript (strict) + MUI + TanStack Query + Zustand + React Hook Form + Zod
  index.html      public landing page: static, server-rendered HTML (+ src/landing/), indexable, no React
  app.html        shell for the signed-in React app, served for every other route with noindex
```

* **Landing page & SEO:** `/` is plain HTML with its own ~7 KB CSS/JS, meta/Open Graph tags and schema.org JSON-LD (`SoftwareApplication`, `FAQPage`). `__APP_URL__` in it is replaced with the `APP_URL` origin when served. The server also generates `/robots.txt` (blocks `/api`, `/pass`, `/checkin`, `/admin`) and `/sitemap.xml`. All app routes are `noindex` (meta tag + `X-Robots-Tag`), since pass links carry secret tokens.

* **Company scoping:** session cookie -> user id -> one query for the user, their company, its status and plan -> `Ctx` with `companyId`. Every service query filters by `ctx.companyId`, which is *never* read from a request. Composite foreign keys on `(company_id, id)` make the database reject, for example, a ticket for one company's event and another company's guest.
* **Signup approval** (`services/platform.ts`): registering only files a `company_requests` row (password already bcrypt-hashed). Nothing is created until a platform superadmin approves it at `/admin`; the requester is emailed either way. Superadmins live in `platform_admins`, use a separate `ep_admin` cookie and a JWT audience that tenant routes reject, and can suspend/reactivate companies and change their plan. They never get access to company data.
* **Approval** (`services/platform.ts` + `services/tenants.ts`): one transaction claims the request (`UPDATE … WHERE status = 'PENDING'`), creates the company, its settings, its first admin and their password hash, and clears the request's copy of the hash. Any failure rolls all of it back.
* **Migrations:** numbered `.sql` files directly in `server/src/db/migrations/` with `-- @down` sections, recorded in `schema_migrations`; an advisory lock prevents concurrent runs.
* **QR tokens:** 32 random bytes (hex). Only `SHA-256(token)` is stored. The QR encodes `https://<app>/checkin/<token>` - no PII, no ids. Because only the hash is kept, showing/downloading/emailing a pass **issues a fresh token** and retires the previous one.
* **Check-in:** one transaction with `SELECT ... FOR UPDATE` on the ticket, re-check of status/expiry/event, `INSERT INTO checkins` guarded by `UNIQUE(ticket_id)`. Concurrency is covered by tests (12 simultaneous scans -> exactly one success).
* **Guest pass page** (`/pass/<company-slug>/<token>`): unauthenticated, shows only event info + the guest's own pass and lets them RSVP. The slug identifies the company without putting a company id in the QR, and lookups are limited to that company.

## Security controls

JWT in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production) with a password-version claim (changing/resetting a password logs out other sessions) - CSRF custom-header + Origin check on every state-changing request - server-side RBAC matrix (`server/src/lib/permissions.ts`) - Zod validation on all input - parameterised SQL everywhere - Helmet/CSP, `Referrer-Policy: no-referrer` - rate limiting (auth, public pass, global) - bcrypt password hashing with constant-time-ish handling of unknown emails - no account enumeration on login / password reset - CSV export formula-injection guard - masked emails on the door-side search - audit log that never stores PII or tokens - errors never expose stack traces or DB details.

## What is in the MVP and what is not

Built: auth (email + password, reset, change password), company settings, team + RBAC, events (draft -> published -> ongoing -> completed/cancelled/archived, duplicate, manager assignment), guests (CRUD, search, validated CSV import with preview and row-level errors, soft delete, CSV export), QR passes (digital pass, printable, PDF), email invitations with open tracking, RSVP, camera scanner + manual search check-in with full-screen green/amber/red results, live event dashboard with charts, attendance / no-show / RSVP reports with CSV export, audit log, plan limits (Starter: 3 active events, 500 guests/event).

Deliberately not built (designed for): magic-link and Google sign-in, Excel/PDF report export, Google Sheets integration (UI placeholder + `integrations:manage` permission only), billing, Apple/Google Wallet, WhatsApp, SSO, custom domains.

Known gaps to be aware of:
* Excel (`.xlsx`) import is not supported - CSV only.
* Company isolation is enforced in application code (every query filters by `company_id`) plus composite foreign keys; PostgreSQL row-level security is not used yet and is the natural next hardening step.
* Camera scanning needs HTTPS (or localhost). It was not exercisable in the automated browser used during development; the manual-search and pasted-code paths were.
* Email open tracking counts a visit to the guest pass page, not a tracking pixel.
* Encryption at rest and TLS are infrastructure concerns (encrypted volumes, managed Postgres, TLS proxy) and are not configured by this repo.

## Windows note

If `npm install` fails while running esbuild's post-install step (it spawns a binary and can fail when the project sits under a very long path or is locked by antivirus), use `npm install --ignore-scripts`. Windows also cannot start executables whose path exceeds 260 characters - keep the project in a short path such as `C:\dev\eventpass`.
