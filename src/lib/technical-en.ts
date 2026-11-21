/**
 * Documentación técnica en inglés (`/techdoc`).
 *
 * Es la traducción del documento `ES` de `technical.ts`: mismos identificadores
 * de sección, mismos tipos de bloque y mismo orden, de modo que las tres
 * versiones se mantengan en paralelo. Solo se traduce la prosa; rutas, ficheros,
 * variables, identificadores y fragmentos de código son idénticos en las tres.
 *
 * La fecha `updated` repite el literal de `ES` (`UPDATED` no se exporta).
 */

import { REPOSITORY } from "./brand";
import { SCHEMA_VERSION } from "./db/schema";
import type { TechnicalDocument } from "./technical";

export const EN: TechnicalDocument = {
  title: "Technical documentation",
  updated: "2026-11-21",
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
          text: "No external services are mandatory. The server queries Open Library and the German National Library for bibliographic data; users upload covers, which this instance serves. Depending on configuration, the browser may also communicate with Cloudflare Turnstile and the browser's push service.",
        },
        {
          kind: "p",
          text: "The code is released under the AGPL-3.0 licence. This page describes the code run by the instance that serves it.",
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
            "    api/               86 route files grouped by domain",
            "    styles/            tokens, typography, structure, cards, dialogs, detail pages",
            "    proxy.ts           CSP with nonce and security headers",
            "  components/          server shell and client islands",
            "  lib/",
            "    db/                connection, base schema (v2), migrations (v3–v65), seed",
            "    repo/              SQL queries per domain; repo.ts only re-exports",
            "    validation.ts      Zod schemas with translated messages",
            "    secret-box.ts      reversible encryption with a key ring (TOTP)",
            "    e2e.ts             end-to-end encryption (ECDH + HKDF + AES-GCM)",
            "    route.ts           route wrapper: session, body, quota, errors",
            "tests/                 unit and integration test suite",
            "e2e/                   browser tests with Playwright (11 spec files + Firefox/WebKit smoke)",
            "deploy/                systemd, nginx, environment template and guide",
          ],
        },
        {
          kind: "p",
          text: "The shell (`site-shell.tsx`, `site-rail.tsx`) is a Server Component: the sidebar, the header, the footer and the mobile navigation arrive already rendered. Within the shell, only the interactive islands hydrate (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`); the application view (`wanderbibliothek-app`) is a separate client island.",
        },
        {
          kind: "p",
          text: "`getDb()` intercepts `prepare` in order to reuse compiled statements (FIFO cache of 400 per connection). Public aggregates are served with `use cache` and the `public-data` tag, which the routes that mutate invalidate.",
        },
      ],
    },
    {
      id: "rutas",
      heading: "Routes",
      blocks: [
        {
          kind: "p",
          text: "Internal pages require a session; without one they redirect to `/?auth=1&next=…`. The home page, legal pages, flows with their own link and this documentation are public. The catalogue, works, lists, reader directory and profiles are marked `noindex`; `robots.txt` allows crawlers to read that directive and is not access control.",
        },
        {
          kind: "table",
          head: ["Route", "Content"],
          rows: [
            ["`/`", "Public home page: four figures and a row of books in the interface language (`BOOK_LANGUAGE_BY_LOCALE`); with no books in that language it shows the whole catalogue."],
            ["`/descubrir`", "Catalogue with search, categories, sorting and pagination in the URL. Visible without a session, but each copy shows only the book and the city, never who offers it; requesting a book requires an account."],
            ["`/werk/[id]`", "Public work page with JSON-LD `Book`/`Offer`, marked `noindex`."],
            ["`/ofrecer`", "Publish a copy: the ISBN fills in the bibliographic record."],
            ["`/buscar`", "Global search: works, clubs, readers and lists."],
            ["`/estanteria`, `/intercambios`", "Private sections: own copies and requests with their next step."],
            ["`/comunidad`", "Community: conversations, activity, clubs, readers and lists, with `?scope=`."],
            ["`/lectores`", "Directory with search, city and sorting by proximity or activity."],
            ["`/clubes`, `/clubes/[clubId]`", "Clubs by city: requests, current read, voting, attendance and private forum."],
            ["`/listas`, `/listas/[listId]`", "Reading lists: readable without a session (the signature only appears if its owner authorises it) and only their owner edits them."],
            ["`/libro/[id]`", "Copy page with metadata and JSON-LD `Book`/`Offer`."],
            ["`/obra/[bookId]`", "Canonical work: conversation about the title, copies and recommendations."],
            ["`/u/[id]`", "Public profile: biography, figures, reviews, shelf and following."],
            ["`/cuenta`", "Settings: profile, notifications, password, encryption, second factor, export and deletion."],
            ["`/admin`", "Community moderation; requires an active second factor."],
            ["`/datenschutz`, `/aviso-legal`", "Privacy policy (art. 13 GDPR) and legal notice (§ 5 DDG)."],
            ["`/verificar`, `/restablecer`", "Email confirmation and a new password from the link."],
            ["`/techdoc`", "This page."],
            ["`/projekt`", "What the project is, why it exists, that it is non-commercial and what it demonstrates."],
            ["`/normas`", "Governance, moderation, sanctions and appeals."],
            ["`/apelar`", "Appeal form opened from the sanction email."],
            ["`/api/health`", "Status of the service and of the database."],
            ["`/sitemap.xml`, `/robots.txt`", "The sitemap publishes the home page and information pages in all three languages (with `xhtml:link`). The catalogue, works, lists and profiles are omitted and marked `noindex`; `robots.txt` allows crawlers to read that directive, and no search-engine notifications are sent."],
          ],
        },
        {
          kind: "p",
          text: "The API has 86 route files under `src/app/api` with 116 exported methods, and every one of them goes through `route()` (`src/lib/route.ts`). The wrapper applies the session, the Zod schema for the body, the quota, the origin guard for mutations, the translation of errors into JSON (`handleApiError()`) and the trace headers in a single place. `tests/route.test.ts` checks against the files that no route stays outside the wrapper, drops the JSON error translation or skips the origin check on writes.",
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
            "`/api/account/appeals`, `/api/account/appeal-link`, `/api/admin/appeals/[id]`: appeals with a single-use token; the link can be requested again with the account email, and the review is done by a different person, from the team or, with their name recorded, from another instance.",
            "`/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: reports, moderation, comments and notifications.",
            "`/api/cover/*`, `/api/isbn/[isbn]`: covers and bibliographic record (DNB and Open Library). The cover is streamed from disk without copying it into memory, carries a version in the URL (`?v=…`) so no cache serves the old one, and nginx keeps it at the edge.",
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
            "Search with FTS5 maintained by triggers: `listings_fts` for the catalogue and `books_fts` for works; `unaccent()` folds accents so that “Lucía” is found by typing “lucia”.",
            "`cities` holds a curated set of cities in Germany and Austria with their coordinates, and `city_distances` the distance matrix between them; only Austrian names with a German namesake (Baden, Linz) carry `(AT)`. `searchCities()` gets suggestions from OpenStreetMap through Photon and `resolveCity()` checks the name with Nominatim, both limited to those two countries. Other municipalities can be used, but have no precomputed distance.",
          ],
        },
        {
          kind: "p",
          text: `The schema is versioned with \`PRAGMA user_version\` (current: v${SCHEMA_VERSION}). A new installation starts from \`SCHEMA_V2\` and its indexes and runs the ${SCHEMA_VERSION - 2} steps up to v${SCHEMA_VERSION}; existing ones climb the ladder in \`src/lib/db/migrations.ts\`, which keeps the data. A published migration is never rewritten: every change adds a step. The full path, step by step, is in that file and in its git history.`,
        },
        {
          kind: "p",
          text: "An exchange never leaves the book orphaned: when it closes, the copy that was handed over stays `given` (it is the record) and the person who receives it gets **a copy of their own**, with the same edition and condition, in their city and paused (`listings.from_listing_id` and `from_request_id` keep the trail).",
        },
        {
          kind: "p",
          text: "From their shelf they can activate it and the book travels again. If moderation had removed the original copy, the new one still exists and nothing returns to the catalogue without its owner deciding so.",
        },
        {
          kind: "p",
          text: "The hand-over is agreed in the conversation, and each side confirms in the platform once it has the book.",
        },
        {
          kind: "list",
          items: [
            "A copy is only reserved if it is still `available`, within the same transaction.",
            "On acceptance, competing requests move to `expired`; only the owner accepts or declines.",
            "Closing is two-sided: each party confirms separately and only the second confirmation completes the exchange.",
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
            "Passwords with asynchronous `scrypt` and a unique salt, with the parameters stored in the hash itself (`scrypt$N,r,p$salt$hash`) so they can be raised later without locking anyone out; the previous format is still verified and rehashed at the next sign-in.",
            "Sign-in always verifies a hash (against a decoy if the account does not exist), so the response time does not reveal which email addresses are registered.",
            "Exchange and direct messages are end-to-end encrypted (ECDH P-256 + HKDF-SHA256 + AES-GCM). Each account publishes **one key per platform slot** —today only `web`; the sender stores one envelope per recipient key, so any client with a published key reads the same message.",
            "On top of that sits a v2 protocol in progress (`docs/e2e-protocol-v2.md`): identity **per device** instead of per slot, one-time keys the server hands out exactly once, and libolm's Double Ratchet. That buys forward secrecy — a device compromised today does not open yesterday's messages — and authenticates the sender inside the session. The server already publishes, lists, revokes and hands out those keys (`/api/account/devices`, `/api/users/:id/devices`); the interface still sends with v1 until the v2 client ships.",
            "Only the first key of an account is published without confirmation: as soon as one slot is taken, both replacing it and **adding another** require the password, and every change raises a security notification. In the browser the identity is **one per account**: two accounts on the same device never share a key pair.",
            "A 256-bit session in an `httpOnly` cookie with `SameSite=Lax`; in production only the `__Host-` prefix is accepted and only its SHA-256 lives in the database.",
            "Two-step verification (TOTP per RFC 6238, ±1 step window and anti-replay) is mandatory for moderation and administration in production; the secrets are stored encrypted. Sanctions carry a reason and a duration (1–365 days), and the appeal is reviewed by a different team member.",
            "Atomic quotas in the database per IP and per account, with `429` and `Retry-After`.",
            "`route()` checks the origin on every mutation, whether or not a quota is declared; the quota can live in the wrapper or inside the handler when a route chains several layers (for instance, a short and a daily limit). `readJson()` requires `application/json` and cuts off bodies over 64 KB.",
            "CSP with nonce and `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS in production (`src/proxy.ts`).",
            "Directory `0700` and database `0600`; `npm run db:backup` uses the `.backup()` API of SQLite and encrypts with AES-256-GCM if `WANDERBIBLIOTHEK_BACKUP_KEY` is present.",
            "Registration with a honeypot, a minimum elapsed time and optional Cloudflare Turnstile; a generic message so that registered email addresses are not revealed.",
            "Single-use account tokens, hashed and with an expiry; changing the password revokes every session.",
            "`GET /api/account/export` delivers all data as JSON, **envelopes included**: without them nothing could be decrypted outside the app.",
            "Deleting the account anonymises the profile, withdraws its copies, deletes its device keys, direct conversations, reviews and club forum messages, and clears votes, likes and attendance; it keeps the exchange history without breaking other people's threads.",
            "An encrypted message is rejected when the envelope for one of the recipient's active devices is missing: that device could not read it and the failure would only show up days later.",
            "What this encryption does **not** cover, plainly: every message is encrypted with the identity key of its slot, **with no forward secrecy** (no ratchet), and there is no recovery.",
            "Whoever gets both the database and one device's private key can read what that device received; losing the device or the browser data means losing that history. Changing it takes a versioned protocol change and every client, not a patch.",
          ],
        },
      ],
    },
    {
      id: "transparencia",
      heading: "Transparency",
      blocks: [
        {
          kind: "p",
          text: "`GET /api/version` publishes the commit, image digest and build time this instance was built with, plus links to the repository. When a deployment does not know them, the fields are `null`: no commit is invented. The page footer shows the same identifier when it exists.",
        },
        {
          kind: "p",
          text: "Every `v*` tag is published as a GHCR image pinned by digest, with SLSA provenance and an SBOM, signed with cosign in keyless mode. `deploy/verify-release.sh` checks that the signature belongs to this repository and its release workflow; deploying by digest prevents a moving tag from swapping the verified image.",
        },
        {
          kind: "p",
          text: "The cron creates at most one snapshot of the public catalogue per day: one canonical JSON line per work, its SHA-256, a Merkle root and an Ed25519 signature when the instance has `TRANSPARENCY_SIGNING_KEY`. `/api/transparency` lists the snapshots and `/api/transparency/export` serves the exact NDJSON that was signed. `npm run transparency:verify -- --url …` recomputes everything from outside, checks the chain of roots and can pin the public-key fingerprint (`--key-fingerprint`) as well as the Merkle root (`--pin`).",
        },
        {
          kind: "p",
          text: "The key directory is signed separately in the same pass: `/api/transparency/keys` publishes roots and signatures, never which key belongs to which account, and each account can request its inclusion proof at `/api/account/keys/proof`. If the server shows a key other than the one committed, it cannot produce the proof against a published root.",
        },
        {
          kind: "list",
          items: [
            "What it guarantees: a change to published content leaves a trace, and a past snapshot cannot be replaced by another without breaking the signature or the chain.",
            "What it does not include: anything about people. The payload comes from `listPublicWorks()` — work, editions, copies per city — never from who owns a copy, which is why it can be served without a session.",
            "What it cannot guarantee: without hardware attestation (TPM 2.0 with IMA and a verifier such as Keylime, or a confidential VM with SEV-SNP/TDX) nothing cryptographically proves that the answering process is the signed image. Tampering is detectable, not impossible, and the deployment guide says so explicitly.",
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
          text: "Signing in is not enough: every operation also checks that the resource belongs to the person asking for it, and does so **inside the query** (`owner_id = ?` or “either of the two parties”), not in an `if` in the component. That is why a foreign id answers `404` (“it does not exist”) rather than `403`: a 403 would confirm that something with that id exists.",
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
            ["`NEXT_PUBLIC_SITE_URL`", "`http://localhost:3000`", "Base for the canonical URLs, `sitemap.xml` and `robots.txt`. Mandatory in production, always `https://`."],
            ["`APP_ENCRYPTION_KEY`", "unset", "32 bytes in hex or base64 for the TOTP secret. Mandatory; `APP_ENCRYPTION_KEY_ID` and `APP_ENCRYPTION_OLD_KEYS` are only needed when rotating it."],
            ["`WANDERBIBLIOTHEK_DB`", "`.data/wanderbibliothek.db`", "Path of the SQLite database (`:memory:` in the tests)."],
            ["`BREVO_API_KEY` / `MAIL_FROM`", "unset", "Mail sent directly through the Brevo API. `MAIL_FROM` accepts `Name <address@domain>`."],
            ["`MAIL_WEBHOOK_URL` / `MAIL_WEBHOOK_TOKEN`", "unset", "Alternative to Brevo: receives `{to, subject, text}`; with both configured the webhook wins."],
            ["`MAINTENANCE_TOKEN`", "unset", "Token for `POST /api/cron/maintenance`; without it the route answers 404."],
            ["`TRUST_PROXY`", "unset", "`1` only behind your own proxy: authorises `X-Forwarded-For`/`-Host` and enables the per-IP quotas."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEY` / `WANDERBIBLIOTHEK_BACKUP_KEEP`", "unset / `14`", "Key of the encrypted backups and how many are kept when rotating."],
            ["`ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN`", "unset", "Receive 500 errors as JSON, already redacted."],
            ["`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`", "unset", "Enable Cloudflare Turnstile on registration."],
            ["`REQUIRE_EMAIL_VERIFICATION`", "unset", "`1` requires a confirmed address to publish, request, comment and write."],
            ["`AUDIT_RETENTION_DAYS`", "`730`", "Days `admin_audit` is kept (0 = forever)."],
            ["`LEGAL_*`", "unset", "Controller, address, contact and optional details for `/datenschutz` and `/aviso-legal`."],
            ["`TRANSPARENCY_SIGNING_KEY`", "unset", "Ed25519 key (PKCS#8 in base64 or PEM) that signs the daily catalogue snapshot. Without it, snapshots are published unsigned and marked as such."],
            ["`APP_COMMIT_SHA` / `APP_BUILD_TIME` / `APP_IMAGE`", "unset", "Build identity published by `/api/version`; filled by the release workflow or `deploy/deploy.sh`."],
          ],
        },
        {
          kind: "p",
          text: "The canonical template is `deploy/env.example`: every variable, the ones in this table and the detail ones (bot, backups, demo data, first administrator), is there, commented, with its default value.",
        },
      ],
    },
    {
      id: "pruebas",
      heading: "Tests and continuous integration",
      blocks: [
        {
          kind: "p",
          text: "`npm test` runs the unit and integration suite with the Node test runner on SQLite in memory; `npm run test:e2e` adds 66 browser tests with Chromium, starting its own server on port 3100; `npm run test:e2e:smoke` runs the WebCrypto and IndexedDB smoke in Firefox and WebKit.",
        },
        {
          kind: "p",
          text: "`npm run test:coverage` enforces minimum thresholds of 92 % lines, 80 % branches and 88 % functions. Two of the browser tests are guards rather than features: `e2e/accesibilidad.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on the home page, the catalogue, a copy page and the sign-in dialog and fails on `serious` or `critical` findings; `e2e/rendimiento.spec.ts` checks that a catalogue visit stays under a byte budget and that no single image goes over 250 KB — the guard against covers going back to the 1.3 MB originals. The budget is measured against the production build, so it only runs in CI.",
        },
        {
          kind: "p",
          text: "Continuous integration (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test`, `test:coverage`, `build`, `npm audit --omit=dev`, the browser tests and a build of the Docker image, which is then scanned with Trivy. The job only fails on **critical vulnerabilities that have a fix**: an advisory with no available patch cannot be solved at that moment, but is still recorded.",
        },
        {
          kind: "p",
          text: "Every run publishes a CycloneDX SBOM (`npm sbom`) with the production dependencies: when an advisory lands, it tells whether that version was ever deployed. `tests/no-secrets.test.ts` looks for credentials in the working tree, locally and in CI, without any service, and does not replace reviewing the git history. Static analysis (CodeQL with the `security-extended` queries) lives in `.github/workflows/codeql.yml`.",
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
            "`npm run db:verify` is the restore rehearsal: it decrypts the newest backup (or the one given), opens it read-only as the app would, runs `integrity_check` and `foreign_key_check`, checks the schema version and counts the main tables. It exits non-zero when the backup cannot be restored.",
            "`POST /api/cron/maintenance` with `Authorization: Bearer $MAINTENANCE_TOKEN` expires requests, purges sessions, notifications and quotas, deletes old activity (`events` and `product_events`, 180 days), resolved reports (1 year), resolved appeals (2 years) and the moderation audit according to `AUDIT_RETENTION_DAYS`, and sends the reminders for the clubs.",
            "`npm run user:verify -- <address>` and `npm run admin:2fa-off -- <address>` are the emergency exits when email or the second factor locks someone out.",
            "Every route leaves a `[req] {…}` line with the id, method, path, status and latency, and returns the `x-response-time` header; nginx logs every application request with the same `x-request-id`, which also returns to the client. The `reference` returned by a 500 is the first 8 characters of that id.",
            "`/api/metrics` (administration or the maintenance token) returns p50/p95/p99 latency, memory, live streams, the state of the job queues and database/WAL size; with `?format=prometheus` it speaks the format a scraper understands.",
            "A query over 50 ms leaves a `[db] consulta lenta` notice with its duration and the truncated SQL: `better-sqlite3` is synchronous, so while a query runs the whole process is stopped. The cron also returns under `db` the size of the file, the WAL and the free pages **after** the checkpoint.",
            "A single instance: SQLite has a single writer, so scaling out requires PostgreSQL. The live channel does **not**: the in-memory bus only saves latency and the source of truth is a stamp polled from the database, so a second process keeps working (up to 15 s of delay between instances). A shared bus would remove that delay, not enable the deployment.",
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
            "Dialogs with trapped focus, closing on `Escape` and focus restoration; a “Skip to content” link, `aria-current` in the navigation, filters with `aria-pressed` and errors with `role=\"alert\"`.",
            "What is not visible on load does not travel in the initial bundle: the sign-in dialog, the exchange dialog, the publishing form, notifications and the community and exchanges views are fetched with `next/dynamic` when they open, and browser crypto is imported when the key is published, not at startup.",
            "Minimum AA contrast, type from 12 px, 44 px touch targets on mobile and `prefers-reduced-motion` respected: the animations (in `styles/motion.css`) only move `opacity` and `transform`, and switch off entirely with that setting.",
            "The interface is trilingual and every language has its URL: German stays without a prefix (`/werk/x`) and Spanish and English are published under `/es/…` and `/en/…`, with their own `hreflang` and canonical. Inside a URL with a prefix the prefix wins; otherwise the switcher with its cookie and the account preference; with no preference `Accept-Language` decides and, if none of the three matches, German.",
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
              note: "AGPL-3.0 licence.",
            },
            {
              label: "NOTICE",
              href: `${REPOSITORY}/blob/main/NOTICE`,
              note: "Attributions for the cover photograph and the third-party components.",
            },
          ],
        },
      ],
    },
  ],
};
