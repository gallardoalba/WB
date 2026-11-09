/**
 * Documentación técnica en inglés (`/documentacion`).
 *
 * Es la traducción del documento `ES` de `technical.ts`: mismos identificadores
 * de sección, mismos tipos de bloque y mismo orden, de modo que las tres
 * versiones se mantengan en paralelo. Solo se traduce la prosa; rutas, ficheros,
 * variables, identificadores y fragmentos de código son idénticos en las tres.
 *
 * La fecha `updated` repite el literal de `ES` (`UPDATED` no se exporta).
 */

import { REPOSITORY } from "./brand";
import type { TechnicalDocument } from "./technical";

export const EN: TechnicalDocument = {
  title: "Technical documentation",
  updated: "2026-11-06",
  intro: [
    "How Wanderbibliothek is built: architecture, routes, data, security and operations. It is meant for anyone who is going to read the code, deploy it or audit what it stores.",
    "Everything described here is in the repository. If the code changes, this page changes with it.",
  ],
  sections: [
    {
      id: "resumen",
      heading: "Overview",
      blocks: [
        {
          kind: "p",
          text: "A modular monolith in Next.js 16 (App Router with Cache Components), TypeScript in strict mode and SQLite with `better-sqlite3`. A single process: SQLite allows one writer and the live notification bus lives in memory.",
        },
        {
          kind: "p",
          text: "There are no mandatory external services. Covers and bibliographic records are requested by the server and cached on disk, so the browser never talks to third parties.",
        },
        {
          kind: "p",
          text: "The code is released under the MIT licence. This page describes the code run by the instance that serves it.",
        },
      ],
    },
    {
      id: "arquitectura",
      heading: "Architecture",
      blocks: [
        {
          kind: "code",
          lines: [
            "src/",
            "  app/                 pages and route handlers (App Router)",
            "    api/               72 handlers grouped by domain",
            "    styles/            tokens, typography, structure, cards, dialogs, detail pages",
            "    proxy.ts           CSP with nonce and security headers",
            "  components/          server shell and client islands",
            "  lib/",
            "    db/                connection, base schema (v2), migrations (v3–v48), seed",
            "    repo/              SQL queries per domain; `repo.ts` only re-exports",
            "    validation.ts      Zod schemas with translated messages",
            "    secret-box.ts      reversible encryption with a key ring (TOTP)",
            "    e2e.ts             end-to-end encryption (ECDH + HKDF + AES-GCM)",
            "    route.ts           route wrapper: session, body, quota, errors",
            "tests/                 714 unit and integration tests (89 files)",
            "e2e/                   browser tests with Playwright (6 spec files)",
            "deploy/                systemd, nginx, environment template and guide",
          ],
        },
        {
          kind: "p",
          text: "The shell (`site-shell.tsx`, `site-rail.tsx`) is a Server Component: the sidebar, the header, the footer and the mobile navigation arrive already rendered and only the interactive islands are hydrated (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`).",
        },
        {
          kind: "p",
          text: "The German dictionary never travels to the browser: `i18n.ts` is only imported on the server and the layout hands the client provider the texts of the active language, not the whole dictionary. On top of that they are indexed by a 32-bit identifier (`messageId`) instead of by the source text: the key takes ten digits and the Spanish text does not travel, which leaves the German HTML at 182 KB instead of 236.",
        },
        {
          kind: "p",
          text: "`getDb()` intercepts `prepare` in order to reuse compiled statements (FIFO cache of 400 per connection). Public aggregates are served with `use cache` and the `public-data` tag, which the routes that mutate invalidate.",
        },
        {
          kind: "p",
          text: "Rendering does not read `Date.now()` or `new Date()`: Next treats it as an unstable value when prerendering. Notification, maintenance and limiter timestamps are set by SQLite with `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.",
        },
      ],
    },
    {
      id: "rutas",
      heading: "Routes",
      blocks: [
        {
          kind: "p",
          text: "Internal pages require a session; without one they redirect to `/?auth=1&next=…`. The home page, the legal pages, the flows with their own link and this documentation are public. `robots.txt` blocks the catalogue and the profiles so that the name and the city of every reader are not published in search engines.",
        },
        {
          kind: "table",
          head: ["Route", "Content"],
          rows: [
            ["`/`", "Public home page: hero, four figures and a row of books."],
            ["`/descubrir`", "Catalogue with search, categories, sorting and pagination in the URL. Visible without a session, but each copy shows only the book and the city, never who offers it; requesting a book requires an account."],
            ["`/werk/[id]`", "Public page for the work with JSON-LD `Book`/`Offer`: the URL that gets indexed."],
            ["`/ofrecer`", "Publish a copy: the ISBN fills in the bibliographic record."],
            ["`/buscar`", "Global search: works, clubs, readers and lists."],
            ["`/estanteria`, `/intercambios`", "Private sections: own copies and requests with their next step."],
            ["`/comunidad`", "Hub with tabs (conversations, activity, clubs, readers, lists) and scope in `?scope=`."],
            ["`/lectores`", "Directory with search, city and sorting by proximity or activity."],
            ["`/clubes`, `/clubes/[clubId]`", "Clubs by city: requests, current read, voting, attendance and private forum."],
            ["`/listas`, `/listas/[listId]`", "Reading lists: readable without a session (the signature only appears if its owner authorises it) and only their owner edits them."],
            ["`/libro/[id]`", "Copy page with metadata and JSON-LD `Book`/`Offer`."],
            ["`/obra/[bookId]`", "Canonical work: conversation about the title, copies and recommendations."],
            ["`/u/[id]`", "Public profile: biography, figures, reviews, shelf and following."],
            ["`/cuenta`", "Settings: profile, notifications, password, encryption, second factor, export and deletion."],
            ["`/admin`", "Community moderation; requires an active second factor."],
            ["`/privacidad`, `/aviso-legal`", "Privacy policy (art. 13 GDPR) and legal notice (§ 5 DDG)."],
            ["`/verificar`, `/restablecer`", "Email confirmation and a new password from the link."],
            ["`/documentacion`", "This page."],
            ["`/projekt`", "What the project is, why it exists, that it is non-commercial and what it demonstrates."],
            ["`/api/health`", "Status of the service and of the database."],
            ["`/sitemap.xml`, `/robots.txt`", "Indexing: the sitemap publishes the home page, the public catalogue and the pages for works."],
          ],
        },
        {
          kind: "p",
          text: "The API has 72 handlers under `src/app/api`. Almost all of them are declared with `route()` (`src/lib/route.ts`), which applies the session, the Zod schema for the body, the quota with origin guard and `handleApiError()` in a single place; `tests/route.test.ts` checks against the files that no route is left without translating errors into JSON.",
        },
        {
          kind: "list",
          items: [
            "`/api/auth/*`: registration, sign-in, sign-out, session, verification and recovery with single-use tokens.",
            "`/api/listings`, `/api/listings/[id]`, `…/favorite`: publish, edit, withdraw and save copies.",
            "`/api/requests`, `/api/requests/[id]` and their derivatives (`events` over SSE, `messages`, `read`, `review`): the whole exchange lifecycle.",
            "`/api/books/*`: work search, comments, likes, per-work notifications and reading states.",
            "`/api/clubs/*`: club, members, moderators, invitations, attendance, transfer, forum, votes and join requests.",
            "`/api/lists/*`, `/api/direct/*`, `/api/users/[userId]/follow`, `/api/blocks`: lists, encrypted direct messaging, following and blocking.",
            "`/api/account/*`: profile, language, password, encryption keys, TOTP, export and deletion.",
            "`/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: reports, moderation, comments and notifications.",
            "`/api/cover/*`, `/api/isbn/[isbn]`: cached covers and bibliographic record (DNB and Open Library).",
            "`/api/cron/maintenance`: scheduled tasks, with `MAINTENANCE_TOKEN`. It retries the Mastodon outbox, purges old rows and, with `MASTODON_LIKES=on`, gives a few well-spaced favourites to book posts.",
          ],
        },
      ],
    },
    {
      id: "datos",
      heading: "Data",
      blocks: [
        {
          kind: "list",
          items: [
            "`books` is the edition (unique ISBN) and `listings` the specific copy; `books.work_key` groups the editions of one and the same work, so they share the conversation and the list of copies.",
            "Copy states: `available`, `reserved`, `given`, `paused`, `removed`.",
            "Request states: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.",
            "Search with FTS5 (`listings_fts`) maintained by triggers; `unaccent()` folds accents so that “Lucía” is found by typing “lucia”.",
            "`cities` holds the known cities with their coordinates (the German seed) and `city_distances` their distance matrix. A city typed in a form is checked against OpenStreetMap: `resolveCity()` asks Nominatim, limited to European countries, and stores the name the map knows. Distance is secondary: a city outside that list simply shows no kilometres.",
          ],
        },
        {
          kind: "p",
          text: "Migrations are versioned with `PRAGMA user_version` (current: v46) and preserve the data of a previous installation. v40 gives each device its own key slot (`web` and `android`) and stores one encrypted envelope per recipient key, so the browser and the app read the same messages; v38 opens the catalogue to every city again, adds `requests.ship_kind` and `ship_street`, encrypts the shipping data that v37 stored in plain text and removes the Deutsche Post branches; v36 added encrypted direct messaging and v37 shipping by mail. The next three (v41–v43) add the social outbox (`social_outbox`) with the image of the post and the daily cap per account; v44 closes the loop of the exchange: the copy that was handed over stays `given` and the person who receives it gets one of their own; v45 adds `social_likes`, the bot's memory of what it has already favourited, and v46 adds the `books_fts` index so works are found without scanning the whole table.",
        },
        {
          kind: "p",
          text: "The hand-over and shipping columns (`handover_code`, `handover_method`, `ship_kind`, `ship_number`, `ship_station`, `ship_street`, `ship_postal_code`, `ship_city`) stay in the database so that nothing stored is deleted, but no code writes or reads them any more: the hand-over is agreed in the exchange conversation and each side confirms in the platform once it has the book, with no code and no addresses.",
        },
        {
          kind: "p",
          text: "An exchange never leaves the book orphaned: when it closes, the copy that was handed over stays `given` (it is the record) and the person who receives it gets **a copy of their own**, with the same edition and condition, in their city and paused (`listings.from_listing_id` and `from_request_id` keep the trail). From their shelf they can activate it and the book travels again; if moderation had removed the original copy, the new one still exists and nothing returns to the catalogue without its owner deciding so.",
        },
        {
          kind: "p",
          text: "The messages of an exchange and direct messages are encrypted in the browser (ECDH P-256 + HKDF-SHA256 + AES-GCM-256 with AAD). The server stores the envelope and the fingerprint of the key, and rejects plain text if either party has a published key (409).",
        },
        {
          kind: "list",
          items: [
            "A copy is only reserved if it is still `available`, within the same transaction.",
            "On acceptance, competing requests move to `expired`; only the owner accepts or declines.",
            "Closing is two-sided: each party confirms separately and only the second confirmation completes the exchange.",
            "The book changes hands: the copy that was handed over stays `given` and the receiver gets a paused copy on their shelf that they can activate whenever they want.",
            "Once a handover is confirmed the exchange can no longer be cancelled: the copy does not return to the catalogue behind the back of whoever already declared that they handed it over.",
            "The rating (1–5 plus an optional comment) scores **the person** you swap with, not the book: one per side and exchange, only once it is completed, and it shows on their profile as an average and comments.",
            "Unanswered requests expire after 14 days and notify the person who was waiting.",
            "Blocks, suspended accounts and paused copies are filtered in SQL, not in the client.",
          ],
        },
      ],
    },
    {
      id: "seguridad",
      heading: "Security",
      blocks: [
        {
          kind: "list",
          items: [
            "Passwords with asynchronous `scrypt` and a unique salt; sign-in always verifies a hash (against a decoy if the account does not exist), so the response time does not reveal which email addresses are registered.",
            "Exchange and direct messages are end-to-end encrypted (ECDH P-256 + HKDF-SHA256 + AES-GCM). Each account publishes **one key per slot** (`web` and `android`); the sender stores one envelope per recipient key, so the browser and the app read the same message. Only the first key of an account is published without confirmation: as soon as one slot is taken, both replacing it and **adding a device** require the password, and every change raises a security notification.",
            "A 256-bit session in an `httpOnly` cookie with `SameSite=Lax`; in production only the `__Host-` prefix is accepted and only its SHA-256 lives in the database.",
            "Two-step verification (TOTP per RFC 6238, ±1 step window and anti-replay) is mandatory for moderating in production; the secrets are stored encrypted.",
            "Atomic quotas in the database per IP and per account, with `429` and `Retry-After`.",
            "Every mutation goes through `guard()` (origin and quota) and `readJson()` requires `application/json` and cuts off bodies over 64 KB.",
            "CSP with nonce and `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS in production (`src/proxy.ts`).",
            "Directory `0700` and database `0600`; `npm run db:backup` uses the `.backup()` API of SQLite and encrypts with AES-256-GCM if `WANDERBIBLIOTHEK_BACKUP_KEY` is present.",
            "Registration with a honeypot, a minimum elapsed time and optional Cloudflare Turnstile; a generic message so that registered email addresses are not revealed.",
            "Single-use account tokens, hashed and with an expiry; changing the password revokes every session.",
            "`GET /api/account/export` delivers all data as JSON, **envelopes included** (without them nothing could be decrypted outside the app); deleting the account anonymises the profile, withdraws its copies, deletes its device keys and direct conversations, and keeps the exchange history without breaking other people's threads.",
            "An encrypted message is rejected when the envelope for one of the recipient's active devices is missing: that device could not read it and the failure would only show up days later.",
            "What this encryption does **not** cover, plainly: every message is encrypted with the identity key of its slot, **with no forward secrecy** (no ratchet), and there is no recovery. Whoever gets both the database and one device's private key can read what that device received; losing the device or the browser data means losing that history. Changing it takes a versioned protocol change and both clients, not a patch.",
          ],
        },
      ],
    },
    {
      id: "permisos",
      heading: "Permissions per resource",
      blocks: [
        {
          kind: "p",
          text: "Signing in is not enough: every operation also checks that the resource belongs to the person asking for it, and does so **inside the query** (`owner_id = ?` or “either of the two parties”), not in an `if` in the component. That is why a foreign id answers `404` — “it does not exist” — rather than `403`: a 403 would confirm that something with that id exists.",
        },
        {
          kind: "table",
          head: ["Operation", "Signed out", "Another account", "Party or owner", "Administration"],
          rows: [
            ["Browse the catalogue and a work page", "Yes", "Yes", "Yes", "Yes"],
            ["Publish a copy", "No", "Yes, with a confirmed email", "Yes", "Yes"],
            ["Edit, pause or withdraw a copy", "No", "No", "Only its owner", "Withdraws, does not edit"],
            ["See an exchange request", "No", "No", "Only its two parties", "No"],
            ["Accept, cancel or confirm an exchange", "No", "No", "Its two parties, according to role and transition", "No"],
            ["Read or write in a direct thread", "No", "No", "Its participants, with mutual following and a published key", "No"],
            ["Rate the other person", "No", "No", "Once, after the exchange is completed", "No"],
            ["Comment, write in a club or in a list", "No", "Yes, with a confirmed email", "Yes", "Yes"],
            ["Moderate: reports, suspensions, removals", "No", "No", "No", "Yes, with 2FA in production"],
            ["Export or delete the account", "No", "No", "Only its owner", "No"],
          ],
        },
        {
          kind: "p",
          text: "`tests/authorization.test.ts` walks this table with an owner, a third account and a one-sided follow; the club, privacy and exchange tests cover the remaining roles.",
        },
      ],
    },
    {
      id: "entorno",
      heading: "Environment variables",
      blocks: [
        {
          kind: "p",
          text: "Without `APP_ENCRYPTION_KEY` no secret is stored in plain text: creating one fails with a configuration error. In production, `src/instrumentation.ts` checks the configuration at start-up and leaves the reason in the log.",
        },
        {
          kind: "table",
          head: ["Variable", "Default", "Purpose"],
          rows: [
            ["`WANDERBIBLIOTHEK_DB`", "`.data/wanderbibliothek.db`", "Path of the SQLite database (`:memory:` in the tests)."],
            ["`NEXT_PUBLIC_SITE_URL`", "`http://localhost:3000`", "Base for `sitemap.xml`, `robots.txt` and the canonical URLs. Mandatory in production."],
            ["`APP_ENCRYPTION_KEY`", "unset", "32 bytes in hex or base64 to encrypt the TOTP secret. Mandatory."],
            ["`APP_ENCRYPTION_KEY_ID`", "derived", "Readable name of the active key; when it is missing, a prefix of its SHA-256 is used."],
            ["`APP_ENCRYPTION_OLD_KEYS`", "empty", "Previous keys, read-only, while a rotation is being completed."],
            ["`WANDERBIBLIOTHEK_ALLOW_PLAINTEXT`", "empty", "Development only: stores secrets in plain text if there is no key."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEY`", "unset", "AES-256-GCM key for the backups."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEEP`", "`14`", "Backups kept when rotating."],
            ["`WANDERBIBLIOTHEK_BACKUP_HOOK`", "unset", "Command that receives `BACKUP_FILE` for the external copy."],
            ["`WANDERBIBLIOTHEK_COVER_CACHE`", "next to the database", "Folder for downloaded and uploaded covers."],
            ["`WANDERBIBLIOTHEK_SKIP_ENV_CHECK`", "unset", "Skips the environment check at start-up."],
            ["`BREVO_API_KEY` / `MAIL_FROM`", "unset", "Direct sending through the Brevo API, without an intermediary. `MAIL_FROM` accepts `Name <address@domain>`; if there is also a webhook, the webhook wins."],
            ["`MAIL_WEBHOOK_URL`", "unset", "Receives `{to, subject, text}`; sending goes through `mail_outbox` with retries."],
            ["`MAIL_WEBHOOK_TOKEN`", "unset", "`Bearer` authentication for the mail webhook."],
            ["`MAINTENANCE_TOKEN`", "unset", "Token for the `POST /api/cron/maintenance` cron; without it, 404."],
            ["`AUDIT_RETENTION_DAYS`", "`730`", "Days that `admin_audit` is kept (0 = forever)."],
            ["`ADMIN_EMAIL` / `ADMIN_PASSWORD`", "unset", "Create the first administrator if none exists."],
            ["`REQUIRE_EMAIL_VERIFICATION`", "unset", "`1` requires a confirmed email address to publish, request, comment and write."],
            ["`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`", "unset", "Enable Cloudflare Turnstile on registration; the Android app solves the widget in a WebView at `/verificacion`."],
            ["`ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN`", "unset", "Receive 500 errors as JSON (Sentry, Logtail or your own webhook)."],
            ["`TRUST_PROXY`", "unset", "`1` only behind your own proxy: authorises `X-Forwarded-For`/`-Host` and enables the per-IP quotas."],
            ["`LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL`", "unset", "Fill in `/privacidad` and `/aviso-legal`."],
            ["`LEGAL_VAT_ID` / `LEGAL_PHONE` / `LEGAL_REGISTER`", "unset", "Optional details for the legal notice."],
            ["`SEED_DEMO`", "`1` outside production", "Seeds the demo data; in production only with an explicit `1`."],
            ["`GOOGLE_BOOKS_API_KEY`", "unset", "Raises the Google Books quota for the covers."],
            [
              "`MASTODON_TOKEN`",
              "unset",
              "Enables the bot that announces on Mastodon the works published by an administrator account (community listings never reach the queue); without it nothing is queued or posted. One announcement per work, account and day; when several are published at once the first goes out immediately and the rest are queued with a random gap of 4 to 7 hours (the administration has no daily cap).",
            ],
            [
              "`MASTODON_QUIET_HOURS`",
              "`22-9`",
              "Quiet window in Berlin time: between the start and end hour neither announcements nor favourites go out (whatever is due waits until 09:00). `off` disables it, and a band that does not cross midnight (`1-5`) also works.",
            ],
            [
              "`MASTODON_LIKES` / `MASTODON_LIKES_PER_DAY` / `MASTODON_LIKES_MIN_GAP_MINUTES`",
              "off / 40 / 25",
              "Turns on favouriting of book posts: daily cap, minimum gap and `MASTODON_LIKES_TAGS` for your own hashtags. It looks at all three languages (de, es, en) and only at accounts whose bio talks about books (`MASTODON_LIKES_LOCALES`, `MASTODON_LIKES_PER_ACCOUNT`). Needs `write:favourites` on the token.",
            ],
          ],
        },
      ],
    },
    {
      id: "pruebas",
      heading: "Tests and continuous integration",
      blocks: [
        {
          kind: "p",
          text: "`npm test` runs 714 unit and integration tests in 89 files (Node test runner on SQLite in memory) and `npm run test:e2e` adds 36 browser tests with Playwright, which starts its own server on port 3100.",
        },
        {
          kind: "p",
          text: "`npm run test:coverage` enforces minimum thresholds of 92 % lines, 80 % branches and 88 % functions. Continuous integration (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test`, `build`, `npm audit --omit=dev`, the browser tests and a build of the Docker image without publishing it.",
        },
        {
          kind: "p",
          text: "CI also audits **development** dependencies (a full `npm audit`): ESLint, TypeScript and Playwright build what gets published. And the `minimatch@11` `override` in `package.json` is there because `@typescript-eslint/typescript-estree` resolved a version carrying a ReDoS advisory; it only affects the ESLint chain, not the runtime, and can be dropped once that dependency brings it on its own.",
        },
        {
          kind: "code",
          lines: [
            "npm install",
            "npm run lint && npm run typecheck && npm test",
            "npm run build",
            "npx playwright install chromium && npm run test:e2e",
          ],
        },
      ],
    },
    {
      id: "operacion",
      heading: "Operations",
      blocks: [
        {
          kind: "list",
          items: [
            "`npm run db:backup` uses the `.backup()` API of SQLite, checks the integrity, rotates the backups, encrypts if there is a key and runs `WANDERBIBLIOTHEK_BACKUP_HOOK`. Never copy the file while it is running with WAL active.",
            "`POST /api/cron/maintenance` with `Authorization: Bearer $MAINTENANCE_TOKEN` expires requests, purges sessions, notifications and quotas, deletes old activity (`events` and `product_events`, 180 days) and the moderation audit according to `AUDIT_RETENTION_DAYS`, and sends the reminders for the clubs.",
            "`npm run user:verify -- <address>` and `npm run admin:2fa-off -- <address>` are the emergency exits when email or the second factor locks someone out.",
            "Every response carries `x-request-id` and `x-response-time`, and every request leaves a `[req] {…}` line in the log. The `reference` returned by a 500 is the first 8 characters of that id.",
            "A query over 50 ms leaves a `[db] consulta lenta` notice with its duration and the truncated SQL: `better-sqlite3` is synchronous, so while a query runs the whole process is stopped. The cron also returns under `db` the size of the file, the WAL and the free pages **after** the checkpoint.",
            "A single instance: SQLite has a single writer and the notification bus lives in memory. Scaling requires PostgreSQL and Redis/pubsub.",
            "Ceiling measured with `npm run bench:sqlite`: about 99 000 single writes/s, 250 000/s in a batch, 350 000 reads/s by primary key and 2 000/s in a filter without an index over 5 000 rows. The real limit is the duration of each transaction, not the number of visits.",
          ],
        },
        {
          kind: "p",
          text: "Secrets are stored as `enc:v2:<key>:<flags>:<iv>.<tag>.<data>`. To change the key without losing anything:",
        },
        {
          kind: "code",
          lines: [
            "# 1. Ensayo: la nueva entra como activa y la vieja queda para leer",
            "APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> \\",
            "  npm run rotate:secrets -- --dry-run",
            "",
            "# 2. Cuando el informe cuadre, sin --dry-run",
            "APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> \\",
            "  npm run rotate:secrets",
            "",
            "# 3. Retira APP_ENCRYPTION_OLD_KEYS",
          ],
        },
      ],
    },
    {
      id: "despliegue",
      heading: "Deployment",
      blocks: [
        {
          kind: "list",
          items: [
            "The full guide (system user, systemd, nginx, TLS, timers and restore) is in `deploy/README.md`.",
            "`deploy/wanderbibliothek.service`, `deploy/nginx.conf` and `deploy/env.example`: the application listens on `127.0.0.1:3000` and nginx terminates TLS, with `/api/requests/` unbuffered so that the SSE channel is not cut.",
            "`deploy/wanderbibliothek-maintenance.timer` (every 15 minutes) and `deploy/wanderbibliothek-backup.timer` (every 6 hours).",
            "There is also a multi-stage `Dockerfile` and `docker-compose.yml` with production dependencies only; the image build is validated in continuous integration.",
            "If something important is missing from the configuration, the process starts but answers 500 to everything with the reason in the log, instead of appearing to work.",
            "`tsx` is a production dependency: `admin:create`, `db:backup`, `user:verify` and `smoke` use it, also inside the image with `npm ci --omit=dev`.",
          ],
        },
      ],
    },
    {
      id: "interfaz",
      heading: "Interface and accessibility",
      blocks: [
        {
          kind: "list",
          items: [
            "A single shell (`SiteShell`) for the internal pages; the home page is the exception and leaves the catalogue at the full available width.",
            "Colours come from tokens (`src/app/styles/tokens.css`): outside that file there are no literals, so the light and the dark mode share the same markup.",
            "Four breakpoints (480, 768, 1120 and 1400/1800 px), a spacing scale from 4 to 48 px and controls at 40 px, 44 on mobile.",
            "Dialogs with trapped focus, closing on `Escape` and focus restoration; a “Skip to content” link, `aria-current` in the navigation, filters with `aria-pressed` and errors with `role=\"alert\"`.",
            "Minimum AA contrast, type from 12 px, 44 px touch targets on mobile and `prefers-reduced-motion` respected.",
            "The interface is trilingual: the switcher wins, storing the `wanderbibliothek-locale` cookie and, if there is a session, the account preference for notifications and mail; without a preference the browser language (`Accept-Language`) decides, and German if none of the three matches.",
          ],
        },
      ],
    },
    {
      id: "enlaces",
      heading: "Further reading",
      blocks: [
        {
          kind: "links",
          items: [
            {
              label: "Repository",
              href: REPOSITORY,
              note: "Source code, history and private vulnerability reports.",
            },
            {
              label: "DOCUMENTATION.md",
              href: `${REPOSITORY}/blob/main/DOCUMENTATION.md`,
              note: "This same page in English, inside the repository.",
            },
            {
              label: "CONTRIBUTING.md",
              href: `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
              note: "Environment, quality commands, commit conventions and migration rules.",
            },
            {
              label: "SECURITY.md",
              href: `${REPOSITORY}/blob/main/SECURITY.md`,
              note: "How to report a vulnerability and good self-hosting practice.",
            },
            {
              label: "deploy/README.md",
              href: `${REPOSITORY}/blob/main/deploy/README.md`,
              note: "Step-by-step deployment with systemd, nginx and TLS.",
            },
            {
              label: "LICENSE",
              href: `${REPOSITORY}/blob/main/LICENSE`,
              note: "MIT licence.",
            },
            {
              label: "NOTICE",
              href: `${REPOSITORY}/blob/main/NOTICE`,
              note: "Attributions for the cover photograph and the typeface.",
            },
          ],
        },
      ],
    },
  ],
};
