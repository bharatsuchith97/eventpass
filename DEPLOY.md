# Deploying Inviteley

Two ways to run Inviteley in production:

- **Option A: Render + Neon** (recommended). No server to look after: Render runs the app from the `Dockerfile`,
  Neon hosts the database. About $7/month for an always-on app; Neon's free tier is enough to start.
- **Option B: one free Oracle Cloud VM.** Everything on a server you manage yourself with `docker compose`. Free and
  always on, but you handle updates, backups and the firewall.

Both need:
- The code in a (private) GitHub repository.
- A domain name, e.g. `inviteley.com`.
- An email provider (Brevo, Resend, ...) with your domain verified. Free tiers allow only a few hundred emails a day,
  so for a large event (say 1,000 invitations) use a paid plan for that month or send over several days.

---

# Option A: Render + Neon

Render builds the `Dockerfile` and runs it as one web service (API and website on one port, HTTPS included).
`render.yaml` in this repository describes the service, so Render sets most of it up for you.

## A1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a project. Pick the region closest to your guests
   (and use the matching region on Render, e.g. Singapore).
2. On the project dashboard, open **Connect**, turn **connection pooling off**, and copy the connection string.
   It looks like `postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
   Use this direct string (not the `-pooler` one): database migrations hold a lock that poolers can break.

The app creates all its tables on first start; there is nothing to set up inside the database.

## A2. Create the app (Render)

1. Sign up at [render.com](https://render.com) and connect your GitHub account.
2. **New → Blueprint**, choose the Inviteley repository. Render reads `render.yaml` and asks for the values it
   can't fill in itself:

   | Setting | Value |
   |---|---|
   | `DATABASE_URL` | The Neon connection string from A1 |
   | `APP_URL` | `https://eventpass.onrender.com` for now (fix it in step 4 if Render gives a different address) |
   | `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Your platform admin login (password 12+ characters) |
   | `SMTP_URL` / `MAIL_FROM` | From your email provider (see the examples in `.env.example`) |

   `JWT_SECRET` is generated for you.
3. **Apply.** The first build takes a few minutes. In the service's **Logs** you should see
   `[migrate] applied 001`, `[superadmin] created …` and `Inviteley API listening on :4000`.
4. Open the service's address (shown at the top of its page). If it differs from what you entered as `APP_URL`,
   correct `APP_URL` under **Environment**; Render redeploys automatically.
5. **Turn on automatic deploys from GitHub.** `render.yaml` switches Render's own auto-deploy off, so that a push
   only goes live after GitHub Actions has run the checks (`.github/workflows/ci.yml`: typecheck, lint, tests, build).
   - Render → service → **Settings → Deploy Hook**: copy the URL (treat it like a password).
   - GitHub → repository → **Settings → Secrets and variables → Actions → New repository secret**:
     name `RENDER_DEPLOY_HOOK_URL`, value the URL you copied.

   From then on every push to `main` is checked and, if everything passes, deployed.

## A3. Use your own domain

1. In the service: **Settings → Custom Domains → Add**, enter `inviteley.com`, then add `www.inviteley.com` too.
2. At your domain registrar's DNS settings, add exactly the records Render shows for each. For the bare domain
   (`inviteley.com`) that is usually an `A` record to an IP address (most registrars don't allow a `CNAME` there);
   for `www` it is a `CNAME` to `<name>.onrender.com`. Remove any existing "parking" `A`/`CNAME` records for the
   same names first. Render issues the HTTPS certificates by itself once DNS has updated (minutes to a few hours)
   and redirects `www` to the bare domain.
3. Change `APP_URL` to `https://inviteley.com`. Emailed links, the sitemap and the security checks use it.

## A4. Before the event

1. Go to `https://<your-domain>/admin`, sign in as superadmin.
2. Request your own company account at `/register`, then approve it in `/admin`.
3. In `/admin` → **Companies**, change your company's plan to **Business** if you expect more than 500 guests
   for one event (Starter allows 500 per event, Business 5,000).
4. Send invitations in batches of about 200 rather than all at once, and send a test batch to yourself first.
5. Rehearse check-in at the venue with the real phones and the real network.

## A5. Day to day

