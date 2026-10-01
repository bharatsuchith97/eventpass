# Inviteley

Event guest management and QR check-in for companies: guest lists, personal QR passes, email invitations, RSVP, door check-in and reports.

**Live:** https://inviteley.com · **Docs:** [technical reference](docs/technical-reference.md) · [architecture diagrams](docs/architecture.html) · [deploy guide](DEPLOY.md)

- **Multi-tenant:** many companies share one installation and one PostgreSQL database. Every company-owned row carries `company_id`, every query is scoped to the company in the session, and composite foreign keys stop rows of different companies from being linked.
- **Approved sign-ups:** companies request access; a platform superadmin approves them at `/admin` before anything is created.
- **Public landing page** at `/` (static, SEO-friendly HTML); the React app serves everything else.

## Features

| Area | What it does |
|---|---|
| Guests | Add or import from CSV (preview with row-level errors, duplicate checks), your own **guest ID** per guest, notes, categories (VIP, speaker, ...), search by name, email, phone or ID, soft delete, CSV export that can be re-imported |
| Passes | One QR pass per guest per event; digital pass, printable page and PDF. The **same QR** is kept when a pass is shown, downloaded or re-sent; **Issue new QR** replaces a lost or shared one |
| Invitations | Email with the QR pass inline, RSVP from the guest's pass page, sent/opened tracking, failed sends reported in the app and logs |
| Check-in | Phone camera scanning or search by name/guest ID; full-screen green / amber / red result; each pass checks in exactly once, even with simultaneous scans |
| Reports | Live dashboard; **Complete** report (one row per guest per pass with every guest field, notes, RSVP, invitation and check-in details), attendance, no-shows, RSVP; per event or across all events, as CSV |
| Branding | Company logo (centred on passes, PDFs, emails, the guest pass page and the app header) and brand colour (colour picker) |
| Team | Company admin, event manager and check-in staff roles; audit log |
| Platform | Superadmin console: approve/reject sign-ups, suspend/reactivate companies, change plans (Starter 3 events / 500 guests per event, Business 50 / 5,000, Enterprise unlimited) |

## Run it locally (no Docker, no PostgreSQL install)

```bash
npm install
npm run dev       # API on :4000 with a real embedded PostgreSQL (data in server/.dev)
npm run dev:web   # web app on http://localhost:5173 (proxies /api to :4000)
```

1. Open http://localhost:5173 and choose **Request access**.
2. Approve it as the superadmin at http://localhost:5173/admin. The dev login is printed in the API console on startup and kept in `server/.dev/dev-secrets.json`.
3. Sign in as the new company's admin.

In development, emails are printed to the API console instead of being sent.

| Command | What it does |
|---|---|
| `npm test` | 81 server tests against a real throw-away PostgreSQL |
| `npm run typecheck` | Strict TypeScript, both packages |
| `npm run lint` | ESLint (`any` is an error) |
| `npm run build` | Server bundle and web app |
| `npm run migrate:status` / `npm run migrate` | Show / apply database migrations (they also run on every start) |

## Deploying

Full guide: **[DEPLOY.md](DEPLOY.md)**.

- **Option A, used for inviteley.com:** Render runs the `Dockerfile` (`render.yaml`), Neon hosts PostgreSQL, Brevo sends email.
- **Option B:** one server (e.g. a free Oracle Cloud VM) with `docker compose up -d --build`: Caddy for automatic HTTPS, the app, and PostgreSQL. `deploy/backup.sh` and `deploy/restore.sh` back up and restore the database.

**Continuous integration** (`.github/workflows/ci.yml`): every push and pull request runs typecheck, lint, the tests and the web build. Pushes to `main` that pass trigger Render's deploy hook (`RENDER_DEPLOY_HOOK_URL` repository secret); Render's own auto-deploy is off, so failing commits never go live.

### Configuration

