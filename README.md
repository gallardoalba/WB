# Wanderbibliothek

**Books travel, ideas connect people.**

Wanderbibliothek is a community project with no commercial purpose: a space to share the books that have shaped us and give them new readers.

Nothing is sold, and no one is rewarded for taking part.

## Why it exists

Some books stay with us because of what they mean to us and the lasting mark they leave. Passing them on is a way of sharing what we have learned from them and of treating the library as a commons rather than a private collection.

Knowledge is not something each of us owns and keeps to ourselves, but a commons that grows through circulation. A book passed from hand to hand gives rise to new readings, conversations and disagreements. That is why this platform is about books that matter, not about stock.

## What you can do

- **Share books.** List a book you'd like to pass on, including its condition and city. Entering an ISBN automatically retrieves bibliographic details from Open Library or the German National Library (DNB); the Austrian National Library is not currently queried, so Austrian-edition coverage depends on those catalogues. Covers are uploaded by users.
- **Exchange books.** Every exchange follows a simple, mutual process: one reader requests a book, the owner accepts, and both confirm the handover. Neither side can complete an exchange on their own. Once it's done, both readers can leave each other feedback. The book that has changed hands remains in the platform's history, while the recipient's own copy is temporarily paused.
- **No addresses, no shipping.** The platform never asks for postal addresses, postcodes or delivery details. Books are exchanged directly between readers.
- **Private messages.** Every exchange comes with an end-to-end encrypted conversation. Readers who follow each other can also send private messages.
- **Lists and nearby readers.** Start public reading lists and browse a directory of readers by distance. Your home page shows what is happening around you.
- **Self-hosted and lightweight.** The entire platform can run on a single small server using SQLite. Book catalogue and location lookups are handled server-side and cached locally, so the browser never connects directly to external services.
- **Germany and Austria.** City search and validation cover both countries. Distance filters use a curated set of cities; other municipalities can still be selected, but do not have a precomputed distance. Austrian city names carry `(AT)` to distinguish them from German homonyms. Cross-border exchanges are supported and arranged directly between readers; the platform does not handle shipping.

## Principles

**Reciprocity.** Nobody has to give something back. Anyone can request any book, and whoever has it is free to give it away or exchange it. Every contribution helps keep books in circulation and knowledge within reach of more people; there is no currency, no balance and no points.

**Non-profit and no market.** The project charges nothing and shows no advertising. It does not sell data. There is no premium tier and no paid placement: everything the platform offers is available to every account.

**Books as commons.** Once you have read a book, it can travel on to someone else. The platform handles handovers, not ownership: passing a copy on does not lose it, it puts it back into circulation.

**Transparency.** The source code is open, the documentation is public and every release is published as a signed image with its commit. Each instance publishes the commit and image digest it runs, and signed snapshots of the public catalogue, so what happens can be checked rather than taken on trust.

**Privacy.** Signing up asks for a name, a city and an email address; the password is stored only as a hash and the biography is optional. There is no third-party analytics and no tracking pixels: the project's own counters stay in the database and expire after 180 days. You can export your data as JSON or delete the account permanently.

**Autonomy.** No dependence on a corporate platform or a payment provider. Anyone can run their own instance.

## Run it yourself

Requires Node.js 24 or newer.

```bash
git clone https://github.com/gallardoalba/wanderbibliothek.git
cd wanderbibliothek

npm install
npm run dev        # http://localhost:3000
```

The SQLite database is created automatically on first startup. In development mode, it is populated with demo data.

For production deployments, you need at least `NEXT_PUBLIC_SITE_URL`, `APP_ENCRYPTION_KEY` and an email provider (`BREVO_API_KEY` + `MAIL_FROM`, or `MAIL_WEBHOOK_URL` for anything else). Without an encryption key, the application will not store secrets. The full guide is in [`deploy/README.md`](deploy/README.md).

Create an admin account using `ADMIN_EMAIL` and `ADMIN_PASSWORD`, or run `npm run admin:create`.

## Verifying a deployment

An instance can show what it runs instead of asking for trust:

- **`/api/version`** publishes the commit, image digest and build time, with links
  to the exact source. If the deployment does not know them, the fields are `null`
  rather than invented.
- **Signed releases.** Every `v*` tag is built into a GHCR image pinned by digest,
  with SLSA provenance and an SBOM, signed with cosign in keyless mode.
  `deploy/verify-release.sh` checks the signature against this repository.
- **Signed content.** `/api/transparency` publishes daily Ed25519-signed snapshots
  of the public catalogue (Merkle root + payload hash). Anyone can download the
  exact NDJSON and recompute it with `npm run transparency:verify -- --url …`;
  `--key-fingerprint` and `--pin` let an external witness fix the signing key and
  the Merkle root between checks.
  It contains only what is already public: never who owns a copy.

None of this proves by itself that the answering process is the signed image;
without hardware attestation (TPM 2.0 or a confidential VM), tampering is
**detectable**, not impossible. [`deploy/README.md`](deploy/README.md) explains
what each layer covers and what is deliberately left out.

## Documentation and contributing

The documentation is available both in the application at `/techdoc` and in the repository.

- [`DOCUMENTATION.md`](DOCUMENTATION.md) covers architecture, routes, the data model, security and operations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) explains the local environment, the checks a change has to pass, and the commit, migration and translation conventions.
- [`GOVERNANCE.md`](GOVERNANCE.md) says who decides what, how moderation and sanctions work, and how appeals are reviewed.
- [`deploy/README.md`](deploy/README.md) walks through production setup with systemd, nginx, TLS, backups and timers.

Project updates are posted on Mastodon at [@wanderbibliothek@mastodon.social](https://mastodon.social/@wanderbibliothek).

## License and credits

The code is under the **GNU Affero General Public License v3.0** (AGPL-3.0). It is copyleft: anyone who modifies it and offers it as a network service must also offer the corresponding source. The cover photograph and the typeface used on book covers keep their own licenses and are credited in [`NOTICE`](NOTICE).
