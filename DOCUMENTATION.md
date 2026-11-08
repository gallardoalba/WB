# Technical documentation

How Wanderbibliothek is built: architecture, routes, data, security and operations. It is meant for anyone who is going to read the code, deploy it or audit what it stores.

The running instance serves the same content in Spanish and German at `/documentacion`; `src/lib/technical.ts` is the source for both, so when you change one, change the other.

## Overview

A modular monolith on Next.js 16 (App Router with Cache Components), strict TypeScript and SQLite through `better-sqlite3`. One single process: SQLite has one writer and the live notification bus lives in memory.

No third-party services are required. Covers and bibliographic records are fetched by the server and cached on disk, so the browser never talks to anyone else.

The code is MIT licensed.

## Architecture

```
src/
  app/                 pages and route handlers (App Router)
    api/               72 handlers grouped by domain
    styles/            tokens, typography, structure, cards, dialogs, detail pages
    proxy.ts           CSP with nonce and security headers
  components/          server shell and interactive islands
  lib/
    db/                connection, base schema (v2), migrations (v3–v45), seed
    repo/              SQL queries per domain; `repo.ts` only re-exports
    validation.ts      Zod schemas with translated messages
    secret-box.ts      reversible encryption with a key ring (TOTP)
    e2e.ts             end-to-end encryption (ECDH + HKDF + AES-GCM)
    route.ts           route wrapper: session, body, quota, errors
tests/                 331 unit and integration tests (45 files)
e2e/                   36 browser tests with Playwright
deploy/                systemd, nginx, environment template and guide
```