All settings are environment variables, validated at start-up (`server/src/config.ts`). See `.env.example` for the full list.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (any ordinary login; no special permissions) |
| `APP_URL` | Public address, e.g. `https://inviteley.com`; used in emailed links, the sitemap and CSRF checks |
| `JWT_SECRET` | Signs sessions and derives the key that encrypts stored QR tokens. **Don't change it** once passes are sent |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | Platform superadmin, created or updated on every start |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email. On start the app logs `[mail] SMTP connection OK` or the exact failure |
| `TRUST_PROXY` | Number of proxies in front of the app (1 on Render or behind Caddy) |

## Project layout

```
server/                Express + TypeScript (strict), pg, Zod
  src/services/        all business logic and authorization (routes are thin)
  src/db/migrations/   numbered SQL migrations (001–004), applied on start
  src/lib/             permissions matrix, crypto, pass-token encryption, CSV
  test/                Vitest suites against an embedded PostgreSQL
web/                   React 18 + TypeScript + MUI + TanStack Query + React Hook Form + Zod
  index.html           public landing page (static HTML + src/landing/), indexable, no React
  app.html             shell of the React app, served for every other route with noindex
deploy/                Caddyfile, backup and restore scripts
docs/                  technical reference and architecture diagrams
render.yaml            Render service definition
.github/workflows/     CI and deploy
```

The repository and some internal names (package names, cookie names, the database name) still say `eventpass`, the product's earlier name. They are deliberately unchanged: renaming them would sign everyone out or create a second Render service.

## How it works (short version)

- **Company scoping:** session cookie → user → their company, its status and plan (one query) → a `Ctx` with `companyId` that every service uses. The company is never read from the request.
- **Sign-up approval:** registering only stores a request with the password already hashed. Approval runs in one transaction: claim the request (`UPDATE … WHERE status = 'PENDING'`), create the company, its settings and first admin.
- **QR passes:** 32 random bytes; the QR holds only `https://<app>/checkin/<token>`, no personal data. Check-in looks passes up by `SHA-256(token)`; the token is also stored encrypted (AES-256-GCM), so a copy of the database alone cannot produce working passes.
- **Check-in:** one transaction locks the ticket row, re-checks status, expiry and event, then inserts the check-in, guarded by `UNIQUE(ticket_id)`.
- **Guest pass page** (`/pass/<company-slug>/<token>`): no login; shows only the event and that guest's own pass, and lets them RSVP.
- **SEO:** the landing page carries meta, Open Graph and JSON-LD (`SoftwareApplication`, `FAQPage`); the server generates `robots.txt` and `sitemap.xml` from `APP_URL`; every app page is `noindex`, because pass links carry secret tokens.

Details for each of these, plus every API route and table, are in the [technical reference](docs/technical-reference.md).

## Security controls

Sessions in `HttpOnly`, `SameSite=Strict`, `Secure` cookies with a password-version claim (changing a password signs out other sessions) · separate superadmin cookie and token audience · CSRF header + Origin check on every state-changing request · server-side permission matrix (`server/src/lib/permissions.ts`) · Zod validation on all input · parameterised SQL · Helmet/CSP, `Referrer-Policy: no-referrer` · rate limiting · bcrypt password hashing · no account enumeration on sign-in or password reset · uploaded logos checked by their bytes, not their name · CSV formula-injection guard · masked emails at the door · audit log without personal data or tokens · errors never expose internals.

## Not built yet / known gaps

- **Not built:** magic-link and Google sign-in, SSO, Excel/PDF report export, Google Sheets (placeholder only), billing, Apple/Google Wallet, WhatsApp, offline check-in.
- CSV import only; Excel files must be saved as CSV first.
- Company isolation is enforced in application code plus composite foreign keys; PostgreSQL row-level security is the natural next hardening step.
- The tests cover the server only. The web app has no automated tests; it has been checked by hand and with browser scripts.
- Rate limits are counted in memory, per process.
- Email "opened" means the guest visited their pass page; there is no tracking pixel.

## Windows note

If `npm install` fails during esbuild's post-install step (very long paths or antivirus locks), use `npm install --ignore-scripts`. Windows cannot start executables whose path exceeds 260 characters, so keep the project in a short path.
