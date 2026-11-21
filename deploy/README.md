# Deploying on a server (systemd + nginx)

Recipe for running Wanderbibliothek on your own Linux host, with TLS, a
supervised service, scheduled jobs and backups. The application is a single
Node instance with SQLite: it **cannot** be replicated horizontally (see
"Known limits").

## 0. Quick path: the two scripts

If you would rather not run the sections one by one, the repository ships two:

```bash
# First installation on an empty server (Debian/Ubuntu, as root).
sudo deploy/bootstrap.sh --domain your-domain.de --email you@example.com

# Every new version: fetch the code from GitHub and switch release.
sudo /srv/wanderbibliothek/current/deploy/deploy.sh
```

- **`deploy/bootstrap.sh`** installs Node 24, nginx and certbot, creates the user
  and directories, clones and builds, generates `/etc/wanderbibliothek/env` with
  new secrets, installs the service and timers, publishes the vhost and requests
  the certificate. It does not overwrite an existing `env` or a vhost without
  keeping a copy, and it refuses to continue if Apache occupies ports 80/443.
- **`deploy/deploy.sh`** creates a release under `releases/<date>-<commit>`,
  builds it, **backs up the database** before changing anything, moves
  `current`, restarts and checks `/api/health`. If the check fails, it rolls
  back to the previous version by itself. It accepts `--ref` (tag, branch or
  commit), `--rollback`, `--keep N`, `--skip-backup` and `--dry-run`.

### Choosing the deployment mode

| Mode | What it runs | Upgrade | Recommended use |
|---|---|---|---|
| **Signed image** | The immutable GHCR digest; backup and public assets come from that same image. The watchdog is installed at a fixed host path. | `wanderbibliothek-deploy-image --ref <version>` | Recommended so that third parties can compare the artefact with GitHub. |
| **Code** | The release under `current`; the backup uses its script and the host's Node application. | `current/deploy/deploy.sh` | Alternative for hosts without Docker or for development. |

`deploy.sh` is kept as a deliberate alternative, not as the image instance's
upgrade path. Once the decoupling described in section 11 is installed, systemd,
nginx and the scheduled jobs in image mode no longer need `current`. This makes
the announced digest, the served assets and the code of the backup consistent;
it is not an attestation of the host, and a person with root access can still
change Docker, systemd or nginx.

Both accept `--dry-run` and explain each step with `OK`, `AVISO` (warning) and
`FALLO` (failure). What neither can guess — email, Impressum, administration
account — is listed at the end of the run. The following sections are the manual, step-by-step version,
useful for understanding what each thing does or for debugging.

## 1. Requirements

- Debian 12 / Ubuntu 22.04 or similar; 1 vCPU and 1 GB of RAM are enough to
  start.
- Node.js 24 (NodeSource or a system-wide nvm install).
- nginx and certbot: `sudo apt install nginx certbot python3-certbot-nginx`.
- `build-essential` and `python3` in case `better-sqlite3` has no prebuilt
  binary for your Node version.

### Debian 13 (trixie)

It works the same, with three details that differ from Debian 12:

- The `nodejs` in the repositories is 20, and 24 is required here: install it
  from NodeSource (`curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -`)
  or with a system-wide nvm, and check that `node -v` reports 24 before `npm ci`.
- nginx is 1.26 or later: `listen 443 ssl http2;` is deprecated and `nginx -t`
  warns on every reload. `deploy/nginx.conf` already uses the correct form
  (`listen 443 ssl;` + `http2 on;`); in an older installation, change those two
  lines by hand.