| Task | How |
|---|---|
| Deploy a new version | `git push` to `main`. GitHub Actions runs the checks, then triggers Render; migrations run on start. Watch it under the repository's **Actions** tab |
| Logs | Render → service → **Logs** |
| Browse the database | Neon → **SQL Editor**, or connect pgAdmin/DBeaver with the connection string |
| Back up | Neon keeps a short restore history on the free plan. For your own copy, run `pg_dump "<connection string>" > eventpass.sql` from a computer with PostgreSQL tools installed, e.g. before and after the event |
| Change the superadmin password | Update `SUPERADMIN_PASSWORD` under **Environment** (redeploys) |

---

# Option B: a free Oracle Cloud VM

This puts the whole stack on one server: **Caddy** (HTTPS) → **Inviteley** (API + web) → **PostgreSQL**, all with
`docker compose`. It runs on Oracle Cloud's *Always Free* tier, but the same steps work on any Ubuntu server
(Hetzner, DigitalOcean, Google Cloud e2-micro, ...), starting at step 3.

You need:
- An Oracle Cloud account (a card is needed at signup; Always Free resources are not charged).
- A domain name, or a free subdomain from a service like DuckDNS. HTTPS, and therefore camera scanning at the door, needs one.
- An SMTP account for email, e.g. Brevo or Resend (both have free tiers).

> **Prefer a managed database?** All companies share one ordinary PostgreSQL database, so any managed
> PostgreSQL works (Supabase, Neon, Render, ...): put its connection string in `DATABASE_URL` in step 6 and the
> bundled database container is simply not used. You still need somewhere to run the app, such as this VM.

---

## 1. Create the VM

In the Oracle Cloud console: **Compute → Instances → Create instance**.

- **Image:** Canonical Ubuntu 24.04 (or 22.04).
- **Shape:** *Ampere* `VM.Standard.A1.Flex`. 2 OCPUs and 12 GB RAM is plenty and stays within Always Free.
  If Oracle says it is out of capacity, try another availability domain or try again later. As a fallback,
  `VM.Standard.E2.1.Micro` (1 GB RAM) works for a small pilot if you add swap (see Troubleshooting).
- **Boot volume:** the default 50 GB is fine.
- **SSH keys:** upload your public key, or download the generated private key and keep it safe.

When it is running, note its **public IP address**.

## 2. Open ports 80 and 443

Oracle blocks these in **two** places. Both must be opened.

**a) In the cloud network:** Instance → *Primary VNIC* → Subnet → *Security List* → **Add Ingress Rules**:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` (optional, for HTTP/3) |

**b) On the VM itself.** Oracle's Ubuntu images ship with firewall rules that reject everything except SSH.
SSH in (`ssh ubuntu@<public-ip>`) and run:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Do **not** open port 5432 (PostgreSQL) or 4000 (the app). Only Caddy should be reachable.

## 3. Point your domain at the server

At your DNS provider, create an **A record** for your domain (e.g. `inviteley.com`) pointing to the VM's public IP.
Wait until `ping inviteley.com` shows that IP, because Caddy cannot get a certificate before then.

## 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit   # log out and SSH back in so the group change applies
```

Check with `docker compose version`.

## 5. Get the code onto the server

With git (push the repo to a private GitHub/GitLab repository first):

```bash
git clone <your-repo-url> ~/eventpass
cd ~/eventpass
```

Or copy it from your computer without git (from the project folder, excluding local data):

```bash
tar --exclude=node_modules --exclude=server/.dev --exclude=.env --exclude='*/dist' -czf eventpass.tgz .
scp eventpass.tgz ubuntu@<public-ip>:~
ssh ubuntu@<public-ip> 'mkdir -p ~/eventpass && tar -xzf ~/eventpass.tgz -C ~/eventpass'
```

## 6. Configure

```bash
cd ~/eventpass
cp .env.example .env
nano .env
```

Fill in every empty value. Generate each secret with `openssl rand -hex 32`:

- `DOMAIN`: e.g. `inviteley.com` (no `https://`)
- `DB_PASSWORD`, `JWT_SECRET`: two different random values
- `DATABASE_URL`: leave empty to use the bundled database, or paste a managed PostgreSQL connection string
- `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`: your platform admin login
- `SMTP_URL`, `MAIL_FROM`: from your email provider (see the examples in the file)

Lock the file down: `chmod 600 .env`.

## 7. Start it

```bash
docker compose up -d --build
docker compose logs -f app
```

You should see `[migrate] applied 001`, `[superadmin] created ...` and `Inviteley API listening on :4000`.
Press Ctrl+C to stop following the logs (the app keeps running).

Open `https://<your-domain>`. The first visit can take a few seconds while Caddy gets the certificate.

