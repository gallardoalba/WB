# Technical documentation

How Wanderbibliothek is built: architecture, routes, data, security and operations. It is meant for anyone who is going to read the code, deploy it or audit what it stores.

The running instance serves the same content in Spanish and German at `/techdoc`; `src/lib/technical.ts` is the source for both, so when you change one, change the other.

## Overview

A modular monolith on Next.js 16 (App Router with Cache Components), strict TypeScript and SQLite through `better-sqlite3`. One single process: SQLite has one writer and the live notification bus lives in memory.

No third-party services are required: the instance works without them. What the **server** does consult, and caches on disk, is Open Library and Google Books (covers), the DNB (MARC21 records), Photon and Nominatim (city suggestions and coordinates); with `MASTODON_TOKEN` or `INDEXNOW_KEY` it also talks to Mastodon and IndexNow. The browser only talks to this instance.

The code is MIT licensed.

## Architecture

```
src/
  app/                 pages and route handlers (App Router)
    api/               80 route files grouped by domain
    styles/            tokens, typography, structure, cards, dialogs, detail pages
    proxy.ts           CSP with nonce and security headers
  components/          server shell and interactive islands
  lib/
    db/                connection, base schema (v2), migrations (v3–v57), seed
    repo/              SQL queries per domain; `repo.ts` only re-exports
    validation.ts      Zod schemas with translated messages
    secret-box.ts      reversible encryption with a key ring (TOTP)
    e2e.ts             end-to-end encryption (ECDH + HKDF + AES-GCM)
    route.ts           route wrapper: session, body, quota, errors
tests/                 879 unit and integration tests (113 files)
e2e/                   56 browser tests with Playwright (+ WebCrypto smoke in Firefox and WebKit)
deploy/                systemd, nginx, environment template and guide
```

