# EventPass technical reference

Everything about how EventPass is built, in one place: what each part does, the rules the code enforces, and where to find it.
For the diagrams (deployment, request path, approval flow, check-in, data layout, backups), open [architecture.html](architecture.html) in a browser.

**Contents:** [What it is](#1-what-it-is) · [Tech stack](#2-tech-stack) · [Repository layout](#3-repository-layout) · [Running it](#4-running-it) · [Configuration](#5-configuration) · [Multi-tenancy](#6-multi-tenancy-one-database-per-company) · [Sign-in and sessions](#7-sign-in-and-sessions) · [Permissions](#8-permissions-and-plan-limits) · [Data model](#9-data-model) · [Business rules](#10-business-rules) · [API reference](#11-api-reference) · [Web app](#12-web-app) · [Security](#13-security-controls) · [Email](#14-email) · [Tests](#15-tests) · [Build and deploy](#16-build-and-deploy) · [Limits and gaps](#17-limits-and-known-gaps) · [Where to change things](#18-where-to-change-things)

---

## 1. What it is

EventPass is a multi-tenant web app for running events: guest lists, QR passes, email invitations, RSVP, door check-in and attendance reports.

- **Multi-tenant** means many companies use one installation. All companies share **one PostgreSQL database**: every company-owned row has a `company_id`, and every query is limited to the company of the signed-in user.
- New companies **request access** and a **platform superadmin approves** them at `/admin`. The company account is created at approval time.
- It is one server-side program (Node.js + Express) that serves the API, the React web app and a static landing page, plus PostgreSQL. In production both run in Docker behind Caddy for HTTPS.

## 2. Tech stack

Versions are the ones installed from `package-lock.json`.

### Server (`server/`)

| Purpose | Technology | Version |
|---|---|---|
| Runtime | Node.js | 22 (Docker `node:22-alpine`) |
| Language | TypeScript, `strict` | 5.9.3 |
| Web framework | Express | 4.22.3 |
| Database driver | `pg` (node-postgres), connection pools | 8.23.0 |
| Input validation | Zod | 3.25.76 |
| Password hashing | bcryptjs (12 rounds) | 2.4.3 |
| Session tokens | jsonwebtoken (HS256) | 9.0.3 |
| Security headers | helmet | 8.3.0 |
| Rate limiting | express-rate-limit | 7.5.1 |
| Cookies | cookie-parser | 1.4.7 |
| CSV import | csv-parse | 5.6.0 |
| QR images (email + PDF) | qrcode | 1.5.4 |
| PDF passes | pdfkit | 0.15.2 |
| Email | nodemailer (SMTP) | 6.10.1 |
| `.env` loading | dotenv | 16.6.1 |
| Dev/test database | embedded-postgres (real PostgreSQL binaries) | 18.4.0-beta.17 |
| Run TS directly (dev) | tsx | 4.23.15 |
| Production bundle | tsup | 8.5.1 |
| Tests | Vitest + supertest | 2.1.9 / 7.3.0 |

### Web (`web/`)

| Purpose | Technology | Version |
|---|---|---|
| UI library | React | 18.3.1 |
| Components and theme | MUI (Material UI) + Emotion | 6.5.0 / 11.14 |
| Server data (fetching, caching) | TanStack Query | 5.104.0 |
| Local state (scanner settings) | Zustand, persisted to localStorage | 5.0.15 |
| Forms | React Hook Form + Zod resolver | 7.89.0 / 3.10.0 |
| Routing | React Router | 6.30.6 |
| Charts (live dashboard) | Recharts | 2.15.4 |
| QR scanning from the camera | jsQR | 1.4.0 |
| QR rendering on screen | qrcode | 1.5.4 |
| Build tool / dev server | Vite + @vitejs/plugin-react | 5.4.21 / 4.7.0 |

### Tooling and infrastructure

| Purpose | Technology |
|---|---|
| Lint | ESLint 9 + typescript-eslint 8 + react-hooks plugin (`any` is an error) |
| Monorepo | npm workspaces (`server`, `web`) |
| Containers | Docker multi-stage build, Docker Compose |
| Database (production) | PostgreSQL 17 (`postgres:17-alpine`) |
| HTTPS / reverse proxy | Caddy 2 (automatic Let's Encrypt) |

> The root `node_modules` also has TypeScript 6.0.3, pulled in by the lint tooling. The server and web packages compile with their own 5.9.3.

## 3. Repository layout

```
eventpass/
├── package.json              npm workspaces + root scripts (dev, build, test, lint, migrate)
├── Dockerfile                multi-stage: build both packages, ship a small runtime image
├── docker-compose.yml        production stack: caddy + app + db
├── .env.example              every production setting, documented
├── DEPLOY.md                 step-by-step deploy on a free Oracle Cloud VM
├── deploy/
│   ├── Caddyfile             HTTPS for $DOMAIN, proxies to app:4000
│   ├── backup.sh             nightly backup (databases + encrypted credentials)
│   └── restore.sh            restore a backup into a fresh stack
├── docs/
│   ├── architecture.html     diagrams
│   └── technical-reference.md  this file
├── server/
│   ├── scripts/
│   │   ├── dev.ts            local dev: starts embedded PostgreSQL, generates dev keys, runs the API
│   │   └── migrate.ts        CLI: migrate up | status | down
│   ├── src/
│   │   ├── index.ts          production entry point
│   │   ├── server.ts         boot: create the database if missing, run migrations, sync superadmin, listen
│   │   ├── app.ts            Express app: helmet/CSP, rate limits, body limits, robots/sitemap, landing vs app shell
│   │   ├── config.ts         environment variables, validated with Zod
│   │   ├── context.ts        Ctx: the per-request "who, which company" object
│   │   ├── db/
│   │   │   ├── pools.ts      the shared connection pool, ensureDatabase, withTx
│   │   │   ├── migrator.ts   numbered .sql migrations with -- @down, advisory lock
│   │   │   └── migrations/   001_init.sql (the whole schema)
│   │   ├── lib/              errors, permissions (RBAC matrix), crypto helpers, CSV writer
│   │   ├── middleware/http.ts  cookies, CSRF guard, authenticate, authenticateAdmin, requirePermission, error handler
│   │   ├── routes/
│   │   │   ├── index.ts      company API (/api/...)
│   │   │   └── admin.ts      superadmin API (/api/admin/...)
│   │   └── services/         ALL business logic and authorization
│   │       ├── auth.ts       signup requests, login, session → Ctx, password change/reset
│   │       ├── platform.ts   superadmin: login, approve/reject, suspend, plans
│   │       ├── tenants.ts    createCompany: company, settings, first admin (inside the approval transaction)
│   │       ├── events.ts     events, lifecycle, managers, live stats
│   │       ├── guests.ts     guests, CSV import/export
│   │       ├── tickets.ts    passes, PDF, invitations
│   │       ├── checkin.ts    scan and manual check-in
│   │       ├── public.ts     guest pass page + RSVP (no login)
│   │       ├── reports.ts    attendance / no-show / RSVP reports
│   │       ├── settings.ts   company settings
│   │       ├── users.ts      team members
│   │       ├── audit.ts      audit log
│   │       └── mailer.ts     SMTP sending (or console output in dev)
│   └── test/                 Vitest suites against a real throw-away PostgreSQL
└── web/
    ├── index.html            static landing page (SEO; no React)
    ├── app.html              shell for the React app (noindex)
    ├── vite.config.ts        two entries + dev routing plugin
    ├── public/               favicon.svg, manifest.webmanifest
    └── src/
        ├── main.tsx          React entry
        ├── landing/          landing page CSS + tiny script
        ├── app/              providers (theme, query client), router
        ├── components/       layout (AppShell) and shared UI (DataTable, Scanner, QRCode, PassPreview, ...)
        ├── features/         one folder per area: auth, admin, dashboard, events, guests, invitations,
        │                     tickets, checkin, reports, users, settings, integrations, pass
        ├── lib/              API client, session hooks, Zod schemas, formatting
        └── types/            shared TypeScript types
```

## 4. Running it

### Local development (no Docker, no PostgreSQL install)

```bash
npm install
npm run dev       # API on :4000 + embedded PostgreSQL on :5544 (data in server/.dev)
npm run dev:web   # web app on http://localhost:5173 (proxies /api to :4000)
```

`server/scripts/dev.ts` creates `server/.dev/dev-secrets.json` on first run (JWT key and a generated superadmin password), uses a database called `eventpass` in the embedded PostgreSQL, and prints the superadmin login on startup. Emails are printed to the API console instead of being sent.

### All scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:web` | Run the API / web app in development |
| `npm run build` | Build the server bundle (`server/dist`) and the web app (`web/dist`) |
| `npm test` | Run the server test suite (69 tests) |
| `npm run typecheck` | Strict TypeScript check of both packages |
| `npm run lint` | ESLint over the whole repo |
| `npm run migrate:status` | Applied and pending migrations |
| `npm run migrate` | Apply pending migrations |

In production the same migration CLI is `docker compose exec app node dist/migrate.js status` (or `up`). Migrations also run automatically on every boot.

## 5. Configuration

Validated at startup by `server/src/config.ts`; a missing or invalid value stops the server with a message naming the field.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns on `Secure` cookies and HSTS |
| `PORT` | `4000` | API port |
| `APP_URL` | `http://localhost:5173` | Public URL: used in emailed links, CSRF origin check, canonical URL, sitemap. Set from `DOMAIN` by docker-compose |
| `JWT_SECRET` | — (required, 32+ chars) | Signs session tokens |
| `DATABASE_URL` | — (required) | The shared PostgreSQL database. Any ordinary login works; no special permissions |
| `DB_POOL_MAX` | `20` | Maximum database connections |
| `SESSION_HOURS` | `8` | Session length |
| `SMTP_URL` | empty | SMTP connection URL; empty = emails are not sent (printed in development) |
| `MAIL_FROM` | `EventPass <no-reply@eventpass.local>` | Sender address |
| `TRUST_PROXY` | `0` | Number of proxies in front (1 behind Caddy) so client IPs are right for rate limits |
| `LOG_LEVEL` | `info` | `silent` in tests |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | empty | Bootstrap superadmin, created or updated on every boot (both or neither; password 12+ chars) |
| `DOMAIN`, `DB_PASSWORD` | — | Docker Compose only: the public domain for Caddy, and the bundled PostgreSQL's password |

## 6. Multi-tenancy (one shared database)

All companies live in one PostgreSQL database and share its tables. Every company-owned table (`users`, `company_settings`, `events`, `event_managers`, `guests`, `tickets`, `invitations`, `checkins`, `audit_logs`) has a `company_id` column.

**How a request is tied to one company** (`services/auth.ts` → `loadContext`):

1. Read the `ep_session` cookie and verify the JWT (HS256; tokens with an audience are refused).
2. One query loads the user (role, status), their company (status, slug) and its plan. The user must be `ACTIVE` and the company `ACTIVE`.
3. Build a `Ctx` object (`userId`, `role`, `companyId`, `db`, plan limits) that every service receives.

The company id is **never** read from the request body, URL or headers.

**Three layers keep companies apart:**

| Layer | What it does |
|---|---|
| Every query is scoped | Every SQL statement in `services/` filters by `ctx.companyId`, or joins through a row that does. Records of another company look exactly like records that don't exist (`404`). |
| Composite foreign keys | Company tables have `UNIQUE (company_id, id)`, and references use `(company_id, …)`. The database refuses, for example, a ticket that points at one company's event and another company's guest, or a check-in by another company's user. |
| Tests | `security.test.ts` takes one company's real ids and tries them against every endpoint of another company; the database-level test inserts a cross-company ticket directly and expects it to be rejected. |

What this design does **not** have: PostgreSQL row-level security (RLS). A query that forgot its `company_id` filter would not be stopped by the database. RLS is the natural next hardening step once the MVP settles.

**Connection pool** (`db/pools.ts`): one pool for the whole app (`DB_POOL_MAX`, default 20). `ensureDatabase()` creates the database on first start when it doesn't exist (local dev and tests); managed services already have it.

**Creating a company** (`services/tenants.ts` → `createCompany`), run inside the approval transaction:

1. Insert the company (status `ACTIVE`, Starter plan, a unique slug from its name).
2. Insert its settings row.
3. Insert the first user as `COMPANY_ADMIN`, and their password hash (computed at signup).

The approval transaction also claims the signup request and clears its copy of the hash; any failure rolls all of it back.

**Migrations** (`db/migrator.ts`): numbered `.sql` files directly in `server/src/db/migrations/`, each with an optional `-- @down` section, recorded in `schema_migrations`. A PostgreSQL advisory lock stops two processes migrating at once. They run on every boot.

## 7. Sign-in and sessions

### Company users

- **Signup** (`POST /api/auth/register`) only files a `company_requests` row with the password already bcrypt-hashed. It returns `202` and no session. The requester and all superadmins are emailed.
- **Login** checks bcrypt against the stored hash. Unknown emails are compared against a dummy hash so response times don't reveal which emails exist. A pending requester who enters the right password gets `403 PENDING_APPROVAL`; a wrong password gets the same answer as an unknown email.
- **Session**: JWT in the `ep_session` cookie, `HttpOnly`, `SameSite=Strict`, `Secure` in production, valid for `SESSION_HOURS`. The token carries `pv`, the time the password last changed; changing or resetting a password logs out every other session.
- **Password rules**: 10–128 characters, letters and at least one number.
- **Password reset**: a random token is emailed; only its SHA-256 hash is stored; valid for 1 hour and single-use. The response is identical whether or not the email exists.
- **Disabled user or suspended company**: rejected on the next request, not just at the next login.

### Platform superadmins

- Stored in `platform_admins`; created or updated from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` on every boot. Changing the password there and restarting resets it and ends existing admin sessions.
- Separate cookie `ep_admin`, JWT with audience `platform-admin`. Company routes refuse tokens that have an audience; admin routes require exactly that audience.
- Can approve or reject signup requests, suspend or reactivate companies, and change a company's plan. **Cannot** read any company's events or guests.
- Approving is safe against double clicks: in one transaction the request is claimed with `UPDATE … WHERE status = 'PENDING'` (a second approver waits on the row lock, then gets `409`), then the company is created.

## 8. Permissions and plan limits

Defined once in `server/src/lib/permissions.ts` and checked on the server for every route (the web app only uses roles to hide menu items).

| Permission | Company admin | Event manager | Check-in staff |
|---|:-:|:-:|:-:|
| `checkin:scan`, `events:read` | ✓ | ✓ | ✓ |
| `events:write`, `guests:manage`, `guests:export`, `tickets:manage`, `invitations:send`, `reports:view` | ✓ | ✓ | – |
| `users:manage`, `company:manage`, `audit:view`, `integrations:manage` | ✓ | – | – |

**What each role sees** (`services/events.ts` → `visibility`):
- Company admins see all events.
- Event managers see events they created or are assigned to, and get `403` on anyone else's.
- Check-in staff see only `PUBLISHED` and `ONGOING` events.

**Other rules:** a company must keep at least one active admin; you can't change your own role or disable yourself from the team page.

**Plan limits** (from the `plans` table, carried in `Ctx`):

| Plan | Active events (not archived or cancelled) | Guests per event |
|---|---|---|
| Starter (default for new companies) | 3 | 500 |
| Business | 50 | 5,000 |
| Enterprise | unlimited | unlimited |

Going over a limit returns `402 PLAN_LIMIT`. The plans' `features` flags (`googleSheets`, `sso`) exist but nothing uses them yet.

## 9. Data model

One database. Tables marked **company** carry `company_id` and are always queried for one company.

### Platform tables

| Table | Key columns | Notes |
|---|---|---|
| `plans` | `code`, `max_events`, `max_guests_per_event`, `features` | Seeded: starter, business, enterprise |
| `companies` | `name`, `slug` (unique), `status` (`ACTIVE`/`SUSPENDED`/`DELETED`), `plan_id` | The slug appears in guest pass links |
| `platform_admins` | `email` (unique), `password_hash`, `updated_at` | Superadmins |
| `company_requests` | `company_name`, `full_name`, `email`, `password_hash`, `timezone`, `status` (`PENDING`/`APPROVED`/`REJECTED`), `reject_reason`, `company_id`, `decided_by`, `decided_at` | Only one pending request per email; the hash is cleared once decided |
| `auth_credentials` | `user_id`, `password_hash`, `updated_at` | `updated_at` is the `pv` session version |
| `password_resets` | `token_hash`, `user_id`, `expires_at`, `used_at` | |

### Company tables

| Table | Key columns | Constraints worth knowing |
|---|---|---|
| `users` | `company_id`, `id`, `email`, `full_name`, `role`, `status` | Email unique **across the platform** (people sign in by email alone) |
| `company_settings` | `company_id` (primary key), `company_name`, `logo_url`, `primary_brand_color`, `timezone`, `default_language`, contact fields | One row per company |
| `events` | `company_id`, `name`, `event_code`, venue, `start_datetime`, `end_datetime`, `capacity`, `status`, `banner_url`, `created_by` | Event code unique per company; end after start; creator must be the same company's user |
| `event_managers` | `company_id`, `event_id`, `user_id` | Event and user must belong to that company |
| `guests` | `company_id`, names, `email`, `phone`, `company_name`, `category`, `status` (`ACTIVE`/`DELETED`), `notes` | Email unique among a company's **active** guests; delete is a soft delete |
| `tickets` | `company_id`, `event_id`, `guest_id`, `ticket_number` (`EVT-XXXXXX`), `qr_token_hash`, `status`, `rsvp_status`, `expires_at` | Event and guest from the same company; one live ticket per guest per event; ticket number unique per company; token hash unique |
| `invitations` | `company_id`, `ticket_id`, `sent`, `sent_at`, `delivery_status`, `opened_at`, `clicked_at` | |
| `checkins` | `company_id`, `ticket_id`, `event_id`, `guest_id`, `checked_in_at`, `checked_in_by`, `gate`, `device_id`, `method` (`QR`/`MANUAL`) | **`UNIQUE(ticket_id)`**: a ticket can be checked in once, enforced by the database |
| `audit_logs` | `company_id`, `user_id`, `action`, `entity_type`, `entity_id`, `timestamp`, `metadata` | Never stores personal data or tokens |

Guest categories: `VIP`, `SPEAKER`, `SPONSOR`, `STAFF`, `ATTENDEE`, `FAMILY`, `OTHER`.

## 10. Business rules

### Events

- Event codes are generated (`E` + 8 hex characters) unless you supply one (3–32 letters, digits, `-`, `_`).
- Status lifecycle:

  | Action | From | To |
  |---|---|---|
  | publish | `DRAFT` | `PUBLISHED` |
  | (first successful check-in) | `PUBLISHED` | `ONGOING` |
  | complete | `PUBLISHED`, `ONGOING` | `COMPLETED` |
  | cancel | `DRAFT`, `PUBLISHED`, `ONGOING` | `CANCELLED` |
  | archive | `COMPLETED`, `CANCELLED` | `ARCHIVED` |

- Duplicating an event copies its details into a new draft named `<name> (copy)`.
- No passes or invitations can be issued for completed, cancelled or archived events.

### Guests and CSV import

- Import is two steps: **preview** (validates, returns per-row errors with spreadsheet row numbers) and **commit** (re-validates on the server; you can choose to skip invalid rows).
- Up to 5,000 rows and 5 MB per file. Required columns: `first_name`, `last_name`, `email`. Common header spellings are recognised (`First Name`, `surname`, `E-mail`, `mobile`, `organisation`, `type`, …).
- Duplicates are flagged both inside the file and against existing guests (email, and phone where given).
- The commit can also issue passes for an event and send the invitations in the same step.
- CSV **export** prefixes cells starting with `=`, `+`, `-`, `@` so spreadsheets don't run them as formulas.

### Passes (tickets)

- A pass token is 32 random bytes (64 hex characters). The QR code encodes `APP_URL/checkin/<token>`; no names, emails or ids.
- Only `SHA-256(token)` is stored. So showing, downloading (PDF) or emailing a pass **issues a new token**, and the previous QR stops working.
- A pass expires at the event's end time.
- The PDF pass is a 320×520 pt page drawn with pdfkit.

### Invitations and RSVP

- Sending an invitation emails the guest their pass, with the QR as an inline image and a link to their pass page, and records the invitation as `SENT` or `FAILED`.
- **Guest pass page** `/pass/<company-slug>/<token>` needs no login. It shows the event, the guest's own pass and RSVP buttons (`CONFIRMED` / `DECLINED`). Opening it marks the invitation `OPENED`; that is the "open tracking". There is no tracking pixel.
- The page only works while the company is active.

### Check-in

One database transaction (`services/checkin.ts`):

1. Hash the scanned token (a full URL or a bare token both work) and lock the ticket row with `SELECT … FOR UPDATE`.
2. Reject, in this order: not found → `INVALID_TICKET` 404; scanned at a different event → `INVALID_TICKET` 404; cancelled → `TICKET_CANCELLED` 410; already used → `TICKET_ALREADY_USED` 409 (with the time and gate of first entry); expired → `TICKET_EXPIRED` 410; event not `PUBLISHED`/`ONGOING` → `EVENT_NOT_ACTIVE` 409.
3. Insert into `checkins` (the `UNIQUE(ticket_id)` constraint is the final guard), mark the ticket `USED`, move the event to `ONGOING` if needed, write an audit row, commit.

Door phones show **green** (let in), **amber** (already used) or **red** (do not admit). Manual check-in (search by name) runs the same transaction by ticket id; door-side search masks email addresses. Rejections are audit-logged without delaying the response.

### Reports and dashboard

- Live stats per event (issued, checked in, RSVP counts, arrivals per hour) feed the dashboard charts.
- Reports: `attendance`, `noshow`, `rsvp`; each as JSON or CSV (`?format=csv`).

### Audit log

Recorded actions: `EVENT_CREATED`, `EVENT_UPDATED`, `EVENT_STATUS_CHANGED`, `EVENT_CANCELLED`, `GUEST_CREATED`, `GUEST_UPDATED`, `GUEST_DELETED`, `GUEST_IMPORTED`, `GUEST_EXPORTED`, `TICKET_GENERATED`, `TICKET_REISSUED`, `TICKET_CANCELLED`, `INVITATION_SENT`, `CHECKIN_CREATED`, `CHECKIN_REJECTED`, `USER_CREATED`, `USER_UPDATED`, `USER_DISABLED`, `SETTINGS_UPDATED`. Visible to company admins at `/api/audit-logs`.

## 11. API reference

All routes are under `/api`. Every `POST`/`PUT`/`PATCH`/`DELETE` must send the header `X-Requested-With: eventpass` (CSRF protection). Errors always look like `{"error": {"code": "...", "message": "...", "details": ...}}`.

### Public (no session)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ok: true}` |
| POST | `/api/auth/register` | Files a signup request → `202` |
| POST | `/api/auth/login` | Sets `ep_session` |
| POST | `/api/auth/logout` | Clears the cookie |
| POST | `/api/auth/forgot-password` | Always `{ok: true}` |
| POST | `/api/auth/reset-password` | `{token, newPassword}` |
| GET | `/api/public/pass/:slug/:token` | Guest pass page data |
| POST | `/api/public/pass/:slug/:token/rsvp` | Guest RSVP |

### Company (session required; permission in brackets)

| Method | Path | Permission |
|---|---|---|
| GET | `/api/auth/me` | any |
| POST | `/api/auth/change-password` | any |
| GET / PUT | `/api/company/settings` | any / `company:manage` |
| GET / POST | `/api/users` | `users:manage` |
| PATCH | `/api/users/:id` | `users:manage` |
| GET | `/api/audit-logs` | `audit:view` |
| GET / POST | `/api/events` | `events:read` / `events:write` |
| GET / PATCH | `/api/events/:id` | `events:read` / `events:write` |
| POST | `/api/events/:id/status` | `events:write` (`{action: publish\|complete\|cancel\|archive}`) |
| POST | `/api/events/:id/duplicate` | `events:write` |
| GET / PUT | `/api/events/:id/managers` | `events:read` / `users:manage` |
| GET | `/api/events/:id/stats` | `reports:view` |
| GET / POST | `/api/events/:id/tickets` | `tickets:manage` |
| POST | `/api/tickets/:id/cancel` | `tickets:manage` |
| POST | `/api/tickets/:id/reissue` | `tickets:manage` (returns a fresh token) |
| POST | `/api/tickets/:id/pass-pdf` | `tickets:manage` (PDF download) |
| POST | `/api/events/:id/invitations` | `invitations:send` |
| GET | `/api/invitations` | `invitations:send` |
| GET / POST | `/api/guests` | `guests:manage` |
| POST | `/api/guests/import/preview`, `/api/guests/import/commit` | `guests:manage` |
| POST | `/api/guests/bulk-delete` | `guests:manage` (up to 500 ids) |
| GET | `/api/guests/export.csv` | `guests:export` |
| GET / PATCH / DELETE | `/api/guests/:id` | `guests:manage` |
| POST | `/api/checkin` | `checkin:scan` (`{token or scanned URL, eventId, gate, deviceId}`) |
| POST | `/api/checkin/manual` | `checkin:scan` |
| GET | `/api/checkin/search` | `checkin:scan` (`?eventId&q`) |
| GET | `/api/events/:id/checkins` | `checkin:scan` |
| GET | `/api/events/:id/reports/:kind` | `reports:view` (`?format=csv`) |
| GET | `/api/integrations` | `integrations:manage` (Google Sheets placeholder) |

### Superadmin (`ep_admin` session)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/login`, `/api/admin/logout` | |
| GET | `/api/admin/me` | |
| GET | `/api/admin/requests?status=PENDING\|APPROVED\|REJECTED` | |
| POST | `/api/admin/requests/:id/approve` | Creates the company; `409` if already decided |
| POST | `/api/admin/requests/:id/reject` | `{reason?}` |
| GET | `/api/admin/companies` | |
| PATCH | `/api/admin/companies/:id` | `{status?: ACTIVE\|SUSPENDED, plan?: code}` |
| GET | `/api/admin/plans` | |

### Outside `/api`

`/robots.txt` and `/sitemap.xml` (generated from `APP_URL`); `/` serves the landing page; every other path serves the React app shell with `X-Robots-Tag: noindex`.

## 12. Web app

- **Two HTML entries** (`web/vite.config.ts`): `index.html` is the static landing page (plain HTML and CSS, about 7 KB gzipped, SEO tags, JSON-LD structured data); `app.html` is the React app. In production the API server picks which to send; in development a small Vite plugin does the same.
- **Routes** (`src/app/router/index.tsx`): `/login`, `/register`, `/forgot-password`, `/reset-password`, `/pass/:slug/:token` (public); `/dashboard`, `/events`, `/events/:id`, `/guests`, `/guests/import`, `/invitations`, `/reports`, `/checkin`, `/checkin/:token`, `/team`, `/integrations`, `/settings` (signed in, some role-restricted); `/admin/login`, `/admin` (superadmin).
- **Server data** goes through TanStack Query (`src/lib/api/client.ts` adds the CSRF header). Any `401` clears the cached session and sends the user to sign-in.
- **Forms** use React Hook Form with Zod schemas (`src/lib/validation/schemas.ts`); server-side field errors are mapped back onto the form fields.
- **Scanner** (`components/ui/Scanner.tsx`) reads the phone camera and decodes QR codes with jsQR. The selected event, gate and a random device id are remembered per phone (Zustand, localStorage). Camera access needs HTTPS or localhost.
- **Theming**: MUI theme, primary colour taken from the company's brand colour setting; dates shown in the company's timezone.
- **Installable**: `manifest.webmanifest` lets staff add EventPass to a phone home screen. There is no offline mode (no service worker).

## 13. Security controls

| Area | Control |
|---|---|
| Company isolation | Company derived only from the session; every query filtered by `company_id`; composite foreign keys reject cross-company links |
| Credentials | bcrypt (12 rounds); password hashes kept in their own table |
| Sessions | HttpOnly + SameSite=Strict (+ Secure) cookies; password-version claim; separate superadmin cookie and audience |
| CSRF | Custom header required on every state-changing request, plus `Origin` must match |
| Authorization | Server-side permission matrix on every route; event-level checks for managers |
| Input | Zod validation on all input; route ids must be UUIDs; parameterised SQL everywhere |
| Headers | Helmet: strict Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`), HSTS in production, `Referrer-Policy: no-referrer`, camera allowed only on the site itself |
| Rate limits | 600 requests/min per IP overall; 30 per 15 min on auth routes; 60/min on public pass routes |
| Request size | 100 KB JSON (6 MB for guest import) |
| Enumeration | Same responses and timing for unknown emails on login and password reset |
| QR passes | 256-bit random tokens; only hashes stored; no personal data in the QR |
| Errors | Clients never see stack traces or database messages |
| Privacy | Door search masks emails; audit log excludes personal data and tokens; CSV formula-injection guard |
| Crawlers | App routes `noindex`; `robots.txt` blocks `/api`, `/pass`, `/checkin`, `/admin` |

## 14. Email

`services/mailer.ts` sends through nodemailer using `SMTP_URL`. With no `SMTP_URL`, messages go into an in-memory outbox (used by tests) and, in development, are printed to the console.

Emails sent: guest invitation with pass; password reset; signup received (to requester); new signup (to every superadmin); approved / rejected (to requester). Notification emails never fail the action that triggered them: a send failure is logged and the action still succeeds.

## 15. Tests

69 tests in 5 files under `server/test/`, run by Vitest against a **real PostgreSQL** that the test setup starts and deletes afterwards (`embedded-postgres`):

| File | Covers |
|---|---|
| `happy-path.test.ts` | Full journey: signup, event, import, pass, scan, report; token hashing; reissue; PDF; timezone; password reset and session invalidation |
| `security.test.ts` | Company isolation (other companies' ids on every endpoint, client-supplied company ids ignored, cross-company rows rejected by the database), RBAC for each role, CSRF, cookies, account enumeration, disabled users, QR attack cases (expired, cancelled, wrong event, duplicates, 12 concurrent scans), SQL-injection-shaped input, plan limits |
| `superadmin.test.ts` | Signup approval, pending login, rejection, concurrent approvals, suspension, plan change, session separation |
| `site.test.ts` | `robots.txt`, `sitemap.xml`, landing vs app shell and `noindex` |
| `unit.test.ts` | QR tokens and ticket numbers, the permission matrix, guest validation (incl. phone normalisation), CSV safety, migration files |

There are no automated tests for the React app; it has been checked by hand and with screenshots.

## 16. Build and deploy

- **Dockerfile** (multi-stage): stage 1 installs everything and builds the server bundle (tsup → `dist/index.js`, `dist/migrate.js`) and the web app (Vite → `web/dist`); stage 2 is `node:22-alpine` with production dependencies, the bundles, the SQL migrations and the built web app, running as the unprivileged `node` user with a health check on `/api/health`.
- **docker-compose.yml**: `caddy` (ports 80/443, certificates in the `caddy_data` volume) → `app` (internal port 4000) → `db` (PostgreSQL 17, `pgdata` volume, no public port). Setting `DATABASE_URL` points the app at a managed PostgreSQL instead.
- **Backups**: `deploy/backup.sh` writes `database.sql.gz` (`pg_dump` of the one database), checks it is complete, keeps 14 days, optionally copies off-server with rclone. `deploy/restore.sh` restores it into the bundled container. Managed databases use their provider's backups.
- Full walkthrough: [DEPLOY.md](../DEPLOY.md).

## 17. Limits and known gaps

- **Not built** (the design leaves room for them): magic-link and Google sign-in, SSO, Excel/PDF report export, Google Sheets integration (placeholder only), billing, Apple/Google Wallet passes, WhatsApp, custom domains per company.
- CSV import only; Excel files must be saved as CSV first.
- Company isolation relies on application code plus composite foreign keys; there is no PostgreSQL row-level security yet (see section 6).
- Rate limits are counted in memory per process, so they reset on restart and aren't shared between servers.
- No offline mode for door phones; check-in needs a connection.
- No automated tests for the web app.
- Encryption at rest and TLS certificates are handled by the infrastructure (disk encryption, Caddy), not by the app.

## 18. Where to change things

| To change… | Look in |
|---|---|
| Who can do what | `server/src/lib/permissions.ts` (+ `NAV_ROLES` in `web/src/lib/auth/session.ts` for menus) |
| Plan limits | `plans` table; superadmin can switch a company's plan at `/admin` |
| Password rules | `passwordSchema` in `server/src/services/auth.ts` and `passwordField` in `web/src/lib/validation/schemas.ts` |
| Email wording | `services/auth.ts`, `services/platform.ts`, `services/tickets.ts` |
| Pass PDF layout | `renderPassPdf` in `server/src/services/tickets.ts` |
| Check-in rules | `performCheckIn` in `server/src/services/checkin.ts` |
| Event lifecycle | `TRANSITIONS` in `server/src/services/events.ts` |
| CSV column names | `ALIASES` in `server/src/services/guests.ts` |
| Landing page copy and SEO tags | `web/index.html`, `web/src/landing/` |
| Database schema | add `server/src/db/migrations/00N_name.sql` (applied on next boot); give new company tables a `company_id` and composite foreign keys |
| Security headers / CSP | `server/src/app.ts` |
| Rate limits | `server/src/middleware/http.ts` |
