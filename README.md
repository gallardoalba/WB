# Wanderbibliothek

**Books travel, ideas connect people.**

Wanderbibliothek is a community platform for sharing printed books. You put the books you have read back into circulation, and readers nearby can find them and ask for them; the two of you then agree on the hand-over.

It is deliberately built as the opposite of a commercial marketplace: nothing is sold and nobody is rewarded for being active.

## What the platform does

- **Publishing books.** Add a copy with its condition and city. The ISBN is optional: when you give one, the bibliographic record fills itself in.
- **Swapping.** Request, acceptance, a hand-over agreed between the two of you and a confirmation from both sides, so nobody can close an exchange alone; afterwards each person can review the other. When it closes, the copy that travelled stays as a record and the person who received it gets a copy of their own, paused until they offer it.
- **No addresses.** The platform never asks for an address, a postcode or a delivery method.
- **Direct messages.** Each exchange opens a conversation encrypted end to end, and readers who follow each other can write privately. The server stores sealed envelopes it cannot open.
- **Reading circles.** A current read, meetings in person or online, an attendance list, a vote on the next book and a forum only members can read.
- **Lists, directory, activity.** Public reading lists, a directory of readers you can sort by distance, and a stream of what is happening nearby.
- **Self-hosted.** One small server with SQLite is enough. Mail and the Mastodon bot are optional; catalogue lookups (Open Library, Google Books, the DNB, Nominatim for cities) run on the server and are cached on disk, so the browser never talks to them.

## Principles

**Reciprocity.** Whoever gives a book away makes room for another one. It is not a one-to-one swap: anyone can ask for any copy and whoever owns it decides, so what one person gives today another person receives tomorrow. There is no currency, no balance and no points.

**Free of charge.** No fees, no premium tier, no advertising and no data sold.

**Books as commons.** A book that has been read is not dead stock; it wants to be passed on. The platform manages hand-overs rather than property: giving a copy away does not lose it, it puts it into circulation.

**Self-organisation.** What a reading circle reads, when it meets and who joins is decided by the reading circle, not by a head office.

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

## Android app

A native client (Kotlin + Jetpack Compose) lives in [`android/`](android/README.md). It talks to the same REST API, uses the same end-to-end encryption for exchange messages and can point at any server from its settings.

```bash
cd android
./gradlew :app:assembleDebug
```

## Documentation and contributing

The same documentation is in the application, at `/documentacion`, and in the repository:

- [`DOCUMENTATION.md`](DOCUMENTATION.md): architecture, routes, data model, security and operations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): local environment, the checks a change has to pass, commit, migration and translation conventions.
- [`deploy/README.md`](deploy/README.md): production setup with systemd, nginx, TLS, backups and timers.

Bug reports, suggestions and pull requests are welcome.

Lint, type checking, more than 700 automated tests, browser tests, a production build and an image build run on every push in CI; `npm audit --omit=dev` currently reports no open issues.

## Security

Please report vulnerabilities through **Security → Report a vulnerability** in the repository (GitHub's private advisory, not a public issue). Scope, response times and self-hosting notes are in [`SECURITY.md`](SECURITY.md).

## License and credits

The code is released under the **MIT license**. Third-party material (the cover photograph, the typeface used on covers) keeps its own license and is credited in [`NOTICE`](NOTICE).