**Rendering.** The shell (`site-shell.tsx`, `site-rail.tsx`) is a Server Component: the sidebar, header, footer and mobile navigation arrive already rendered, and only the interactive islands hydrate (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`, `repository-link` is a plain link).

**Interface language.** The three dictionaries do not ship together: `i18n.ts` is only imported on the server and the layout hands the client provider only the active language's texts (Spanish is the source and arrives empty), addressed by a 32-bit `messageId` instead of by the source text, so the Spanish key does not travel. The switcher decides; without that cookie the browser language is used, with German as the last resort. Views that are not on screen (exchanges, reading circles, the copy preview) are loaded with `next/dynamic`, so the home page ships only what it renders.

**Data access.** `getDb()` hooks `prepare` to reuse compiled statements (FIFO cache of 400 per connection). Public aggregates are served through `use cache` with the `public-data` tag, invalidated by the routes that mutate.

**Clock.** Rendering never reads `Date.now()` or `new Date()`: Next treats it as an unstable value when prerendering. Notification, maintenance and limiter timestamps are written by SQLite with `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.

## Routes

Internal pages require a session; without one they redirect to `/?auth=1&next=…`. The home page, the catalogue (`/descubrir`), the public work pages (`/werk/[id]`), the reading lists, the legal pages, the flows with their own link and the technical documentation are public. `robots.txt` blocks the app catalogue, the copy pages and the profiles so that readers' names and cities do not end up in search engines; the public work pages publish the title, the figures and the cities, never who owns a copy.

| Route | Content |
| --- | --- |
| `/` | Public home page: hero, four figures and a single row of books **in the interface language** (`BOOK_LANGUAGE_BY_LOCALE`); the filter itself lives in `/descubrir`, and the home page falls back to the whole catalogue when there is nothing in that language. |
| `/descubrir` | Catalogue with search, categories, sorting and pagination in the URL. Visible without a session, but each copy shows only the book and the city, never who offers it; requesting a copy requires an account. |
| `/werk/[id]` | Public work page with JSON-LD `Book`/`Offer`; the URL search engines index. (`/buecher` redirects here to `/descubrir`.) |
| `/ofrecer` | Publish a copy; the ISBN fills in the bibliographic record. |
| `/buscar` | Global search: works, reading circles, readers and lists. |
| `/estanteria`, `/intercambios` | Private sections: own copies and requests with their next step. |
| `/comunidad` | Hub with tabs (conversations, activity, circles, readers, lists) and scope in `?scope=`. |
| `/lectores` | Directory with search, city and sorting by distance or activity. |
| `/clubes`, `/clubes/[clubId]` | Reading circles by city: requests, current read, vote, attendance and members-only forum. |
| `/listas`, `/listas/[listId]` | Reading lists: readable without a session (the signature only appears if the owner allows it), editable only by their owner. |
| `/libro/[id]` | Copy page with metadata, its journey (if it has changed hands) and JSON-LD `Book`/`Offer`. |
| `/obra/[bookId]` | Canonical work: conversation about the title, copies and recommendations. |
| `/u/[id]` | Public profile: bio, figures, reviews, shelf and following. |
| `/cuenta` | Settings: profile, notifications, password, encryption, second factor, journey visibility, welcome tour, export and deletion. |
| `/admin` | Moderation and appeals. Moderators review reports and hide content; administrators also suspend accounts. Requires an active second factor. |
| `/privacidad`, `/aviso-legal` | Privacy policy (art. 13 GDPR) and imprint (§ 5 DDG). |
| `/verificar`, `/restablecer` | Email confirmation and new password from the link. |
| `/techdoc` | Technical documentation page (Spanish and German). |
| `/projekt` | What the project is, why it exists, that it is non-commercial, and what it demonstrates. |
| `/normas` | Governance, moderation, sanctions and appeals policy (public). |
| `/apelar` | Appeal form opened from the sanction email; token-based, no session and not indexed. |
| `/api/health` | Service and database status. |
| `/api/version` | Commit, image digest and build time this instance claims to serve. Public, with no personal data. |
| `/api/transparency`, `/api/transparency/export` | Signed snapshots of the public catalogue: Merkle root, payload hash and Ed25519 signature; the export is the exact NDJSON that was signed. |
| `/sitemap.xml`, `/robots.txt` | Indexing: the sitemap publishes the home page, the work pages, the public reading lists and the info pages in all three languages (with `xhtml:link`); IndexNow pings Bing — and through it DuckDuckGo and Ecosia — whenever a book is listed. |

The API has 80 route files under `src/app/api`. `route()` (`src/lib/route.ts`) applies the session, the Zod body schema, the quota with origin guard and `handleApiError()` in one place, but today it covers 21 of the 109 exported methods (14 of the 80 route files); the rest keep that ceremony by hand pending migration. `tests/route.test.ts` checks on the files that no route leaves errors untranslated and that every mutation checks the origin — not that it already uses the wrapper.

- `/api/auth/*`: registration, sign-in, sign-out, session, verification and reset with single-use tokens.
- `/api/listings`, `/api/listings/[id]`, `…/favorite`: publish, edit, withdraw and save copies.
- `/api/requests`, `/api/requests/[id]` and its children (`events` over SSE, `messages`, `read`, `review`): the whole exchange lifecycle.
- `/api/books/*`: work search, comments, likes, per-work alerts and reading states.
- `/api/clubs/*`: circle, members, moderators, invitations, attendance, transfer, forum, votes and join requests.
- `/api/lists/*`, `/api/direct/*`, `/api/users/[userId]/follow`, `/api/blocks`: lists, encrypted direct messages, following and blocking.
- `/api/account/*`: profile, language, password, encryption keys, TOTP, export and deletion.
- `/api/account/appeals`, `/api/account/appeal-link`, `/api/admin/appeals/[id]`: sanction appeals with a single-use token; the link can be requested again with the account email, and the review is done by a different person — from the team or, with their name recorded, from another instance.
- `/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: reports, moderation, comments and notifications.
- `/api/cover/*`, `/api/isbn/[isbn]`: covers and bibliographic records (DNB and Open Library). Covers are streamed from disk as they are read (`src/lib/cover-response.ts`, chunked, no buffer per visitor), and a conditional request is answered `304` from the `stat` alone, without opening the file; the browser requests the reduced WebP variant through `/_next/image`, so a 220 px card never downloads the 1600 px JPEG. Each URL carries a version (`?v=…`, set on upload), which is what keeps a replaced cover out of every cache.
- `/api/cities?q=`: town suggestions for the city picker (OpenStreetMap through Photon), without a session because the city is chosen during registration.
- `/api/cron/maintenance`: scheduled tasks, with `MAINTENANCE_TOKEN`. It retries pending deliveries, purges old rows and creates the daily signed catalogue snapshot.

## Data

- Three levels, each with its own identity: `works` is the work (the book people search for), `books` the edition (one ISBN, publisher, year) and `listings` the copy someone has. `books.work_id` points at the work — that is what groups editions, so they share the page, the conversation and the list of copies — and `books.work_key` keeps the derived key (`ol:<id>` or `t:<hash>`) used to find the work in the first place. The work's `id` is stable; its `key` may improve when an external catalogue finally knows it, and then its editions move to that work without touching ids already in use (`src/lib/repo/works.ts`).
- Copy states: `available`, `reserved`, `given`, `paused`, `removed`.
- Request states: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.
- Search through FTS5 maintained by triggers: `listings_fts` for the catalogue and `books_fts` for works; `unaccent()` folds accents so "Lucía" is found by typing "lucia".
- `cities` holds the known cities with their coordinates (the German seed) and `city_distances` their distance matrix. The city is picked from a list of German municipalities supplied by OpenStreetMap (`searchCities()`, through Photon, which does allow suggestions while typing; if it does not answer, the local catalogue is offered instead) and checked on save with `resolveCity()`, which asks Nominatim, limited to Germany, and stores the name the map knows. Distance is secondary: a city outside that list shows no kilometres, and the radius filter is ignored rather than returning nothing.

- `users.is_moderator` separates moderation from administration; `suspended_until` and `suspension_reason` make a suspension explainable and time-bound.
- `appeals` keeps a snapshot of the sanction (reason, date and sanctioner), the appeal text and its review, including whether it was reviewed by the team or by an external reviewer and that person's name; a partial unique index allows only one open appeal per sanction.
- Provenance: every copy created by closing an exchange keeps `from_listing_id` (where it came from) and `from_request_id` (which exchange; unique, so a retry cannot duplicate the copy). `getCopyJourney()` walks that chain and returns an **aggregate** journey — ordered cities, month and year, and accumulated kilometres — with no names or identifiers; a stop whose owner hides their city (v48) carries no city and does not add kilometres. `users.show_journey` (v56, on by default) lets the current owner hide the whole journey: it then returns nothing for everyone else and stays visible to them, marked as hidden.

Migrations are versioned with `PRAGMA user_version` (currently v57). A new installation starts from `SCHEMA_V2` and its indexes and runs the 55 steps up to v57; existing ones climb the ladder in `src/lib/db/migrations.ts`, which keeps the data. Seven steps matter for reading today's code: v40 (one key slot per device and one encrypted envelope per key), v44 (when an exchange closes, the receiver gets a copy of their own), v52 (moderation separated from administration, suspensions with reason and time limit, and appeals), v53 (who reviewed an appeal and whether it was an external reviewer), v54 (signed snapshots of the public catalogue), v56 (the copy's journey: copies inherit their provenance and the copy page can tell it) and v57 (the work becomes an entity: `works` holds a stable id, its key and its own record, and `books.work_id` points at it, so grouping editions no longer means rewriting a derived string). The detail of every step lives in that file and in its git history.

The old hand-over and shipping columns (`handover_*`, `ship_*`) stay in the database so that nothing stored is deleted, but no code writes or reads them any more: the hand-over is agreed in the conversation and each side confirms in the platform once it has the book.

An exchange never leaves the book orphaned. When it closes, the copy that was handed over stays `given` (it is the record of what happened) and the receiver gets **a copy of their own**: same edition, same condition, their city, paused. `listings.from_listing_id` and `from_request_id` keep the trail, and the unique index on `from_request_id` makes sure one exchange can never produce two copies. From their shelf the receiver can activate it and the book travels again.

Messages within an exchange and direct messages are encrypted end to end (see **Security**): the database stores the envelope and the key fingerprint, and the API rejects plain text (422).

- A copy is only reserved if it is still `available`, inside the same transaction.
- On acceptance, competing requests move to `expired`; only the owner accepts or declines.
- Closing is two-sided: each side confirms separately, and only the second confirmation completes the exchange.
- Once a handover is confirmed the exchange can no longer be cancelled: the copy does not return to the catalogue behind the back of whoever already declared that they handed it over.
- The rating (1–5 and an optional comment) scores **the person** you swap with, not the book. One per side and exchange, only once it is completed, stored in `reviews` and shown on the public profile as an average, a count and the comments.
- Unanswered requests expire after 14 days and notify the waiting person.
- Blocks, suspended accounts and paused copies are filtered in SQL, not in the client.

## Security

- Passwords with asynchronous `scrypt` and a unique salt; sign-in always verifies a hash (against a decoy when the account does not exist), so response time does not reveal which addresses are registered.
- Exchange and direct messages are end-to-end encrypted (ECDH P-256 + HKDF-SHA256 + AES-GCM). Each account publishes **one key per device slot** (`web` and `android`); the sender stores one envelope per recipient key, so the browser and the app can read the same message. Only the first key of an account is published without confirmation (TOFU): as soon as any slot exists, both replacing a key and **adding a device** require the account password, and every change raises a security notification.
- The browser keeps **one identity per account** (`identity-v2:<userId>` in IndexedDB), never one per browser: two accounts that share a device must not share a key pair. The single identity of older versions is adopted once, and only for the account whose published `web` key is that same key; after that it is marked as taken, so the second account creates its own and has to confirm the password to publish it.
- What that encryption does **not** cover, plainly: every message is encrypted with the identity key of its slot, **with no forward secrecy** (no ratchet), and there is no recovery. Whoever gets both the database and one device's private key can read what that device received; losing the device or the browser data means losing that history. Changing it takes a versioned protocol change and both clients, not a patch.
- 256-bit session in an `httpOnly` cookie with `SameSite=Lax`; in production only the `__Host-` prefix is accepted, and the database only stores its SHA-256.
- Second factor (TOTP per RFC 6238, ±1 step window, anti-replay) required for moderation and administration in production; secrets are stored encrypted.
- Server-side secrets (TOTP, and the historical shipping columns) use AES-256-GCM with a key ring (`APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_OLD_KEYS`) and an AAD that binds each value to its row and column. In production a value stored in plain text is a configuration error, not something to read silently: `decryptSecret()` throws and `npm run rotate:secrets` encrypts the leftovers.
- Sanctions carry a reason and a duration (1–365 days); the email includes a single-use 30-day appeal link. The person who imposed the sanction cannot review the appeal.
- Atomic quotas in the database per IP and per account, with `429` and `Retry-After`.
- Every mutation goes through `guard()` (origin and quota), and `readJson()` requires `application/json` and truncates bodies over 64 KB.
- CSP with nonce and `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS in production (`src/proxy.ts`).
- Directory `0700` and database `0600`; `npm run db:backup` uses SQLite's `.backup()` API and encrypts with AES-256-GCM when `WANDERBIBLIOTHEK_BACKUP_KEY` is set.
- Registration with honeypot, minimum elapsed time and optional Cloudflare Turnstile; the answer is generic so addresses are not disclosed.
- Web Push subscriptions only accept endpoints from the standard browser push providers (`fcm.googleapis.com`, Mozilla, Apple and Windows Notification Service); an arbitrary HTTPS endpoint would turn the server into an SSRF proxy.
- Account tokens are single-use, hashed and expire (24 hours for verification, 1 hour for password reset, 30 days for appeals); changing the password ends every session.
- `GET /api/account/export` returns all data as JSON (profile, listings, exchanges, messages sent and received **with their envelopes**, direct messages with theirs, club posts and memberships, reviews, lists, follows, blocks, reports and notifications). Deleting the account anonymises the profile, withdraws its copies, deletes its device keys and direct conversations, removes its reviews and club forum messages, and clears its likes, votes and attendance. It keeps the exchange history without tearing other people's threads. `GET /api/notifications` also reports the number of unread items.

## Transparency

Wanderbibliothek separates two questions that are easy to mix: **which code is
running** and **what content is being served**. Each has its own, deliberately
limited, mechanism.

**Software.** `/api/version` is public and publishes the commit, the image digest
and the build time the instance was built with, plus the repository links. When a
deployment does not know them, the fields are `null` rather than invented. The
release workflow (`.github/workflows/release.yml`) pushes every `v*` tag to GHCR
by digest, attaches SLSA provenance and an SBOM, signs the image with cosign in
keyless mode and publishes `SHA256SUMS` with the release. `deploy/verify-release.sh`
checks the signature against this repository and workflow; `deploy/README.md`
documents the exact commands.

**Content.** The maintenance cron creates at most one snapshot per day of the
public catalogue: one canonical JSON line per work, its SHA-256, a Merkle root and
an Ed25519 signature (when `TRANSPARENCY_SIGNING_KEY` is set). `/api/transparency`
lists the snapshots and `/api/transparency/export` serves the exact NDJSON that was
signed. `npm run transparency:verify -- --url …` recomputes everything from
outside and checks the chain of roots; an external witness can pin a root and
detect a rewritten snapshot. The payload only contains data that is already
public — work, editions, copies per city — and never who owns a copy, so the
whole thing can be public without exposing anyone. Moderation stays aggregate,
for the same reason: per-case detail would identify people in a small community.

**What is not covered.** Without hardware attestation (TPM 2.0 with IMA and a
verifier such as Keylime, or a confidential VM with SEV-SNP/TDX), nothing
cryptographically proves that the process answering is the signed image. Open
code, signed images and signed snapshots make tampering **detectable**, not
impossible. The technical documentation and `deploy/README.md` state this
explicitly instead of implying a guarantee that does not exist.

## Permissions per resource

Signing in is not enough: every operation also checks that the resource belongs to the person asking for it, and does so **inside the query** (`owner_id = ?` or “either of the two parties”), not in an `if` in the component. That is why a foreign id answers `404` — “it does not exist” — rather than `403`: a 403 would confirm that something with that id exists.

| Operation | Signed out | Another account | Party or owner | Administration |
|---|---|---|---|---|
| Browse the catalogue and a work page | Yes | Yes | Yes | Yes |
| Publish a copy | No | Yes, with a confirmed email | Yes | Yes |
| Edit, pause or withdraw a copy | No | No | Only its owner | Withdraws, does not edit |
| See an exchange request | No | No | Only its two parties | No |
| Accept, cancel or confirm an exchange | No | No | Its two parties, according to role and transition | No |
| Read or write in a direct thread | No | No | Its participants, with mutual following and a published key | No |
| Rate the other person | No | No | Once, after the exchange is completed | No |
| Comment, write in a club or in a list | No | Yes, with a confirmed email | Yes | Yes |
| Moderate: reports, suspensions, removals | No | No | No | Yes, with 2FA in production |
| Export or delete the account | No | No | Only its owner | No |

Two roles share the team: a **moderator** (`is_moderator`) reviews reports and hides content; an **administrator** (`is_admin`) can also suspend accounts, appoint the team and resolve appeals. Sanctions require a reason and a duration, and an appeal can only be reviewed by someone other than the sanctioner. In production both roles require a second factor.

`tests/authorization.test.ts` walks this table with an owner, a third account and a one-sided follow; the club, privacy, exchange and governance tests cover the remaining roles.

## Environment variables

Without `APP_ENCRYPTION_KEY` no secret is ever stored in plain text: creating one fails with a configuration error. In production `src/instrumentation.ts` checks the configuration at start-up and writes the reason to the log.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Base for the canonical URLs, `sitemap.xml` and `robots.txt`. Mandatory in production, always `https://`. |
| `APP_ENCRYPTION_KEY` | unset | 32 bytes in hex or base64 for the TOTP secret. Mandatory; `APP_ENCRYPTION_KEY_ID` and `APP_ENCRYPTION_OLD_KEYS` are only needed when rotating it. |
| `WANDERBIBLIOTHEK_DB` | `.data/wanderbibliothek.db` | SQLite database path (`:memory:` in tests). |
| `BREVO_API_KEY` / `MAIL_FROM` | unset | Mail sent directly through the Brevo API. `MAIL_FROM` accepts `Name <address@domain>`. |
| `MAIL_WEBHOOK_URL` / `MAIL_WEBHOOK_TOKEN` | unset | Alternative to Brevo: receives `{to, subject, text}`; with both configured the webhook wins. |
| `MAINTENANCE_TOKEN` | unset | Token for `POST /api/cron/maintenance`; without it the route answers 404. |
| `TRUST_PROXY` | unset | `1` only behind your own proxy: allows `X-Forwarded-For`/`-Host` and enables per-IP quotas. |
| `SSE_MAX_STREAMS` | `500` | Global cap on open live streams (SSE). Each account is already limited to 3; this protects file descriptors and SQLite timers on a single instance. |
| `WANDERBIBLIOTHEK_BACKUP_KEY` / `WANDERBIBLIOTHEK_BACKUP_KEEP` | unset / `14` | Key of the encrypted backups and how many are kept when rotating. |
| `ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN` | unset | Receive 500s as JSON, already redacted. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | unset | Enable Cloudflare Turnstile on registration. |
| `REQUIRE_EMAIL_VERIFICATION` | unset | `1` requires a confirmed address to publish, request, comment and write. |
| `AUDIT_RETENTION_DAYS` | `730` | Days `admin_audit` is kept (0 = forever). |
| `LEGAL_*` | unset | Controller, address, contact and optional details for `/privacidad` and `/aviso-legal`. |
| `MASTODON_*` | off | Optional Mastodon integration; disabled without `MASTODON_TOKEN`. |
| `TRANSPARENCY_SIGNING_KEY` | unset | Ed25519 private key (PKCS#8 in base64, or PEM) used to sign the daily catalogue snapshots. Without it, snapshots are published unsigned and marked as such. |
| `APP_COMMIT_SHA` / `APP_BUILD_TIME` / `APP_IMAGE` | unset | Build identity published at `/api/version`. Filled by the release workflow (Docker build args) or by `deploy/deploy.sh` (`.build-info.json`). |

The canonical template is `deploy/env.example`: every variable — the ones in this table and the detail ones (bot, backups, demo data, Google Books quota, first administrator) — is there, commented, with its default value.

## Tests and continuous integration

`npm test` runs 879 unit and integration tests in 113 files (Node test runner on SQLite in memory), and `npm run test:e2e` adds 56 browser tests with Chromium, starting its own server on port 3100; `npm run test:e2e:smoke` runs the WebCrypto/IndexedDB smoke in Firefox and WebKit.

`npm run test:coverage` enforces minimum thresholds of 92 % lines, 80 % branches and 88 % functions. Continuous integration (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test`, `test:coverage`, `build`, `npm audit --omit=dev`, the browser tests and a build of the Docker image, which is then scanned with Trivy: the job only fails on **critical vulnerabilities that have a fix**, because an advisory with no available patch cannot be solved at that moment but is still recorded.

Every run publishes a **CycloneDX SBOM** (`npm sbom`) with the production dependencies, so an advisory can be traced back to a deployment. Tags (`v*`) go through `.github/workflows/release.yml`: GHCR image pinned by digest, SLSA provenance, image SBOM, cosign keyless signature and a release with `SHA256SUMS` and the image reference. `tests/no-secrets.test.ts` scans the working tree for credentials (Brevo keys, GitHub tokens, private keys, 32-byte keys assigned to a key-like variable), locally and in CI, without any service; it does not replace reviewing the git history. Static analysis (CodeQL, `security-extended`) lives in `.github/workflows/codeql.yml` and is also scheduled weekly.

CI also audits **development** dependencies with `npm run audit:dev` (`scripts/audit-dev.ts`): ESLint, TypeScript and Playwright build what gets published. It applies the same rule as the image scan — a **high or critical advisory with a non-breaking fix fails the job**, because that can be resolved in the change itself; one with no published patch, or one whose only fix is a major bump, is reported in the job summary and does not block. A bare `npm audit` fails in both cases, which leaves the branch red for something the repository cannot fix. And the `minimatch@11` `override` in `package.json` is there because `@typescript-eslint/typescript-estree` resolved a version carrying a ReDoS advisory; it only affects the ESLint chain, not the runtime, and can be dropped once that dependency brings it on its own.

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run build
npx playwright install chromium && npm run test:e2e
```

## Operations

- `npm run db:backup` uses SQLite's `.backup()` API, checks integrity, rotates backups, encrypts when a key is present and runs `WANDERBIBLIOTHEK_BACKUP_HOOK`. Never copy the file while WAL is active.
- `npm run db:verify` is the restore rehearsal: it decrypts the newest backup (or the one given as an argument), opens it read-only like the app would, runs `integrity_check` and `foreign_key_check`, checks the schema version and counts the main tables. It exits non-zero when the backup cannot be restored. The `wanderbibliothek-verify.timer` runs it every Sunday against the latest backup, so a copy that no longer restores shows up in the journal instead of on the day it is needed.
- `POST /api/cron/maintenance` with `Authorization: Bearer $MAINTENANCE_TOKEN` expires requests, purges sessions, notifications and quotas, deletes old activity (`events` and `product_events`, 180 days), resolved reports (1 year), resolved appeals (2 years) and the moderation audit according to `AUDIT_RETENTION_DAYS`, and sends the reading circle reminders.
- `npm run user:verify -- <address>` and `npm run admin:2fa-off -- <address>` are the emergency exits when mail or the second factor locks someone out.
- `npm run moderator:create -- <address> 'password'` creates a moderation-only account (no suspensions); `npm run admin:create` keeps creating administrators.
- `npm run informe:moderacion -- [--days 30] [--json]` prints aggregate moderation figures — reports, measures, suspensions and appeals — without names or individual cases.
- `npm run transparency:snapshot` creates a signed catalogue snapshot immediately (the cron already does one a day); `npm run transparency:verify -- --url https://…` checks it from outside, recomputing the hash, the Merkle root and the Ed25519 signature and checking the chain of roots. `--key-fingerprint` pins the Ed25519 public key and `--pin` the Merkle root, so an external witness fails if a snapshot is rewritten or the instance starts signing with another key.
- Routes wrapped by `route()` leave a `[req] {…}` line and the `x-response-time` header. nginx logs every application request with the same `x-request-id` (also returned to the client), so a request can be correlated even when its handler is still written by hand.
- `GET /api/metrics` (administrator only) returns uptime, memory, p50/p95/p99 latency of `route()`-wrapped handlers, error and request counters, open live streams and database/WAL size. It is JSON, not Prometheus, and contains no request data.
- A query over 50 ms leaves a `[db] consulta lenta` notice with its duration and the truncated SQL: `better-sqlite3` is synchronous, so while a query runs the whole process is stopped. The cron also returns under `db` the size of the file, the WAL and the free pages **after** the checkpoint.
- A single instance: SQLite has one writer and the notification bus lives in memory. Scaling requires PostgreSQL and Redis/pubsub.
- Updating restarts that single process: the deploy scripts take a backup, swap the release, restart and check `/api/health`, rolling back on failure. An update therefore means a few seconds of downtime, and there is no high availability.
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
- `deploy/wanderbibliothek-maintenance.timer` (every 15 minutes) and `deploy/wanderbibliothek-backup.timer` (every 6 hours).
- Alternatively `Dockerfile` and `docker-compose.yml`, multi-stage and with production dependencies only; the image build is checked in CI. `better-sqlite3` compiles with node-gyp, so the final stage reuses the `node_modules` already built in the dependencies stage and prunes devDependencies instead of installing again.
- When a required setting is missing from the configuration, the process starts but answers 500 to everything with the reason in the log, rather than looking healthy.
- `tsx` is a production dependency: `admin:create`, `db:backup`, `user:verify` and `smoke` need it, also inside the image with `npm ci --omit=dev`.

## Interface and accessibility

- A single shell (`SiteShell`) for the internal pages; the home page is the exception and gives the catalogue the full width.
- Colours come from tokens (`src/app/styles/tokens.css`): outside that file there are no literals, so light and dark themes share the same markup.
- Four breakpoints (480, 768, 1120 and 1400/1800 px), spacing scale from 4 to 48 px and controls at 40 px, 44 px on mobile.
- Dialogs with trapped focus, closing on `Escape` and focus restoration; a "Skip to content" link, `aria-current` in navigation, filters with `aria-pressed` and errors with `role="alert"`.
- Minimum AA contrast, type from 12 px, 44 px touch targets on phones and `prefers-reduced-motion` respected.
- First steps: the home page shows a dismissible checklist for signed-in accounts (complete the profile, publish a copy, request one, follow a reader) fed by the server, and a four-step welcome tour. The tour is offered on the home page to accounts that have neither published nor requested anything, and can be replayed from `/cuenta` with `/?tour=1`. Both marks live in `localStorage` (`wb-tour-seen`, `wb-checklist-off`), not in the account: they are interface hints, not profile data.
- The interface is trilingual and every language has its own URL: German is the default and stays unprefixed (`/werk/x`), while Spanish and English are published under `/es/…` and `/en/…`, each with its own `hreflang` and canonical so search engines index them separately (the proxy rewrites the prefix away and passes the language in a header). Inside a prefixed URL the prefix wins; otherwise the switcher does, setting the `wanderbibliothek-locale` cookie and, with a session, the account preference used for notifications and mail. Without a preference the browser language (`Accept-Language`) decides; German is the last resort. Mail links carry `?lang=…` so the page they open speaks the language of the message.

## Further reading

- [`README.md`](README.md) — what the project is, its principles and how to run it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — environment, quality commands, commit conventions and migration rules.
- [`GOVERNANCE.md`](GOVERNANCE.md) — roles, moderation, sanctions and appeals.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability and self-hosting notes.
- [`deploy/README.md`](deploy/README.md) — step-by-step deployment with systemd, nginx and TLS.
- [`LICENSE`](LICENSE) — MIT.
- [`NOTICE`](NOTICE) — credits for the cover photograph and for the third-party components.