- Landing page: `https://<your-domain>/`
- Superadmin: `https://<your-domain>/admin`
- Companies request access at `/register`; you approve them at `/admin`.

## 8. Backups (do this before inviting anyone)

`deploy/backup.sh` dumps the database (every company is in it) to `database.sql.gz`.
If you use a managed PostgreSQL instead of the bundled container, use your provider's backups and skip this step.

```bash
chmod +x deploy/*.sh
sudo mkdir -p /var/backups/eventpass && sudo chown $USER /var/backups/eventpass
deploy/backup.sh                       # try it once by hand
ls /var/backups/eventpass
```

Run it every night at 03:15 (`crontab -e`, then add):

```
15 3 * * * /home/ubuntu/eventpass/deploy/backup.sh >> /home/ubuntu/eventpass-backup.log 2>&1
```

### Copy backups off the server

A backup on the same disk does not survive losing the VM. Cloudflare R2 and Backblaze B2 both have free tiers:

1. Create a bucket (e.g. `eventpass-backups`) and an access key for it.
2. On the VM: `sudo apt install -y rclone`, then `rclone config` and add an S3-compatible remote (named e.g. `r2`).
3. Add `RCLONE_REMOTE=r2:eventpass-backups` in front of the command in the cron line:
   ```
   15 3 * * * RCLONE_REMOTE=r2:eventpass-backups /home/ubuntu/eventpass/deploy/backup.sh >> /home/ubuntu/eventpass-backup.log 2>&1
   ```
4. In the bucket settings, add a lifecycle rule to delete objects after e.g. 30 days.

### Restoring

On a fresh server (steps 1–7), copy a backup folder over and run:

```bash
deploy/restore.sh /path/to/20260930-031500Z
```

It asks you to type `restore`, replaces all data, and restarts the app. Practise this once on a spare VM
or on your own computer before you need it for real.

## Day-to-day

| Task | Command (in `~/eventpass`) |
|---|---|
| Deploy a new version | `git pull && docker compose up -d --build` (migrations run automatically on start) |
| Check migrations | `docker compose exec app node dist/migrate.js status` |
| App logs | `docker compose logs -f app` |
| Restart | `docker compose restart app` |
| Change the superadmin password | edit `SUPERADMIN_PASSWORD` in `.env`, then `docker compose up -d` |
| Disk space | `df -h` and `docker system df` (`docker image prune` removes old builds) |
| Operating system updates | `sudo apt update && sudo apt upgrade` now and then; reboot when asked |

### Looking at the database

The database is not reachable from the internet, on purpose. For a quick SQL shell on the server:

```bash
docker compose exec db psql -U eventpass -d eventpass
# e.g.  SELECT id, name, status FROM companies;
#       SELECT name, start_datetime FROM events WHERE company_id = '<company id>';
```

To use a GUI (pgAdmin, DBeaver) from your own computer, expose PostgreSQL on the server's **localhost only**
and reach it through SSH:

1. On the server, create `~/eventpass/docker-compose.override.yml` (Compose picks it up automatically):
   ```yaml
   services:
     db:
       ports:
         - "127.0.0.1:5432:5432"   # server-local only; never use "5432:5432"
   ```
   then run `docker compose up -d`.
2. On your computer: `ssh -N -L 5433:localhost:5432 ubuntu@<public-ip>` (leave it running).
3. In your GUI, connect to `localhost:5433`, database `eventpass`, user `eventpass`, password = `DB_PASSWORD` from `.env`.

## Troubleshooting

- **The browser says the connection is not secure, or Caddy logs show certificate errors.** The DNS record does not
  point at the VM yet, or port 80 or 443 is blocked (check both places in step 2). Caddy retries on its own.
  Check with `docker compose logs caddy`.
- **"Invalid environment configuration" in the app logs.** A value in `.env` is missing or too short. The
  message names the field.
- **Emails do not arrive.** Check `docker compose logs app | grep mail`. The usual causes are a wrong `SMTP_URL`, or a
  `MAIL_FROM` address on a domain not verified with the email provider.
- **Low memory on a 1 GB VM.** Add swap:
  `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`
- **Also serve `www.<domain>`.** Add a DNS record for `www`, then append this to `deploy/Caddyfile` and run
  `docker compose restart caddy`:
  ```
  www.{$DOMAIN} {
  	redir https://{$DOMAIN}{uri} permanent
  }
  ```