**Rendering.** The shell (`site-shell.tsx`, `site-rail.tsx`) is a Server Component: the sidebar, header, footer and mobile navigation arrive already rendered, and only the interactive islands hydrate (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`, `repository-link` is a plain link).

**Interface language.** The German dictionary never ships wholesale: `i18n.ts` is only imported on the server and the layout hands the client provider the texts of the active language, addressed by a 32-bit `messageId` instead of by the source text, so the Spanish key does not travel. The switcher decides; without that cookie the browser language is used, with German as the last resort. Views that are not on screen (exchanges, reading circles, the copy preview) are loaded with `next/dynamic`, so the home page ships only what it renders.

**Data access.** `getDb()` hooks `prepare` to reuse compiled statements (FIFO cache of 400 per connection). Public aggregates are served through `use cache` with the `public-data` tag, invalidated by the routes that mutate.

**Clock.** Rendering never reads `Date.now()` or `new Date()`: Next treats it as an unstable value when prerendering. Notification, maintenance and limiter timestamps are written by SQLite with `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.

## Routes

Internal pages require a session; without one they redirect to `/?auth=1&next=…`. The home page, the catalogue (`/descubrir`), the public work pages (`/werk/[id]`), the reading lists, the legal pages, the flows with their own link and the technical documentation are public. `robots.txt` blocks the app catalogue, the copy pages and the profiles so that readers' names and cities do not end up in search engines; the public work pages publish the title, the figures and the cities, never who owns a copy.

| Route | Content |
| --- | --- |
| `/` | Public home page: hero, four figures and a single row of books. |
| `/descubrir` | Full catalogue with search, categories, sorting and pagination in the URL. Visible without a session; requesting a copy does require one. |
| `/werk/[id]` | Public work page with JSON-LD `Book`/`Offer`; the URL search engines index. (`/buecher` redirects here to `/descubrir`.) |
| `/ofrecer` | Publish a copy; the ISBN fills in the bibliographic record. |
| `/buscar` | Global search: works, reading circles, readers and lists. |
| `/estanteria`, `/intercambios` | Private sections: own copies and requests with their next step. |
| `/comunidad` | Hub with tabs (conversations, activity, circles, readers, lists) and scope in `?scope=`. |
| `/lectores` | Directory with search, city and sorting by distance or activity. |
| `/clubes`, `/clubes/[clubId]` | Reading circles by city: requests, current read, vote, attendance and members-only forum. |
| `/listas`, `/listas/[listId]` | Reading lists: readable without a session (the signature only appears if the owner allows it), editable only by their owner. |
| `/libro/[id]` | Copy page with metadata and JSON-LD `Book`/`Offer`. |
| `/obra/[bookId]` | Canonical work: conversation about the title, copies and recommendations. |
| `/u/[id]` | Public profile: bio, figures, reviews, shelf and following. |
| `/cuenta` | Settings: profile, notifications, password, encryption, second factor, export and deletion. |
| `/admin` | Community moderation; requires an active second factor. |
| `/privacidad`, `/aviso-legal` | Privacy policy (art. 13 GDPR) and imprint (§ 5 DDG). |
| `/verificar`, `/restablecer` | Email confirmation and new password from the link. |
| `/documentacion` | Technical documentation page (Spanish and German). |
| `/projekt` | What the project is, why it exists, that it is non-commercial, and what it demonstrates. |
| `/api/health` | Service and database status. |
| `/sitemap.xml`, `/robots.txt` | Indexing: the sitemap publishes the home page, the work pages and the info pages in all three languages (with `xhtml:link`); IndexNow pings Bing — and through it DuckDuckGo and Ecosia — whenever a book is listed. |

The API has 72 handlers under `src/app/api`. Almost all are declared with `route()` (`src/lib/route.ts`), which applies session, Zod body schema, quota with origin guard and `handleApiError()` in one place; `tests/route.test.ts` checks on the files that no route leaves errors untranslated.

- `/api/auth/*`: registration, sign-in, sign-out, session, verification and reset with single-use tokens.
- `/api/listings`, `/api/listings/[id]`, `…/favorite`: publish, edit, withdraw and save copies.
- `/api/requests`, `/api/requests/[id]` and its children (`events` over SSE, `messages`, `read`, `review`): the whole exchange lifecycle.
- `/api/books/*`: work search, comments, likes, per-work alerts and reading states.
- `/api/clubs/*`: circle, members, moderators, invitations, attendance, transfer, forum, votes and join requests.
- `/api/lists/*`, `/api/direct/*`, `/api/users/[userId]/follow`, `/api/blocks`: lists, encrypted direct messages, following and blocking.
- `/api/account/*`: profile, language, password, encryption keys, TOTP, export and deletion.
- `/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: reports, moderation, comments and notifications.
- `/api/cover/*`, `/api/isbn/[isbn]`: cached covers and bibliographic records (DNB and Open Library).
- `/api/cron/maintenance`: scheduled tasks, with `MAINTENANCE_TOKEN`. It also retries the Mastodon outbox, purges old rows and, if `MASTODON_LIKES=on`, gives a few well-spaced favourites to book posts found through book hashtags.

## Data

- `books` is the edition (unique ISBN) and `listings` the specific copy; `books.work_key` groups editions of the same work, so they share the conversation and the list of copies.
- Copy states: `available`, `reserved`, `given`, `paused`, `removed`.
- Request states: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.
- Search through FTS5 (`listings_fts`) maintained by triggers; `unaccent()` folds accents so "Lucía" is found by typing "lucia".
- `cities` holds the known cities with their coordinates (the German seed) and `city_distances` their distance matrix. Cities typed in a form are checked against OpenStreetMap: `resolveCity()` asks Nominatim, limited to European countries, and stores the name the map knows. Distance is secondary: a city outside that list shows no kilometres, and the radius filter is ignored rather than returning nothing.

Migrations are versioned with `PRAGMA user_version` (currently v45) and keep the data of an existing installation. v40 gives each device its own key slot (`web` and `android`) and stores one encrypted envelope per recipient key, so the browser and the app read the same messages; v38 opens the catalogue to every city again, adds `requests.ship_kind` and `ship_street`, encrypts the shipping data that v37 stored in plain text and removes the Deutsche Post branches; v36 added encrypted direct messages and v37 shipping by mail. v41–v43 add the social outbox with the image of the post and the daily cap per account; v44 closes the loop of the exchange: the copy handed over stays `given` and the receiver gets one of their own; v45 adds `social_likes`, the memory of what the bot has already favourited.

The hand-over and shipping columns (`handover_code`, `handover_method`, `ship_kind`, `ship_number`, `ship_station`, `ship_street`, `ship_postal_code`, `ship_city`) stay in the database so that nothing stored is deleted, but no code writes or reads them any more: the hand-over is agreed in the exchange conversation and each side confirms in the platform once it has the book, with no code and no addresses.

An exchange never leaves the book orphaned. When it closes, the copy that was handed over stays `given` (it is the record of what happened) and the receiver gets **a copy of their own**: same edition, same condition, their city, paused. `listings.from_listing_id` and `from_request_id` keep the trail, and the unique index on `from_request_id` makes sure one exchange can never produce two copies. From their shelf the receiver can activate it and the book travels again.

Messages within an exchange and direct messages are encrypted in the browser (ECDH P-256 + HKDF-SHA256 + AES-GCM-256 with AAD). The server stores the envelope and the key fingerprint, and rejects plain text as soon as either side has published a key (409).

- A copy is only reserved if it is still `available`, inside the same transaction.
- On acceptance, competing requests move to `expired`; only the owner accepts or declines.
- Closing is two-sided: each side confirms separately, and only the second confirmation completes the exchange.
- The book changes hands: the copy handed over stays `given` and the receiver gets a paused copy on their shelf, which they can activate whenever they want.
- Once a handover is confirmed the exchange can no longer be cancelled: the copy does not return to the catalogue behind the back of whoever already declared that they handed it over.
- The rating (1–5 and an optional comment) scores **the person** you swap with, not the book. One per side and exchange, only once it is completed, stored in `reviews` and shown on the public profile as an average, a count and the comments.
- Unanswered requests expire after 14 days and notify the waiting person.
- Blocks, suspended accounts and paused copies are filtered in SQL, not in the client.

## Security

- Passwords with asynchronous `scrypt` and a unique salt; sign-in always verifies a hash (against a decoy when the account does not exist), so response time does not reveal which addresses are registered.
- Exchange and direct messages are end-to-end encrypted (ECDH P-256 + HKDF-SHA256 + AES-GCM). Each account publishes **one key per device slot** (`web` and `android`); the sender stores one envelope per recipient key, so the browser and the app can read the same message. Only the first key of an account is published without confirmation (TOFU): as soon as any slot exists, both replacing a key and **adding a device** require the account password, and every change raises a security notification.
- 256-bit session in an `httpOnly` cookie with `SameSite=Lax`; in production only the `__Host-` prefix is accepted, and the database only stores its SHA-256.
- Second factor (TOTP per RFC 6238, ±1 step window, anti-replay) required for moderation in production; secrets are stored encrypted.
- Atomic quotas in the database per IP and per account, with `429` and `Retry-After`.
- Every mutation goes through `guard()` (origin and quota), and `readJson()` requires `application/json` and truncates bodies over 64 KB.
- CSP with nonce and `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS in production (`src/proxy.ts`).
- Directory `0700` and database `0600`; `npm run db:backup` uses SQLite's `.backup()` API and encrypts with AES-256-GCM when `WANDERBIBLIOTHEK_BACKUP_KEY` is set.
- Registration with honeypot, minimum elapsed time and optional Cloudflare Turnstile; the answer is generic so addresses are not disclosed.
- Account tokens are single-use, hashed and expire; changing the password ends every session.
- `GET /api/account/export` returns all data as JSON (profile, listings, exchanges, messages sent and received, direct messages with their envelopes, club posts and memberships, reviews, lists, follows, blocks, reports and notifications), and deleting the account removes its own content without tearing other people's threads. `GET /api/notifications` also reports the number of unread items.

## Environment variables

Without `APP_ENCRYPTION_KEY` no secret is ever stored in plain text: creating one fails with a configuration error. In production `src/instrumentation.ts` checks the configuration at start-up and writes the reason to the log.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WANDERBIBLIOTHEK_DB` | `.data/wanderbibliothek.db` | SQLite database path (`:memory:` in tests). |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Base for `sitemap.xml`, `robots.txt` and canonical URLs. Required in production. |
| `APP_ENCRYPTION_KEY` | unset | 32 bytes in hex or base64 for TOTP and shipping data. Required. |
| `APP_ENCRYPTION_KEY_ID` | derived | Readable name of the active key; when missing, a prefix of its SHA-256 is used. |
| `APP_ENCRYPTION_OLD_KEYS` | empty | Previous keys, read-only, while a rotation is in progress. |
| `WANDERBIBLIOTHEK_ALLOW_PLAINTEXT` | empty | Development only: stores secrets in plain text when no key is present. |
| `WANDERBIBLIOTHEK_BACKUP_KEY` | unset | AES-256-GCM key for backups. |
| `WANDERBIBLIOTHEK_BACKUP_KEEP` | `14` | Number of backups kept when rotating. |
| `WANDERBIBLIOTHEK_BACKUP_HOOK` | unset | Command receiving `BACKUP_FILE` for an external copy. |
| `WANDERBIBLIOTHEK_COVER_CACHE` | next to the database | Folder for downloaded and uploaded covers. |
| `WANDERBIBLIOTHEK_SKIP_ENV_CHECK` | unset | Skips the environment check at start-up. |
| `MAIL_WEBHOOK_URL` | unset | Receives `{to, subject, text}`; sending goes through `mail_outbox` with retries. |
| `MAIL_WEBHOOK_TOKEN` | unset | `Bearer` authentication for the mail webhook. |
| `MAINTENANCE_TOKEN` | unset | Token for `POST /api/cron/maintenance`; without it the route answers 404. |
| `AUDIT_RETENTION_DAYS` | `0` | Days `admin_audit` is kept (0 = forever). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | unset | Create the first admin account when none exists. |
| `REQUIRE_EMAIL_VERIFICATION` | unset | `1` requires a confirmed address to publish, request, comment and write. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | unset | Enable Cloudflare Turnstile on registration. |
| `ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN` | unset | Receive 500s as JSON (Sentry, Logtail or your own webhook). |
| `TRUST_PROXY` | unset | `1` only behind your own proxy: allows `X-Forwarded-For`/`-Host` and enables per-IP quotas. |
| `LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL` | unset | Fill in `/privacidad` and `/aviso-legal`. |
| `LEGAL_VAT_ID` / `LEGAL_PHONE` / `LEGAL_REGISTER` | unset | Optional details for the imprint. |
| `SEED_DEMO` | `1` outside production | Seeds demo data; in production only with an explicit `1`. |
| `GOOGLE_BOOKS_API_KEY` | unset | Raises the Google Books quota for covers. |
| `MASTODON_TOKEN` | unset | Enables the bot that announces every new work on Mastodon; without it nothing is queued or posted. |

## Tests and continuous integration

`npm test` runs 331 unit and integration tests in 45 files (Node test runner on SQLite in memory), and `npm run test:e2e` adds 36 browser tests with Playwright, which starts its own server on port 3100.

`npm run test:coverage` enforces minimum thresholds of 92 % lines, 80 % branches and 88 % functions. Continuous integration (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test`, `build`, `npm audit --omit=dev`, the browser tests and a build of the Docker image without publishing it.

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run build
npx playwright install chromium && npm run test:e2e
```

## Operations

- `npm run db:backup` uses SQLite's `.backup()` API, checks integrity, rotates backups, encrypts when a key is present and runs `WANDERBIBLIOTHEK_BACKUP_HOOK`. Never copy the file while WAL is active.
- `POST /api/cron/maintenance` with `Authorization: Bearer $MAINTENANCE_TOKEN` expires requests, purges sessions, notifications and quotas, and sends the reading circle reminders.
- `npm run user:verify -- <address>` and `npm run admin:2fa-off -- <address>` are the emergency exits when mail or the second factor locks someone out.
- Every response carries `x-request-id` and `x-response-time`, and every request leaves a `[req] {…}` line in the log. The `reference` of a 500 is the first 8 characters of that id.
- A single instance: SQLite has one writer and the notification bus lives in memory. Scaling requires PostgreSQL and Redis/pubsub.
- Measured ceiling with `npm run bench:sqlite`: about 99 000 single writes/s, 250 000/s in a batch, 350 000 reads/s by primary key and 2 000/s for a filter without an index over 5 000 rows. The real limit is the duration of each transaction, not the number of visits.

Secrets are stored as `enc:v2:<key>:<flags>:<iv>.<tag>.<data>`. To change the key without losing anything:

```bash
# 1. Dry run: the new key is active, the old one stays for reading
APP_ENCRYPTION_KEY=<new> APP_ENCRYPTION_OLD_KEYS=<old> \
  npm run rotate:secrets -- --dry-run

# 2. When the report adds up, without --dry-run
APP_ENCRYPTION_KEY=<new> APP_ENCRYPTION_OLD_KEYS=<old> \
  npm run rotate:secrets

# 3. Remove APP_ENCRYPTION_OLD_KEYS
```

## Deployment

- The full guide (system user, systemd, nginx, TLS, timers and restore) is in [`deploy/README.md`](deploy/README.md).
- `deploy/wanderbibliothek.service`, `deploy/nginx.conf` and `deploy/env.example`: the application listens on `127.0.0.1:3000`, nginx terminates TLS, and `/api/requests/` runs without buffering so the SSE channel is not cut.
- `deploy/wanderbibliothek-maintenance.timer` (every 15 minutes) and `deploy/wanderbibliothek-backup.timer` (daily).
- Alternatively `Dockerfile` and `docker-compose.yml`, multi-stage and with production dependencies only; the image build is checked in CI. `better-sqlite3` compiles with node-gyp, so the final stage reuses the `node_modules` already built in the dependencies stage and prunes devDependencies instead of installing again.
- When something important is missing from the configuration, the process starts but answers 500 to everything with the reason in the log, rather than looking healthy.
- `tsx` is a production dependency: `admin:create`, `db:backup`, `user:verify` and `smoke` need it, also inside the image with `npm ci --omit=dev`.

## Interface and accessibility

- A single shell (`SiteShell`) for the internal pages; the home page is the exception and gives the catalogue the full width.
- Colours come from tokens (`src/app/styles/tokens.css`): outside that file there are no literals, so light and dark themes share the same markup.
- Four breakpoints (480, 768, 1120 and 1400/1800 px), spacing scale from 4 to 48 px and controls at 40 px, 44 px on mobile.
- Dialogs with trapped focus, closing on `Escape` and focus restoration; a "Skip to content" link, `aria-current` in navigation, filters with `aria-pressed` and errors with `role="alert"`.
- Minimum AA contrast, type from 12 px, 44 px touch targets on phones and `prefers-reduced-motion` respected.
- The interface is trilingual and every language has its own URL: German is the default and stays unprefixed (`/werk/x`), while Spanish and English are published under `/es/…` and `/en/…`, each with its own `hreflang` and canonical so search engines index them separately (the proxy rewrites the prefix away and passes the language in a header). Inside a prefixed URL the prefix wins; otherwise the switcher does, setting the `wanderbibliothek-locale` cookie and, with a session, the account preference used for notifications and mail. Without a preference the browser language (`Accept-Language`) decides; German is the last resort. Mail links carry `?lang=…` so the page they open speaks the language of the message.

## Further reading

- [`README.md`](README.md) — what the project is, its principles and how to run it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — environment, quality commands, commit conventions and migration rules.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability and self-hosting notes.
- [`deploy/README.md`](deploy/README.md) — step-by-step deployment with systemd, nginx and TLS.
- [`LICENSE`](LICENSE) — MIT.
- [`NOTICE`](NOTICE) — credits for the cover photograph and the typeface used on covers.
