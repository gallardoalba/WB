# Wanderbibliothek

**Books travel, ideas connect people.**

Wanderbibliothek is a community platform for sharing printed books. You put the books you have read back into circulation, and readers nearby can find them and ask for them; the two of you then agree on the hand-over.

It is deliberately built as a counter-model to commercial marketplaces: nothing is sold and nobody is rewarded for being active.

## What the platform does

- **Publishing books.** Put the books you have finished on the shelf in a couple of steps, with the condition they are in and where they are. The ISBN is optional: when you give one, the bibliographic record fills itself in.
- **Swapping.** Request, acceptance, a hand-over agreed between the two of you and a confirmation from both sides, so nobody can close an exchange alone; afterwards each person can review the other. When it closes, the copy that travelled stays as a record and the person who received it gets a copy of their own, paused until they offer it.
- **No addresses.** The platform never asks for an address, a postcode or a delivery method.
- **Direct messages.** Each exchange opens a conversation encrypted end to end, and readers who follow each other can write privately. The server stores sealed envelopes it cannot open.
- **Reading circles.** A current read, meetings in person or online, an attendance list, a vote on the next book and a forum only members can read.
- **Lists, directory, activity.** Public reading lists, a directory of readers you can sort by distance, and a stream of what is happening nearby.
- **Self-hosted.** One small server with SQLite is enough. Mail and the Mastodon bot are optional; catalogue and place lookups (Open Library, Google Books, the DNB, Photon and Nominatim for cities) run on the server and are cached on disk, so the browser never talks to them.

## Principles

**Reciprocity.** Sharing does not mean expecting something in return. Anyone can ask for any book and whoever has it decides freely whether to give it away or swap it. There are no equivalents and no individual debts: every contribution helps keep books in circulation and knowledge reaching more people. There is no currency, no balance and no points.

**Free of charge.** No fees, no premium tier, no advertising and no data sold.

**Books as commons.** A book that has been read is not an object to be kept; it is something that can keep circulating. The platform manages hand-overs, not property: giving a copy away does not lose it, it puts it into circulation.

**Self-organisation.** Communities and reading circles decide for themselves what to read, when to meet and how to organise, without a central management.

**Transparency.** The source is open and the documentation is public, so what happens to your data can be checked rather than taken on trust.

**Privacy.** No analytics and no tracking. Your data can be exported as JSON and deleted completely.

**Autonomy.** No dependency on a platform, a corporate account or a payment provider. Anyone who wants to can run their own instance.

## Run it yourself

Requires Node.js 22 or newer.

```bash
git clone https://github.com/gallardoalba/wanderbibliothek.git
cd wanderbibliothek

npm install
npm run dev        # http://localhost:3000
```

The SQLite database creates itself on first start, with demo data in development. For a real deployment you need at least `NEXT_PUBLIC_SITE_URL`, `APP_ENCRYPTION_KEY` and a mail provider (`BREVO_API_KEY` + `MAIL_FROM`, or `MAIL_WEBHOOK_URL` for anything else); without an encryption key no secret is ever stored. The full guide is in [`deploy/README.md`](deploy/README.md).

An admin account is created with `ADMIN_EMAIL`/`ADMIN_PASSWORD` or with `npm run admin:create`.

## Documentation and contributing

The same documentation is in the application, at `/techdoc`, and in the repository:

- [`DOCUMENTATION.md`](DOCUMENTATION.md): architecture, routes, data model, security and operations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): local environment, the checks a change has to pass, commit, migration and translation conventions.
- [`deploy/README.md`](deploy/README.md): production setup with systemd, nginx, TLS, backups and timers.

New works are announced on Mastodon at [@wanderbibliothek@mastodon.social](https://mastodon.social/@wanderbibliothek).

Bug reports, suggestions and pull requests are welcome.

Lint, type checking, 751 unit and integration tests (95 files), 53 browser tests, a production build and an image build run on every push in CI; `npm audit --omit=dev` currently reports no open issues.

## Security

Please report vulnerabilities through **Security → Report a vulnerability** in the repository (GitHub's private advisory, not a public issue). Scope, response times and self-hosting notes are in [`SECURITY.md`](SECURITY.md).

## License and credits

The code is released under the **MIT license**. Third-party material (the cover photograph, the typeface used on covers) keeps its own license and is credited in [`NOTICE`](NOTICE).