- With 1 GB of RAM, `npm run build` is the most memory-hungry part of the
  process: add 2 GB of swap before building on the server
  (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`,
  plus the matching line in `/etc/fstab`), or build on your machine and copy the
  release already built.

## 2. User and directories

```bash
sudo useradd --system --home /srv/wanderbibliothek --shell /usr/sbin/nologin wanderbibliothek
sudo mkdir -p /srv/wanderbibliothek/releases /var/lib/wanderbibliothek /var/backups/wanderbibliothek
sudo chown -R wanderbibliothek:wanderbibliothek /srv/wanderbibliothek /var/lib/wanderbibliothek /var/backups/wanderbibliothek
```

- `/srv/wanderbibliothek/releases/<date>/` — each deployed version.
- `/srv/wanderbibliothek/current` — symlink to the active version.
- `/var/lib/wanderbibliothek/wanderbibliothek.db` — the database (outside the application).
- `/var/backups/wanderbibliothek/` — backups.
- `/etc/wanderbibliothek/env` — service environment variables (root only).

## 3. Installing dependencies

```bash
cd /srv/wanderbibliothek/releases/2026-11-04
npm ci
npm run build
```

`npm ci` also installs devDependencies because the **build** needs TypeScript
and Tailwind; ESLint is only needed for `npm run lint`. At runtime
`npm ci --omit=dev` is enough: `tsx` (used by
`admin:create`, `db:backup`, `user:verify` and `smoke`) is a production
dependency on purpose. If you prefer a slimmer release, after `npm run build`
you can run `npm prune --omit=dev`.

The build does **not** need a database or environment variables: it can be done
in CI and the artefact deployed.

## 4. Environment

```bash
sudo mkdir -p /etc/wanderbibliothek
sudo install -m 600 -o root -g root deploy/env.example /etc/wanderbibliothek/env
sudo -e /etc/wanderbibliothek/env          # fill in URL, email and secrets
```

Generate the secrets with `openssl rand -hex 32`. The required variables and
their consequences are commented in the file itself; the summary:

| Variable | If missing |
|---|---|
| `NEXT_PUBLIC_SITE_URL` (https) | Sitemap and canonical point to localhost; with `http://` the browser discards the `__Host-` cookie and login loops |
| `BREVO_API_KEY` + `MAIL_FROM` (or `MAIL_WEBHOOK_URL`) | Nobody can confirm their email (required to publish in production) or reset their password |
| `APP_ENCRYPTION_KEY` | The TOTP secret cannot be stored; without 2FA, administration returns 403 in production |
| `APP_ENCRYPTION_OLD_KEYS` | Only used when **rotating** the key: the new one in `APP_ENCRYPTION_KEY`, the previous one here so it can still be read |
| `MAINTENANCE_TOKEN` | The cron returns 404: no purges, no email retries, no club reminders |
| `TRUST_PROXY=1` | All requests share the global quota: one client can exhaust the site's login |
| `WANDERBIBLIOTHEK_DB` | The database is created inside the release and lost on the next deployment |
| `WANDERBIBLIOTHEK_BACKUP_KEY` | The backup is stored in plain text with emails, password hashes and messages inside, and that backup leaves the server |
| `LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL` | `/datenschutz` and `/aviso-legal` show a notice that data is missing; the Impressum is mandatory in Germany |

On startup, `[env]` also warns (without blocking) about errors that would only
be noticed weeks later: a `MAINTENANCE_TOKEN` shorter than 24 characters,
relative database or backup paths, a non-numeric `TRUSTED_PROXY_HOPS` and a
half-configured `ADMIN_EMAIL`/`ADMIN_PASSWORD`. The backup key is not on that
list: if empty or mistyped, it **prevents startup**, because what is at stake is
a database with plain-text emails and hashes.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (optional captcha) is read on the server on
every request, so defining it in the service environment — including Docker —
is enough: nothing needs rebuilding. It always goes together with
`TURNSTILE_SECRET`; with the secret and without the key, registration rejects
every signup and the app refuses to start rather than remain in that state
silently.

> **Prefer containers?** Jump to the [Docker section](#11-docker) below: the
> same environment works, with `WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db`.

### Email: Brevo, integrated into the application

Delivery is handled inside the code (`src/lib/mailer.ts`): with
`BREVO_API_KEY` and `MAIL_FROM` defined, messages go straight to
`POST https://api.brevo.com/v3/smtp/email`. There is no adapter, no Worker and
no second public URL to protect. Only two plain-text emails are sent — account
confirmation and password reset — so the free plan (300 per day) is more than
enough.

1. **Account**: brevo.com. The company is Sendinblue SAS (Paris) and data is
   processed in the EU. Even so, before assuming there is nothing to declare in
   `/datenschutz`, review the data-processing agreement, its sub-processors and
   access from outside the EEA: the European headquarters does not decide
   everything.
2. **Authenticate the domain**: *Senders, Domains & Dedicated IPs → Domains* →
   add `wanderbibliothek.org`. Brevo shows the exact records: two or three
   **DKIM CNAMEs**, a **DMARC TXT** record and the **SPF** `include:`. In netcup
   CloudDNS they are pasted as-is; if the domain already has an SPF record (for
   email, for example), the `include:` entries are merged into **one** line.
3. **API key**: *SMTP & API → API Keys (v3)*, with send permission. It goes in
   `BREVO_API_KEY`; the sender goes in `MAIL_FROM`.

```bash
sudo -e /etc/wanderbibliothek/env
#   BREVO_API_KEY=xkeysib-…
#   MAIL_FROM="Wanderbibliothek <no-reply@wanderbibliothek.org>"
sudo systemctl restart wanderbibliothek
```

Five pitfalls that produce hard-to-read 401/400 responses:

- **Unauthorised IP.** If you enable *Security → Authorised IPs* in Brevo, the
  API only accepts requests from those addresses: add the server's address or
  leave the option disabled. The log will say `Brevo rejected the send 401 ·
  unauthorized` and the message already points to that screen.
- **Unverified sender.** `MAIL_FROM` must come from a domain (or a standalone
  sender) validated in the account, never from a third-party domain.
- **Free-domain sender.** A `MAIL_FROM` with `@gmail.com`, `@protonmail.com` or
  similar cannot align with DMARC — you do not control its SPF or DKIM — and
  Gmail rejects it or sends it to spam. The sender must belong to the
  authenticated domain, even if the mailbox does not exist (`no-reply@`).
- **The Brevo code goes at the root.** The `brevo-code:<hash>` TXT record is
  published at `@`, not at a subdomain called `brevo-code`: placed there, Brevo
  treats it as missing even if `dig` returns it.
- **"Records do not match" when DNS is already published.** It is negative
  caching: on the laptop, `systemd-resolved` (`sudo resolvectl flush-caches`);
  in Brevo's verifier, the `NXDOMAIN` it cached before the records were created,
  for the SOA minimum TTL. Check with `dig @1.1.1.1` before touching anything.

`DMARC` is better as `p=none` at first: if something fails, emails still arrive
and the report says what happened.

### Other providers: `MAIL_WEBHOOK_URL`

The second path is a generic webhook: `POST` with
`{"to": "…", "subject": "…", "text": "…"}` and, if you define
`MAIL_WEBHOOK_TOKEN`, `Authorization: Bearer <token>`. The application does not
set a sender, so the adapter decides the `from`. It works for Resend
(`POST /emails`, a US company), Scaleway TEM or Mailjet (EU), Amazon SES (you
must leave the *sandbox*) or your own Worker. If you define this URL **and**
`BREVO_API_KEY`, the webhook is used and startup warns that the Brevo key is
going unused.

On either path there are two steps that get forgotten and then land in spam:
publishing **SPF and DKIM** (and a `DMARC` record at `p=none` to start) in the
domain's DNS, not only in the provider's panel, and using a sender from your own
domain, not a `no-reply@` from someone else's.

**Test it** without waiting for someone to register: the script sends a test
email through the same path as real ones (it does not touch the database). It
reads `/etc/wanderbibliothek/env` on its own — what you export by hand takes
precedence — so there is no need to repeat the key in the command. Run it with
plain `sudo`: with `sudo -u wanderbibliothek` it cannot read the file (it is
root-owned 600) and would say "no provider configured" even with the key set.

```bash
sudo npm --prefix /srv/wanderbibliothek/current run mail:test -- you@example.com
```

If it prints `Accepted by the provider`, the rest — the queue, one-time links —
works too. To see the full flow, request a reset from `/restablecer` and check
the log:

```bash
sudo journalctl -u wanderbibliothek -n 50 | grep '\[mail\]'
```

If `delivery failed: the message remains in the queue` appears, the specific
reason — the 401 or the 400 with Brevo's `code` — is one line above. The cron
(`/api/cron/maintenance`) retries with increasing backoff up to five times.

**Check that the domain inspires trust.** `mail:test` says whether the provider
accepts the message; it does not say whether the mailbox will want it. That
depends on three DNS records and the real queue:

```bash
sudo npm --prefix /srv/wanderbibliothek/current run mail:health
# or as JSON, to chain it:
sudo npm --prefix /srv/wanderbibliothek/current run mail:health -- --json
```

It reads `MAIL_FROM` to learn the domain and `MAIL_DKIM_SELECTOR` (the name the
provider gives: `brevo`, `s1`, `mail`…) to look up the public key. It checks
SPF, DMARC — warning if it is at `p=none`, which observes failures but does not
protect the domain — and the DKIM signature; it also counts pending emails,
those lost within 24 h and the delay in minutes of the oldest one. It exits 1
if there is something to fix, and the watchdog checks the queue on its own
every 15 minutes.

## 5. Service, proxy and scheduled jobs

```bash
sudo cp deploy/wanderbibliothek.service deploy/wanderbibliothek-maintenance.service \
        deploy/wanderbibliothek-maintenance.timer deploy/wanderbibliothek-backup.service \
        deploy/wanderbibliothek-backup.timer deploy/wanderbibliothek-watchdog.service \
        deploy/wanderbibliothek-watchdog.timer deploy/wanderbibliothek-verify.service \
        deploy/wanderbibliothek-verify.timer /etc/systemd/system/
sudo install -m 755 deploy/run-backup-container.sh /usr/local/sbin/wanderbibliothek-backup
sudo install -m 755 deploy/run-verify-backup.sh /usr/local/sbin/wanderbibliothek-verify
sudo install -m 755 deploy/watchdog.sh /usr/local/sbin/wanderbibliothek-watchdog
sudo install -Dm644 deploy/backup-key.sh /usr/local/lib/wanderbibliothek/backup-key.sh
# Hardening: ProtectSystem=strict, memory limits and the writable Next cache
# (`ReadWritePaths`), where `sharp` stores the resized images.
sudo install -Dm644 deploy/wanderbibliothek-hardening.conf \
  /etc/systemd/system/wanderbibliothek.service.d/hardening.conf
sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-04 /srv/wanderbibliothek/current
sudo systemctl daemon-reload
sudo systemctl enable --now wanderbibliothek wanderbibliothek-maintenance.timer \
  wanderbibliothek-backup.timer wanderbibliothek-watchdog.timer \
  wanderbibliothek-verify.timer

sudo cp deploy/nginx.conf /etc/nginx/sites-available/wanderbibliothek
# Proxy image cache (covers): nginx needs it created and writable.
sudo install -d -o www-data -g www-data -m 700 /var/cache/nginx/wb_images
# AI crawler blocking by User-Agent (`http` context).
sudo install -m 644 deploy/nginx-ai.conf /etc/nginx/conf.d/wanderbibliothek-ai.conf
sudo ln -s /etc/nginx/sites-available/wanderbibliothek /etc/nginx/sites-enabled/
# `nginx.conf` declares the 80 and 443 `default_server` to close the connection
# for anyone arriving via the bare IP or a domain we do not serve. Debian ships
# its own in `sites-enabled/default`: with both, `nginx -t` fails with
# "duplicate default server".
sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d biblioteca.example.com
sudo nginx -t && sudo systemctl reload nginx
```

The unit listens on `127.0.0.1:3000`; nginx serves the public side. The
`^~ /api/requests` location (the exact route and everything below it) runs
without buffering and with a long timeout: that is where the live messaging
channel (SSE) lives. ⚠ That prefix must also match the listing **without** a
trailing slash: with `location /api/requests/` the request fell into
`location /`, Next replied 301 to `/api/requests/` and the rule sent it back to
`/api/requests` (a loop the app does not follow). If the app says "the server
redirects in a loop", this `nginx.conf` has not been copied and reloaded.

The `nginx.conf` in `deploy/` adds several protections the application cannot
provide on its own:

- **Edge rate limiting** (`limit_req`): 10 requests/minute per IP on
  `/api/auth/*` and **120/minute (2 per second, with a burst of 120)** on the
  rest. The app already limits in SQLite, but every rejected attempt is still a
  write: the proxy limit keeps a flood from turning the disk into the
  bottleneck. The burst covers a normal page load (~30 files at once) and still
  cuts sweeps of hundreds of requests; with 300/minute and a burst of 300 **no
  scanner touched it**. If you put a CDN in front, configure `real_ip` or the
  limit will group all visitors under the CDN's IP.
- **Scanner routes with `444`**: `.php`, `.env`, `/.git`, `/wp-*`, `.sql`,
  `.bak`, `.old`, `.swp` and `.DS_Store` close the connection without a response
  and without reaching Node. They are logged in `access.log` with status 444, so
  the `wb-nginx-scan` jail keeps counting them. No real application route
  contains those patterns.
- **`/api/cron/maintenance` and `/api/metrics` only from the host itself**
  (`allow 127.0.0.1;`): the token already protects them, but there is no reason
  to expose a write job or an endpoint that accepts the same secret without a
  cookie.
- **TLS without session tickets** (nginx does not rotate that key by itself).
- **Compression and static files at the edge.** The vhost enables `gzip` (with
  `gzip_proxied any`; without it, it does not compress what comes from Node) and
  serves `public/{fonts,icons,hero}/` from the active release's disk. Assets
  under `/_next/static/` go through the container that generated the HTML: this
  prevents the operational checkout's files from mixing with those of the
  deployed image.
  Next serves those assets with immutable caching only when they exist; the hash
  is separated per commit so browsers do not reuse 404s from a previous version.
  That is why the app runs with `compress: false` in `next.config.ts`:
  compressing in both places only wasted CPU.
- **Edge image cache** (`proxy_cache`, `wb_images` zone). Covers — the heaviest
  thing the application serves — and their resized `/_next/image` versions are
  stored in `/var/cache/nginx/wb_images` (1 GB at most, one month untouched) and
  served by nginx without reaching Node. The key is the URL, which carries the
  cover version (`?v=…`): replacing an image is a new key, so there is nothing
  to invalidate by hand. `/_next/image` negotiates WebP or AVIF with `Accept`
  and replies `Vary: Accept`; since nginx's cache does not look at `Vary`, the
  format is part of the key (`$wb_image_format`, three values at most) so a
  browser is not served the WebP stored for another. Only `GET`/`HEAD` are
  cached: uploading or deleting a cover (`PUT`/`DELETE`) still reaches the
  application. Both deployment scripts clear this cache after the new version
  passes its health check, so legacy covers are fetched through metadata
  sanitization. To see what it does, look at the `X-Cache-Status` header (`HIT`,
  `MISS`, `STALE`, `UPDATING`); to clear it manually,
  `sudo find /var/cache/nginx/wb_images -type f -delete`.
- **HTTP/3** (`listen 443 quic` + `Alt-Svc`) with Debian's `http_v3_module`.
  UDP must be open: `sudo ufw allow 443/udp`. If the browser does not negotiate
  it, it continues over HTTP/2 with no change.
- **No `POST` to the root.** The application has no Server Actions, so a
  `POST /` can only be a probe: `location = /` closes it with `444`. The
  fail2ban filter counts those lines as scanning.
- **Separate quota for `/es/…` and `/en/…`** (`wb_lang`, 60/minute with a burst
  of 30): they are the same pages as the unprefixed route, for SEO, and a
  crawler walks all of them. A human visits one or two.
- **AI crawlers**: `deploy/nginx-ai.conf` replies `403` by User-Agent (with
  `robots.txt` and the sitemap exempt). ⚠ Its list must match
  `AI_TRAINING_BOTS` in `src/app/robots.ts`; when adding one, change both.

If you also use fail2ban (recommended), two jails cover the edge. The templates
are in `deploy/fail2ban/`:

```bash
sudo cp deploy/fail2ban/wb-nginx-scan.conf /etc/fail2ban/filter.d/
sudo cp deploy/fail2ban/wanderbibliothek.local /etc/fail2ban/jail.d/
sudo fail2ban-client reload
```

```ini
[wb-nginx-scan]     # 5 scanner 4xx responses in 1 h → 1 day ban
filter = wb-nginx-scan
logpath = /var/log/nginx/wanderbibliothek.access.log

[wb-nginx-limit]    # 5 "limiting requests" in 10 min → 1 h ban
filter = nginx-limit-req
logpath = /var/log/nginx/wanderbibliothek.error.log
ignoreip = 127.0.0.1/8 ::1 <server public IP>
```

The second jail's `ignoreip` matters: fail2ban already ignores its own IP
(`ignoreself`), but it is worth writing it down because the server itself
requests its public site when generating each book's social card, and a banned
IP would break those announcements.

### `www` and the canonical form

The file's `server_name` is a single name. If you also want to serve `www.`,
**do not add it to the same block**: redirect it to the canonical host. The
session is a `__Host-` cookie (bound to the exact host) and the messaging
encryption keys live in IndexedDB per origin, so anyone arriving via `www.`
would, in practice, be another person: another session and other keys, with the
old messages unreadable.

```nginx
# /etc/nginx/sites-available/wanderbibliothek-www
server {
    listen 80;
    listen [::]:80;
    server_name www.your-domain.de;
    return 301 https://your-domain.de$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name www.your-domain.de;
    ssl_certificate     /etc/letsencrypt/live/your-domain.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.de/privkey.pem;
    return 301 https://your-domain.de$request_uri;
}
```

Request the certificate with both names (`certbot --nginx -d your-domain.de -d
www.your-domain.de`) so the `www` block has valid TLS; otherwise the browser
stops before reading the redirect. And in `NEXT_PUBLIC_SITE_URL` always use
**the canonical form**.

## 6. First start

```bash
sudo systemctl start wanderbibliothek
sudo journalctl -u wanderbibliothek -f          # look for [env] lines
curl -fsS https://biblioteca.example.com/api/health
```

The first database access creates the database and applies every pending
migration (from v3 onward), so it may take a few seconds: run the `curl`
yourself instead of leaving it to the first visitor.

If the environment is incomplete, the service **starts but returns 500** and
leaves the reason in the log (`[env] ERROR …`). This is deliberate: it shows in
`systemctl status` without entering a restart loop.

Administration:

```bash
sudo -u wanderbibliothek ADMIN_PASSWORD='long-password' \
  npm --prefix /srv/wanderbibliothek/current run admin:create -- admin@biblioteca.example.com
```

Go to `/cuenta`, enable two-step verification (mandatory for moderating in
production) and then **delete `ADMIN_PASSWORD`** from the environment:

```bash
sudo -e /etc/wanderbibliothek/env      # remove ADMIN_EMAIL and ADMIN_PASSWORD
sudo systemctl restart wanderbibliothek
```

Final check:

```bash
BASE_URL=https://biblioteca.example.com npm --prefix /srv/wanderbibliothek/current run smoke
```

## 7. Deploying a new version

```bash
# 1) Back up before touching anything (migrations do not undo themselves)
sudo systemctl start wanderbibliothek-backup.service

# 2) New release and build (can be done in CI and copied)
cd /srv/wanderbibliothek/releases && git clone --depth 1 … 2026-11-20
cd 2026-11-20 && npm ci && npm run build

# 3) Switch the symlink and restart
sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-20 /srv/wanderbibliothek/current
sudo systemctl restart wanderbibliothek

# 4) Check, and roll back if something goes wrong
curl -fsS https://biblioteca.example.com/api/health
BASE_URL=https://biblioteca.example.com npm --prefix /srv/wanderbibliothek/current run smoke
# rollback:
# sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-04 /srv/wanderbibliothek/current && sudo systemctl restart wanderbibliothek
```

Old releases can be deleted once that date's backup is off the server.

Since the November 2026 version, `deploy.sh` also updates the nginx vhost: if it
finds the old `location /api/requests/` rule it changes it to
`location ^~ /api/requests` and reloads nginx. Previously it did not touch the
proxy, so a fix in `deploy/nginx.conf` never reached the server — which is how
the `/api/requests` redirect loop appeared.

## 8. Backups and restore

- **Every 6 hours** (`wanderbibliothek-backup.timer`, at 00:20, 06:20, 12:20 and
  18:20, with up to 15 minutes of jitter; it used to be daily, but the database
  is ~2 MB and the RPO drops from 24 h to 6 h), with `integrity_check` and
  rotation of 14 backups.
- **Every Sunday at 05:10** (with up to 20 minutes of jitter),
  `wanderbibliothek-verify.timer` decrypts the most recent backup and opens it
  in full with the same code that serves the site.
  If restore is not possible, the unit fails and the reason is left in
  `journalctl -u wanderbibliothek-verify`.
- With `WANDERBIBLIOTHEK_BACKUP_KEY` backups are encrypted (AES-256-GCM) and the
  plain `.db` is deleted. **Keep that key off the server**: without it the
  backups are useless. Without a key the backup would be left in plain text with
  emails and hashes inside, so `env-check` treats it as an **error** and the
  service does not start (an **empty** variable counts as missing: that was the
  reason backups were stored unencrypted). `WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1`
  still exists for test environments that accept the gap.
- A backup on the same disk as the database does not protect against what
  happens most often (the disk or the server itself disappears entirely).
  `deploy/backup-pull.sh` **pulls** the backups to the laptop, which works even
  behind NAT:

  ```bash
  # Once: the key, off the server and with tight permissions.
  ssh wanderbibliothek 'sudo sed -n "s/^WANDERBIBLIOTHEK_BACKUP_KEY=//p" /etc/wanderbibliothek/env' \
    > ~/.config/wanderbibliothek/backup-key
  chmod 600 ~/.config/wanderbibliothek/backup-key

  # Daily: the units in `deploy/backup-pull-user.{service,timer}`.
  install -Dm644 deploy/backup-pull-user.service ~/.config/systemd/user/wanderbibliothek-backup-pull.service
  install -Dm644 deploy/backup-pull-user.timer   ~/.config/systemd/user/wanderbibliothek-backup-pull.timer
  systemctl --user daemon-reload
  systemctl --user enable --now wanderbibliothek-backup-pull.timer
  loginctl enable-linger "$USER"   # runs even when you are not logged in
  ```

  The script pulls, rotates (30 backups), **decrypts the most recent one and
  checks that it opens as SQLite**: a backup that cannot be restored is not a
  backup.
- `WANDERBIBLIOTHEK_BACKUP_HOOK` allows the opposite: sending them from the
  server (`rsync`, `rclone`, S3); `env-check` warns if there is neither a hook
  nor an external copy. In image mode, the backup runs with the active
  container's digest (and fails if it does not match `image.env`), without
  network and as the app's unprivileged UID. The web process does not receive
  the backup key or the hook command: the wrapper validates the key on the host
  and passes only a non-secret indicator to the web process. The hook then runs
  on the host, also as that UID and with a clean environment (path, HOME and
  `BACKUP_FILE`), so app keys are not leaked to external tools and third-party
  tools do not get into the image. If the provider requires credentials, store
  them in the app user's configuration, outside `/etc/wanderbibliothek/env`.
  In code mode `scripts/backup.ts` does the same: the hook is launched with
  `PATH`, `HOME`, `USER` and `BACKUP_FILE`, not with the service environment.
  Practical consequence: a hook that needs credentials must read them from its
  own file (the `rclone` configuration in the user's HOME), not from variables
  in `/etc/wanderbibliothek/env`.
- **Restore rehearsal**: `npm run db:verify` decrypts the most recent backup (or
  the one passed to it), opens it read-only as the application would, runs
  `integrity_check` and `foreign_key_check`, checks the schema version and
  counts the main tables. It exits with an error if the backup cannot be
  restored, so it works for a periodic check:

  ```bash
  WANDERBIBLIOTHEK_BACKUP_KEY="$(cat ~/.config/wanderbibliothek/backup-key)" \
    npm run db:verify -- ~/backups/wanderbibliothek-2026-11-14T03-20-00-000Z.db.enc
  ```

- **Bare-metal drill**: `npm run db:restore-drill` goes one step further. It
  decrypts the backup into an **empty** directory, opens it as a fresh install
  would and applies the current code's migrations. It fails on a corrupt backup,
  a broken foreign key, a missing table or a backup from a **newer** schema
  (restoring that with the old release would lose data). `deploy/restore-drill.sh`
  wraps it and, when `WANDERBIBLIOTHEK_IMAGE` (pinned by digest) and
  `WANDERBIBLIOTHEK_DRILL_ENV` are set, boots that image against the restored
  directory on a spare port and waits for `/api/health` and `/api/version`:

  ```bash
  WANDERBIBLIOTHEK_BACKUP_KEY="$(cat ~/.config/wanderbibliothek/backup-key)" \
    ./deploy/restore-drill.sh ~/backups/wanderbibliothek-2026-11-14T03-20-00-000Z.db.enc

  # Including the boot step (env-file with the production secrets, plain KEY=value):
  WANDERBIBLIOTHEK_BACKUP_KEY=… WANDERBIBLIOTHEK_IMAGE="$(cat /etc/wanderbibliothek/image.env | sed -n 's/^WANDERBIBLIOTHEK_IMAGE=//p')" \
    WANDERBIBLIOTHEK_DRILL_ENV=/root/wb-drill.env ./deploy/restore-drill.sh /ruta/copia.db.enc
  ```

  The drill never touches the live data directory: it works on a temporary
  directory, binds the container to `127.0.0.1`, and removes everything on exit.
  Run it on a clean host (or at least with an empty directory) before trusting a
  backup; the weekly `db:verify` timer only proves the file is readable.

Restore (rehearse it before you need it):

```bash
sudo systemctl stop wanderbibliothek
# `--import tsx` resolves from the working directory, so you have to be in the
# release: from `/` the command fails with
# "Cannot find package 'tsx'" and the restore never starts.
cd /srv/wanderbibliothek/current
sudo -u wanderbibliothek WANDERBIBLIOTHEK_BACKUP_KEY="$KEY" \
  node --import tsx scripts/decrypt-backup.ts \
  /var/backups/wanderbibliothek/wanderbibliothek-2026-11-04T03-20-00-000Z.db.enc /tmp/restore.db
sudo install -m 600 -o wanderbibliothek -g wanderbibliothek /tmp/restore.db /var/lib/wanderbibliothek/wanderbibliothek.db
sudo rm -f /var/lib/wanderbibliothek/wanderbibliothek.db-wal /var/lib/wanderbibliothek/wanderbibliothek.db-shm
sudo systemctl start wanderbibliothek
curl -fsS https://biblioteca.example.com/api/health
```

If the backup was not encrypted, skip `decrypt-backup.ts` and copy the `.db`
directly. The backup key does **not** travel in `/etc/wanderbibliothek/env` if
you keep it off the server: pass it on the command line, as above.

### Watchdog (health, disk, backups and certificate)

`deploy/watchdog.sh` is run by `wanderbibliothek-watchdog.timer` every 15 minutes
as root and checks that `/api/health` responds and reports
`proxy: "trusted"`, that the disk is not above 85 %, that the latest backup is
less than 12 h old and that the certificate does not expire in less than 14
days. Anything that fails goes to the journal; if you define
`ERROR_WEBHOOK_URL` in `/etc/wanderbibliothek/env`, a JSON payload is also sent
to that webhook. The thresholds can be changed with `MAX_DISK_PCT`,
`MAX_BACKUP_AGE_H` and `MIN_CERT_DAYS`.

In addition, with `MAINTENANCE_TOKEN` defined, it requests
`/api/metrics?format=prometheus` and watches what the health probe cannot see:

| What | Variable | Default |
|---|---|---|
| Emails given up as lost within 24 h | — | any value > 0 warns |
| Emails in a failed state | `MAX_MAIL_FAILED` | `0` |
| Delay of the oldest email | `MAX_MAIL_WAIT_MIN` | `120` |
| WAL size (checkpoint not completing) | `MAX_WAL_MB` | `512` |
| Server error ratio | `MAX_ERROR_PCT` | `5` |
| Minimum requests to compute it | `MIN_REQUESTS_ERRORS` | `50` |

An email that the provider accepts and the mailbox sends to spam leaves no
trace: the database marks it as delivered and the person never sees their link.
That is why the queue is watched here and the domain records are checked with
`npm run mail:health` (see the email section).

`/api/metrics` is **host-only** in nginx, like maintenance: it accepts the same
token without a cookie, and there is no reason to publish it. Read it like this:

```bash
sudo curl -fsS -H "Authorization: Bearer $(sudo sed -n 's/^MAINTENANCE_TOKEN=//p' /etc/wanderbibliothek/env)" \
  "http://127.0.0.1:3000/api/metrics?format=prometheus" | head
```

```bash
sudo systemctl start wanderbibliothek-watchdog.service   # test it by hand
sudo journalctl -u wanderbibliothek-watchdog -n 20
```

Each run also leaves a line in `/var/lib/wanderbibliothek/watchdog.csv` with the
time, HTTP code, time to first byte, disk, memory, hours since the last backup,
certificate days and status. The journal says what happened in the last quarter
of an hour; the CSV lets you look at the week (`awk -F, '$8 != "ok"' …`) when
someone says "it was slow yesterday".

The service invokes `/usr/local/sbin/wanderbibliothek-watchdog`, not a path in
the checkout, so its code is fixed when installed and updated together with the
units.

With `WATCHDOG_PING_URL` (for example a healthchecks.io check), each run sends a
`GET` to that URL and, when something fails, to `<URL>/fail`: the external
service can then notify you by email or Telegram without opening another port on
the server.

### External availability (`uptime-check.sh`)

The watchdog lives **on** the server: if the whole server goes down, the
watchdog goes down with it and nobody is alerted. `deploy/uptime-check.sh`
closes that gap from another machine (the laptop, a home box, a container at
another provider):

```bash
URL=https://your-domain/api/health ./deploy/uptime-check.sh   # one run
```

It requests the configured URL (by default
`https://wanderbibliothek.org/api/health`) with a timeout, stores state in
`~/.local/state/wanderbibliothek/` and only sends a desktop notification on
**changes** (DOWN once when the failure starts, RECOVERED when it returns), so
it does not repeat the alert on every run. The units in
`deploy/wanderbibliothek-uptime.{service,timer}` run it every five minutes on
that machine:

```bash
mkdir -p ~/.local/bin ~/.local/state/wanderbibliothek
install -m 755 deploy/uptime-check.sh ~/.local/bin/wanderbibliothek-uptime-check
install -m 644 deploy/wanderbibliothek-uptime.service deploy/wanderbibliothek-uptime.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now wanderbibliothek-uptime.timer
```

To monitor another instance, set `URL` in a user drop-in before enabling the
timer:

```ini
# ~/.config/systemd/user/wanderbibliothek-uptime.service.d/url.conf
[Service]
Environment=URL=https://your-domain/api/health
```

## 9. Quick diagnosis

| Symptom | Usual cause |
|---|---|
| Everything returns 500 and the log says `[env] ERROR …` | A required variable from section 4 is missing |
| Login "works" but there is no session after reloading | The site is served over HTTP: the `__Host-` cookie needs TLS |
| Verification emails do not arrive | The provider is missing (`BREVO_API_KEY` + `MAIL_FROM`, or `MAIL_WEBHOOK_URL`) or the provider rejects it; the reason appears in `journalctl \| grep '\[mail\]'` and retries in the cron outbox |
| `/admin` and moderation routes return 403 | The admin account does not have 2FA enabled (or `APP_ENCRYPTION_KEY` is missing) |
| 429 for everyone | `TRUST_PROXY` not enabled: all IPs share the `direct` quota |
| 429 only on `/api/auth/*` with `limit_req` in the log | The nginx limit: 10 requests/minute per IP. Raise `rate`/`burst` if there is a CDN in front without `real_ip` |
| `/api/cron/maintenance` returns 403 when called from outside | Correct: nginx only lets it in from loopback |
| New messages do not appear on their own | nginx buffering on `/api/requests/` |
| When requesting a book, the app says "the server responds with a redirect" and the site says "No connection to the server" | The vhost still has `location /api/requests/ {` (with a slash). nginx sends `/api/requests` to `/api/requests/`, Next sends it back to `/api/requests`, and the 301/308 bites its own tail. It shows with `curl -sI https://your-domain/api/requests \| grep -i location`. Fix (one line, without touching the rest of the file, which belongs to certbot): `sudo sed -i 's\|location /api/requests/ {\|location ^~ /api/requests {\|' /etc/nginx/sites-available/wanderbibliothek && sudo nginx -t && sudo systemctl reload nginx`. `deploy.sh` fixes it automatically on the next deployment |
| A new cover takes a while to appear | Proxy cache: the correct URL carries `?v=…` (generated by the app on upload). If `curl -sI` of the image returns `X-Cache-Status: HIT` with the old image, it was uploaded without a version: clear `/var/cache/nginx/wb_images` |
| Uploading a cover returns **413** | nginx's `client_max_body_size` (128 KB globally, intended for JSON). The `/api/cover/` route needs its own `location` with 8 MB; the proxy log says so: `error.log` → `client intended to send too large body`. Without that, the image does not even reach the application |
| The disk grows and the database does not shrink | Normal: SQLite does not compact on delete; maintenance runs `PRAGMA optimize` and `wal_checkpoint(TRUNCATE)` |
| There are no backups in `/var/backups/wanderbibliothek` | Check `journalctl -u wanderbibliothek-backup`; if the log mentions `tsx`, the release was installed without production dependencies or `WorkingDirectory` is missing |
| `Failed to start server … EADDRINUSE` | Another `next start` or a `.next` from another release is running |

### Access and attack report

`deploy/informe-accesos.sh` builds the day's report from the laptop: it connects
over SSH, reads the `ssh` journal, the nginx access logs (including rotated
ones), `/var/log/fail2ban.log` and the database, and prints a summary of failed
attempts, tried usernames, bans, probes blocked with `444`, `5xx` responses,
failed logins on `/api/auth/login` and service status. It is read-only: it writes
nothing and triggers no nginx limits.

```bash
./deploy/informe-accesos.sh            # today (server day)
./deploy/informe-accesos.sh --ayer     # the previous day
./deploy/informe-accesos.sh --dias 7   # seven days ago
npm run informe:accesos -- --json      # one JSON line, for cron or a webhook
```

Two details worth knowing:

- **logrotate does not run exactly at midnight**: `access.log.1` may contain the
  first hour of the day. The script reads the rotated files and filters by the
  line's date, so the day's total is complete (looking only at the current
  `access.log` leaves those requests out).
- **IPs with successful SSH access are automatically excluded** from the
  attacker list (including the laptop that runs the report). If you need to add more:
  `WB_EXCLUIR=1.2.3.4,5.6.7.8 ./deploy/informe-accesos.sh`.

It exits with code 1 when there is something to review (5xx, `Accepted
password` over SSH, `/api/health` not 200 or fail2ban with no bans despite
failures), so it works as-is in a cron job with `ERROR_WEBHOOK_URL`.

## Continuity and handover

An instance should not depend on a single person. Before opening registration:

- Create at least **two administration accounts** (`npm run admin:create`). The second can remain inactive, but it must exist and have the second factor configured.
- To moderate without administering, create a moderation account (`npm run moderator:create`): it reviews reports and hides content, but does not suspend accounts.
- Keep an encrypted copy of the database and of `APP_ENCRYPTION_KEY` **off the server**; without the key, backups cannot be restored.
- Document who controls the domain, DNS, the server provider, email and the repository.
- Write down the handover procedure: which credentials must be transferred, where the backups are and how a restore is checked (`npm run db:verify`).
- Once a year, check that the second person can log in, restore a backup and publish a change.

The rules of conduct, moderation and appeals are published at `/normas`; the
reference document is [`GOVERNANCE.md`](../GOVERNANCE.md).

## 10. Known limits

- **A single instance.** SQLite has one writer, so several replicas require
  PostgreSQL. The live channel is not the problem: the in-memory bus only saves
  latency and the source of truth is read from the database, so two processes
  agree within up to 15 s.
- **Every upgrade restarts the process.** There is no blue/green: the service
  stops, the new image or release starts and `/api/health` is checked; if it
  fails, it rolls back to the previous one. That is a few seconds without
  service, and there is no high availability: two replicas require PostgreSQL.
- **The operation scripts need `tsx`**, which is in `dependencies` on purpose
  (it is not a devDependency): that way they also work with
  `npm ci --omit=dev` and inside the image.
- **The database is not migrated backwards**: for a deployment that changes the
  schema, the previous backup is the rollback path.
- **Logs go to journald** (`journalctl -u wanderbibliothek`) on a host, and to
  `docker compose logs` in a container. With `ERROR_WEBHOOK_URL`, errors are also
  forwarded to an external service. The privacy policy promises 14 days of
  server logs, so install the retention that comes with the project instead of
  trusting the distribution's default:

  ```bash
  sudo install -m 644 deploy/logrotate-wanderbibliothek /etc/logrotate.d/wanderbibliothek
  sudo install -d /etc/systemd/journald.conf.d
  sudo install -m 644 deploy/journald-14-days.conf \
    /etc/systemd/journald.conf.d/90-wanderbibliothek.conf
  sudo systemctl restart systemd-journald
  ```
- **The off-server backup is an `rsync`/`scp` to one of your machines**
  (`deploy/backup-pull.sh`). A copy in a bucket (S3, Backblaze B2, R2) requires
  an account and its keys; when those exist, the place it fits is
  `WANDERBIBLIOTHEK_BACKUP_HOOK` (it receives the path in `$BACKUP_FILE`, so
  `rclone copy "$BACKUP_FILE" remote:`) or a separate Litestream that replicates
  the WAL. Neither is enabled by default: without credentials it cannot be
  tested, and a backup that has never been restored is not a backup.
- **`ERROR_WEBHOOK_URL` and `WATCHDOG_PING_URL` are empty**: the code uses them
  if they exist, but the destination is chosen by the operator (Slack,
  healthchecks.io, an email). There is deliberately no default.

## 11. Docker

An alternative to the systemd service, with the same behaviour. The `Dockerfile`
is multi-stage (the runtime only carries production dependencies) and
`docker-compose.yml` mounts two volumes: data and backups.

```bash
cp deploy/env.example .env      # NEXT_PUBLIC_SITE_URL=https://your-domain…
docker compose up -d --build
docker compose ps               # it must be "healthy"
curl -fsS http://127.0.0.1:3000/api/health
```

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (captcha) goes in the container's `.env` like
any other variable: it is read on the server on every request and is not
embedded at build time.

```bash
# in the container's .env, next to the rest
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAA…
docker compose up -d
```

In `.env`, change only the data paths:

```
WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db
WANDERBIBLIOTHEK_BACKUP_DIR=/backups
```

(`docker-compose.yml` already sets them, so there is nothing to change if you
start from `deploy/env.example`).

The application listens on the host's `127.0.0.1:3000`: put the same nginx from
`deploy/nginx.conf` in front (the `proxy_pass` already points to
`127.0.0.1:3000`). To test locally, `http://localhost:3000` is enough: the
browser treats localhost as a secure context and accepts the `__Host-` cookie.

Jobs and administration inside the container:

```bash
# Administrator (first time only)
docker compose exec -T app node --import tsx scripts/create-admin.ts admin@your-domain 'long-password'

# Verify an email by hand
docker compose exec -T app node --import tsx scripts/verify-user.ts someone@example.com

# Backup
# (the /backups volume is what you should take off the server)
```

Schedule from the **host** (systemd timer or cron), not inside the container:

```cron
*/15 * * * *  curl -fsS -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" http://127.0.0.1:3000/api/cron/maintenance
20 3 * * *    cd /srv/wanderbibliothek && docker compose exec -T app node --import tsx scripts/backup.ts
```

Notes:

- `docker compose exec` needs the container running; if the service is down,
  start it first with `docker compose start app`.
- The `HEALTHCHECK` (and compose's) queries `/api/health`: if the environment is
  incomplete, the container stays **unhealthy** and `docker compose logs` shows
  the `[env] ERROR …` lines.
- Releases are changed with `docker compose pull` + `up -d --no-build` if the
  image is pinned by digest, or with `docker compose build` + `up -d` if it is
  built on the server. The data volume survives in both cases.
- The image build is validated in CI (the `imagen` job); there is no need to
  build it on the server.

## Verifying a release (software and content)

An instance can claim "I run this code" in three ways, from least to most proof.
The first two are already implemented and do not depend on trusting whoever
administers the server; the third is infrastructure and is explained at the end
so that nobody believes it is covered.

### 1. What code it claims to be serving

`GET /api/version` is public and returns, without anyone's data:

```json
{
  "commit": "4e32f58…",
  "commitUrl": "https://github.com/gallardoalba/WB/commit/4e32f58…",
  "image": "sha256:…",
  "builtAt": "2026-11-15T10:20:30.000Z",
  "repository": "https://github.com/gallardoalba/WB",
  "sourceUrl": "https://github.com/gallardoalba/WB/tree/4e32f58…"
}
```

If the installation does not know which commit it runs, the fields are `null`:
nothing is invented. The footer shows the same commit when it exists.

- **systemd from code:** `deploy/deploy.sh` writes `.build-info.json` in each
  release with the clone's commit and the build time. That is what this mode
  has, but there is no digest to publish: for that, use
  [signed image deployment](#signed-image-deployment).
- **Docker:** the commit and time enter as *build args* and remain inside the
  image (`docker inspect` shows them in `org.opencontainers.image.revision`).
  The digest is published if you deploy with `WANDERBIBLIOTHEK_IMAGE` pinned by
  digest, because the reference is what contains it.

### 2. That the image came from this repository

Every `v*` tag runs `.github/workflows/release.yml`, which:

- builds and publishes to GHCR **by digest**;
- attaches SLSA provenance (`mode=max`) and an SBOM of the image;
- signs with cosign in keyless mode, with the workflow's own identity;
- publishes a release with `sbom.cdx.json`, `SHA256SUMS`, `image-digest.txt`
  and `image-reference.txt`.

To deploy a verified release, pin the digest in `.env` and do not let Compose
build:

```bash
# .env
WANDERBIBLIOTHEK_IMAGE=ghcr.io/gallardoalba/wb@sha256:…

./deploy/verify-release.sh      # reads WANDERBIBLIOTHEK_IMAGE
docker compose pull
docker compose up -d --no-build
```

`deploy/verify-release.sh` requires `cosign` and checks the signature against
this repository and this workflow; if `slsa-verifier` is present, it also checks
the provenance. It rejects a reference without a digest: a tag can move and the
signature would not follow it.

```bash
cosign verify ghcr.io/gallardoalba/wb@<digest> \
  --certificate-identity-regexp '^https://github\.com/gallardoalba/WB/\.github/workflows/release\.yml@refs/tags/.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

slsa-verifier verify-image ghcr.io/gallardoalba/wb@<digest> \
  --source-uri github.com/gallardoalba/WB
```

The image does not promise bit-for-bit reproducibility: Next, npm and
filesystem timestamps mean two builds can differ even when the code is the same.
What binds the image to the code is the SLSA provenance: it says which workflow,
which commit and which steps produced it, and the keyless signature says that
workflow belongs to this repository. To audit the contents, rebuild from that
commit with `docker build --build-arg APP_COMMIT_SHA=<sha>` and compare the
behaviour and files you care about; if you need byte-for-byte equality, that is
the next step (Nix or `rebuilderd`), not something claimed today.

### 3. That public content is not rewritten silently

`/api/transparency` publishes **signed snapshots of the public catalogue**. Each
one contains:

- `merkleRoot`: Merkle root of all public works;
- `payloadHash`: SHA-256 of the exact NDJSON that can be downloaded;
- `previousRoot`: root of the previous snapshot (chain);
- `signature` and `publicKey`: Ed25519 signature in base64 and the key it was
  signed with (or `null` if the instance has no key).

The content is downloaded from `/api/transparency/export`
(`application/x-ndjson`, one work per line) and **carries only what is already
public**: title, authorship, edition, category and language, number of copies
and cities. Never who holds each copy, nor emails, nor personal identifiers.
That is why it can be served without a session and without redacting anything.

The maintenance cron creates one snapshot per day. To sign them, generate an
Ed25519 key (PKCS#8 in base64, which is what the variable accepts) and put it in
the service environment:

```bash
node -e "const{generateKeyPairSync}=require('crypto');process.stdout.write(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))" > /tmp/wb-transparency.key
# TRANSPARENCY_SIGNING_KEY=$(cat /tmp/wb-transparency.key)   → edit /etc/wanderbibliothek/env
sudo systemctl restart wanderbibliothek
rm /tmp/wb-transparency.key
npm run transparency:snapshot       # or wait for the cron
```

Verify from outside, without the server's database or code:

```bash
npm run transparency:verify -- --url https://your-domain
```

The verifier downloads the snapshot and its NDJSON, recomputes the hash and
root, checks the signature and that the chain of roots has no broken links. If
you are an external witness, keep the key fingerprint and the root you saw and
pass them with `--snapshot <id> --key-fingerprint <sha256> --pin <root>`: if the
instance rewrites that snapshot or starts signing with another key, the check
fails. Without a signature, the verifier exits with an error: an unsigned
snapshot is useful for comparing content, not as cryptographic proof.

What it guarantees: that a change to what is published leaves a trace and that a
past snapshot cannot be replaced by another without breaking the signature or
the chain. What it does not guarantee: that the process responding is exactly
that image. Only hardware attestation (next section) provides that.

### 4. Cryptographic proof of the process (not implemented)

If the threat model includes whoever administers the server or the machine's
provider, signing images is not enough: boot and filesystem measurements must be
taken, and a proof that can be verified outside must be published.

- **TPM 2.0 + measured boot + IMA/dm-verity**, with an attestation server such as
  [Keylime](https://keylime.dev/). The host publishes a TPM-signed *quote* with
  the PCRs; the verifier compares it against the expected state. It covers the
  kernel, initramfs and file integrity, not the database configuration.
- **Confidential computing**: AMD SEV-SNP or Intel TDX (Azure/GCP Confidential
  VM) or AWS Nitro Enclaves. Projects such as
  [Constellation](https://constellation.edgeless.systems/) build verifiable
  Kubernetes with `constellation verify`. Here trust moves to the CPU
  manufacturer; it does not disappear.

Neither is integrated into this repository and neither can be enabled from the
application: they depend on the host, the hypervisor and, in practice, on a
second channel to publish the *quote*. Until they exist, Wanderbibliothek's
transparency is **detectable, not impossible**: open code, a signed image, a
published commit and signed snapshots of the content.

## Signed image deployment

The deployment in the previous sections builds from code and runs `next start`
directly. It works, but then **there is no OCI artefact** and `/api/version`
publishes `image: null`: the commit is self-reported and there is no signature
tying the running files to the GitHub release.

This section changes only the web service to the signed GHCR image. Data stays
on the host, backups and timers do not change, and neither does nginx. The
difference is that `/api/version` starts publishing the digest, and anyone can
check it with `cosign verify` and `slsa-verifier`.

### Requirements

```bash
sudo apt-get update && sudo apt-get install -y docker.io
sudo systemctl enable --now docker

# cosign (official binary; the rest of Sigstore is not needed)
curl -fsSL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 \
  -o /tmp/cosign && sudo install -m 755 /tmp/cosign /usr/local/bin/cosign
```

The image is public: no `docker login` is needed to pull it.

### Initial unit installation

```bash
# 1. Wrapper that starts the container with the host mounts.
sudo install -m 755 deploy/run-container.sh /usr/local/sbin/wanderbibliothek-container
sudo install -Dm644 deploy/backup-key.sh /usr/local/lib/wanderbibliothek/backup-key.sh

# 2. systemd unit (replaces the code service's unit).
sudo cp -a /etc/systemd/system/wanderbibliothek.service \
  /etc/systemd/system/wanderbibliothek.service.source   # rollback
sudo install -m 644 deploy/wanderbibliothek-image.service \
  /etc/systemd/system/wanderbibliothek.service
sudo systemctl daemon-reload

# 3. Next cache writable by the host user.
sudo install -d -m 700 -o wanderbibliothek -g wanderbibliothek \
  /var/lib/wanderbibliothek/next-cache

# 4. The deploy command, available without depending on the clone.
sudo install -m 755 deploy/deploy-image.sh /usr/local/sbin/wanderbibliothek-deploy-image

# 5. First image, verified and pinned by digest.
sudo deploy/deploy-image.sh --ref <version>
```

`deploy-image.sh` pulls the tag, resolves the digest, **verifies the keyless
signature** against this repository, writes `/etc/wanderbibliothek/image.env`
(root-owned 600) and restarts the service. If `/api/health` does not respond, it
restores the previous image and starts again.

Check:

```bash
curl -fsS http://127.0.0.1:3000/api/version | python3 -m json.tool
# "commit": "e8d969c…", "image": "sha256:844acd…"

docker inspect --format '{{.Config.Labels}}' \
  "$(sed -n 's/^WANDERBIBLIOTHEK_IMAGE=//p' /etc/wanderbibliothek/image.env)"
```

### Decoupling operations from `current`

In an existing installation, first deploy a signed image (the current release,
for example), then run the installer from the checkout:

```bash
sudo wanderbibliothek-deploy-image --ref <version>
```

And then:

```bash
sudo deploy/install-image-operations.sh
```

The installer only works if it detects that systemd is already running image
mode. It keeps dated copies of the units, the hardening file and the nginx
vhost; replaces the asset paths under `current` with the proxy to the container,
installs backup/watchdog in `/usr/local/sbin`, restarts the service, checks
health and enables the timers. If nginx does not validate, it restores the
vhost; if the restart or the health check fails, it restores the vhost, the units
and the previous wrappers and tries to restart the service. It does not delete
the checkout or disable `deploy.sh`.

Explicit test of the backup in image mode:

```bash
sudo systemctl start wanderbibliothek-backup.service
sudo journalctl -u wanderbibliothek-backup.service -n 40 --no-pager
```

The backup and covers are generated with the running image's code. The encrypted
database, the backup files and the watchdog stay on the host; the key is not
published or copied to external storage together with the data.

### Upgrading and rolling back

```bash
sudo deploy/deploy-image.sh --ref <version>     # new signed release
sudo deploy/deploy-image.sh --rollback          # back to the previous one

# or, if installed in /usr/local/sbin:
sudo wanderbibliothek-deploy-image --ref <version>
```

The application's real rollback is changing the digest. After installing the
decoupling, `current` is no longer a dependency of the web, backup or watchdog
services, nginx or their units; it can be kept for administrative tools and as
an explicit code-deployment alternative.

### What does not change

- **Database and covers**: they remain in `/var/lib/wanderbibliothek`, mounted
  at `/data`. The container runs with the host `wanderbibliothek` user's UID/GID
  so that files keep their owner.
- **Backups**: the one-shot container uses the same digest as the active web
  container; the data and the key remain under the host's control.
- **nginx and TLS**: nginx keeps TLS and proxies HTML and assets to
  `127.0.0.1:3000`. Maintenance and watchdog jobs remain host services.

### Going back to code deployment

```bash
sudo cp -a /etc/systemd/system/wanderbibliothek.service.source \
  /etc/systemd/system/wanderbibliothek.service
sudo install -m 644 deploy/wanderbibliothek-hardening.conf \
  /etc/systemd/system/wanderbibliothek.service.d/hardening.conf
sudo systemctl daemon-reload
sudo systemctl restart wanderbibliothek
```

Do not mix the two modes: if you go back to `deploy.sh` with the image unit
installed, the service will keep starting the container. Restore the unit before
deploying from code.

## 12. Privacy and data retention

What the database stores and how long it lives, so that the privacy policy you
publish tells the truth (Art. 5(1)(e) and 13 GDPR/DSGVO):

| Data | Where | Retained |
|---|---|---|
| Name, email, city, biography, language | `users` | Until the person deletes their account |
| Password | `users.password_hash` (scrypt, parameters inside the hash) | Same; never in plain text |
| Sessions | `sessions` | 14 sliding days, 30 at most |
| Confirmation and reset links | `account_tokens` | 24 h / 1 h; single use |
| Sent emails (body with links) | `jobs` (`kind = 'mail'`) | 7 days for delivered and lost ones |
| Visitor IP (quotas and brute-force protection) | `throttle`, `auth_attempts` | Daily pseudonym, never the address; ≤ 1 day |
| Platform notifications | `notifications` | 90 days if read, 180 either way |
| Public activity (wall) | `events` | 180 days |
| Moderation audit | `admin_audit` | `AUDIT_RETENTION_DAYS` (0 = forever) |
| Messages | `messages` | Only the encrypted envelope and metadata; the text is decrypted by browsers |

Account deletion: the user row is anonymised; sessions, notifications, lists,
owned clubs, blocks, tokens, read markers, personal notes on their copies and
**device keys** (`user_keys` and `public_key_history`, which `ON DELETE CASCADE`
does not reach because the `users` row is not deleted) are deleted; **direct
conversations are deleted in full** for both parties, and exchange messages and
reviews are kept with the author already anonymised because they are part of
other people's history. The database uses `secure_delete`, so deleted content
does not remain in the file's free pages.

Safeguards the application already provides: quotas store a **daily pseudonym**
of the IP address (an HMAC with a salt derived from `APP_ENCRYPTION_KEY`, not the
address), **covers are downloaded on the server** and cached in
`WANDERBIBLIOTHEK_COVER_CACHE` (the browser does not contact Open Library), the
catalogue is visible without a session but **what gets indexed are work pages**
(`/werk/<id>`, without the name of whoever offers it), `/descubrir`, `/libro`,
`/u` and the other views with personal data are in `robots.txt`'s `disallow`,
and registration requires **declaring that you are 16 or older**.

Three decisions remain yours:

1. **Controller data.** `/datenschutz` and `/aviso-legal` already exist, in
   Spanish and German, with what the code actually does. They are completed with
   `LEGAL_CONTROLLER`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` and, where
   applicable, `LEGAL_VAT_ID`; without them the pages show a visible notice that
   they are incomplete and startup reminds you in the log. The text is still a
   technical draft: review it with whoever assumes legal responsibility.
2. **Backups.** Each backup contains data that may already have been deleted
   from the database: the most recent `WANDERBIBLIOTHEK_BACKUP_KEEP` are kept
   (14 by default, one every six hours) and the external copy keeps 30. The
   policy states this; do not restore a backup for normal use.
3. **Third parties that see the visitor.** Your email provider (it receives the
   email and the notice text, never the content of encrypted messages),
   Cloudflare if you enable Turnstile, and the hosting provider.
   Open Library/Internet Archive only sees the server's IP when requesting a
   cover.

What the platform does **not** do: no analytics, no fonts, no advertising
cookies (only the session cookie, which is necessary and does not require a
consent banner); the service worker does not cache responses and the private
encryption key never leaves the browser.

## 13. Legal checklist before opening

The application publishes `/datenschutz` and `/aviso-legal` with what the code
actually does, but there are decisions that **only the person operating the
service can make**. `npm run smoke` fails if the legal pages are incomplete, so
this checklist cannot be silently forgotten.

- [ ] Defined in `/etc/wanderbibliothek/env`: `LEGAL_CONTROLLER`,
      `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` and, if they exist, `LEGAL_REGISTER`,
      `LEGAL_VAT_ID` and `LEGAL_PHONE`.

      To avoid editing it by hand:

      ```bash
      sudo -E npm --prefix /srv/wanderbibliothek/current run legal:env -- \
        --name "Name or company name" \
        --address "Street 1, 00000 City, Germany" \
        --email privacy@yourdomain.example \
        --register "Vereinsregister Amtsgericht …, VR 12345" \
        --vat DE000000000 --phone "+49 …" \
        --write /etc/wanderbibliothek/env
      sudo systemctl restart wanderbibliothek
      ```

      The command only replaces the `LEGAL_*` lines; the rest of the file
      (secrets, paths) is left intact. Without `--write` it prints the block for
      you to paste.
- [ ] Legal form decided (individual, association, GmbH…). Which Impressum
      fields are mandatory depends on it: an association needs the register and
      its number; a GmbH also needs its representative.
- [ ] Checked whether a data protection officer must be appointed (Art. 37
      GDPR). For a platform of this size there usually is none, but it is a
      documented decision, not an assumption.
- [ ] Email provider identified (name and country) and a **data-processing
      agreement** signed; if outside the EEA, with standard contractual clauses.
- [ ] Hosting provider identified and under a processing agreement.
- [ ] Competent supervisory authority for the controller's registered office
      (Baden-Württemberg: LfDI).
- [x] A real restore from backup has been rehearsed and the 14-day period
      declared in the policy confirmed. **Done on 9 Nov 2026** with the 18:03
      backup: decrypted to a temporary file, `PRAGMA integrity_check` → `ok`,
      `user_version = 48`, `books_fts` responds to `MATCH 'democ*'` and an
      account's TOTP secret decrypts with `APP_ENCRYPTION_KEY` (32 characters).
      Repeat it whenever the backup format or the key changes.
- [ ] Text reviewed by whoever assumes legal responsibility: what is there is an
      accurate technical draft, not legal advice.

## Rotating the encryption key

`APP_ENCRYPTION_KEY` protects each account's TOTP secret (the shipping fields
left in the database are historical: the flow was removed on 7 Nov). Values
store the id of the key they were encrypted with, so it can be changed without
losing anything:

```bash
# 1. The new key as active; the previous one only for reading.
export APP_ENCRYPTION_KEY=<new-32-bytes>
export APP_ENCRYPTION_OLD_KEYS=<previous>
npm run rotate:secrets -- --dry-run   # report, writes nothing

# 2. Real rotation: re-encrypts and checks that what was written can be read.
npm run rotate:secrets

# 3. When it says "0 of 0 values rotated", remove APP_ENCRYPTION_OLD_KEYS
#    and restart the service.
```

If the report lists values that cannot be decrypted, **do not remove the old
key**: it means another previous one is missing from
`APP_ENCRYPTION_OLD_KEYS`.

The same command encrypts any secrets left **in plain text** (development
databases restored on the server). In production an unencrypted value is no
longer read: `decryptSecret` fails on purpose, so the warning arrives before
anyone uses an account with a plain-text TOTP. Run `--dry-run` after a restore
and, if any appear, run the rotation without `--dry-run`.

## Replacing a site that already runs on the server

This section is for a host that **already serves another site** (for example a
WordPress with nginx or Apache) and wants to put Wanderbibliothek in its place
without losing anything. The rule is not to touch what works until the new site
responds over HTTPS on its own name.

### 1. Inventory before installing

```bash
ss -ltnp | grep -E ':(80|443|3000)\b'          # who occupies the ports
systemctl list-units --type=service --state=running --no-pager | head -30
ls -l /etc/nginx/sites-enabled/                 # nginx
ls -l /etc/apache2/sites-enabled/ 2>/dev/null   # Apache, if present
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null
df -h / ; free -h ; nproc                       # disk, RAM, cores
```

Write down the current domain, its `root`/`proxy_pass` and where its database
lives: that is what must be copied in step 2.

### 2. Back up the current site (before touching anything)

```bash
sudo tar -C /etc -czf /root/backup-etc-$(date +%F).tar.gz nginx apache2 2>/dev/null
# WordPress example: files, database and configuration
sudo tar -C /var/www -czf /root/backup-www-$(date +%F).tar.gz .
mysqldump --single-transaction -u root -p --all-databases | gzip > /root/backup-db-$(date +%F).sql.gz
# Docker: volumes and compose of the running project
docker run --rm -v <volume>:/v -v /root:/backup alpine tar -czf /backup/docker-<volume>.tar.gz -C /v .
```

Without this backup there is no way back: the old site is not "uninstalled", it
is switched off.

### 3. Install Wanderbibliothek in parallel

Follow sections 2 to 5 of this guide as they are. There is no conflict with the
current site: the application listens on `127.0.0.1:3000` and only its own
`server_name` publishes it.

To test without touching the domain, publish first on a subdomain
(`wander.your-domain.de`): create the A record in advance and request the
certificate for it alone.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/wanderbibliothek
sudo sed -i 's/biblioteca.example.com/wander.your-domain.de/g' /etc/nginx/sites-available/wanderbibliothek
sudo ln -s /etc/nginx/sites-available/wanderbibliothek /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wander.your-domain.de
```

In `/etc/wanderbibliothek/env`, `NEXT_PUBLIC_SITE_URL` must be **exactly** that
name with `https://`, or the `__Host-` cookie is not stored and login loops.

### 4. Switching the domain

With the new site already responding on the subdomain:

```bash
# 1) The new vhost starts serving the final domain (and www, if you use it).
sudo sed -i 's/wander.your-domain.de/your-domain.de www.your-domain.de/' \
  /etc/nginx/sites-available/wanderbibliothek
sudo sed -i 's|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://your-domain.de|' \
  /etc/wanderbibliothek/env

# 2) The old site's vhost stops listening on that name: disable it, do not delete it.
sudo unlink /etc/nginx/sites-enabled/<old-site>
sudo systemctl stop <old-service>        # php8.x-fpm, apache2, the container…

# 3) Certificate for the final domain and reload.
sudo certbot --nginx -d your-domain.de -d www.your-domain.de
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl restart wanderbibliothek
```

If the domain pointed to **another IP**, lower the A record's TTL a day in
advance and change it; the certificate cannot be requested until DNS resolves to
the new server (`dig +short your-domain.de`).

`NEXT_PUBLIC_SITE_URL` is read on every start (sitemap, `robots.txt`, canonical
and environment-checker warnings), so restarting the service is enough: there is
no need to rebuild the release.

### 5. Verification and rollback

```bash
curl -fsS https://your-domain.de/api/health
BASE_URL=https://your-domain.de npm --prefix /srv/wanderbibliothek/current run smoke
systemctl --no-pager status wanderbibliothek | head -12
systemctl list-timers 'wanderbibliothek-*' --no-pager
sudo journalctl -u wanderbibliothek -n 40 --no-pager | grep -F '[env]'
```

If something fails, rollback is three commands: re-enable the old site's symlink
(`ln -s`), start its service and reload nginx. The old site's files are still in
place: **do not delete anything from it until the new site has been running for
a week** with working backups.

### 6. Keeping the old domain alive (301)

If the previous site's domain is going to stop having content, it is better for
it to redirect to the new one rather than return an error: saved links and
search engines keep working.

```nginx
# /etc/nginx/sites-available/<old-domain>-redirect
server {
    listen 80;
    listen [::]:80;
    server_name <old-domain> www.<old-domain>;
    return 301 https://<new-domain>$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name <old-domain> www.<old-domain>;
    ssl_certificate     /etc/letsencrypt/live/<old-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<old-domain>/privkey.pem;
    return 301 https://<new-domain>$request_uri;
}
```

An easily forgotten detail: **the redirect only works if the old domain's
certificate is valid**. With expired TLS the browser shows a warning and never
reads the `301`. Check renewal beforehand (`sudo certbot renew --dry-run`,
`systemctl list-timers 'certbot*'`) and, if the domain is left without content,
keep that vhost as the only thing it serves.

### 7. What must not be missing before opening to the public

- `LEGAL_CONTROLLER`, `LEGAL_ADDRESS` and `LEGAL_CONTACT_EMAIL`: without them the
  Impressum and privacy policy are incomplete (mandatory in Germany). See
  section 13.
- `BREVO_API_KEY` and `MAIL_FROM` (or a `MAIL_WEBHOOK_URL`) with a real provider
  and an authenticated domain: without email, accounts cannot be confirmed and
  passwords cannot be reset.
- An administration account created and **with 2FA enabled**; then remove
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the environment.
- Tested backups: run `wanderbibliothek-backup.service` by hand once and restore
  into a test database. Keep `WANDERBIBLIOTHEK_BACKUP_KEY` off the server and
  move the backups elsewhere with `WANDERBIBLIOTHEK_BACKUP_HOOK`.
- Provider firewall: ports 80 and 443 open. If the panel blocks SMTP (some
  providers do by default), it does not matter: the application sends over
  HTTPS to Brevo's API, not over SMTP.
