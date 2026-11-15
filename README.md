# Wanderbibliothek

**Books travel, ideas connect people.**

Wanderbibliothek is a community project with no commercial purpose: a place to share the books that have shaped us most, so that they circulate again and knowledge grows between all of us. The interface is available in German, Spanish and English.

It is deliberately built as a counter-model to commercial marketplaces: nothing is sold and nobody is rewarded for being active.

## Why it exists

Some books we keep for what they mean and for the deep mark they left on us. Passing them on shares what one has learned with them and treats the library as a commons rather than a private collection.

Knowledge is not property each of us keeps, but a commons that grows when it circulates: a book in circulation produces readings, conversations and also disagreement. That is why the platform is meant for titles that matter, not for stock.

## What the platform does

- **Publishing books.** Put the books you have finished on the shelf in a couple of steps, with the condition they are in and where they are. The ISBN is optional: when you give one, the record is filled from Open Library, Google Books or the DNB (MARC21), classification included, and the lookup is cached on the server.
- **Swapping.** Request, acceptance, a hand-over agreed between the two of you and a confirmation from both sides, so nobody can close an exchange alone; afterwards each person can review the other. When it closes, the copy that travelled stays as a record and the person who received it gets a copy of their own, paused until they offer it.
- **No addresses.** The platform never asks for an address, a postcode or a delivery method.
- **Direct messages.** Each exchange opens a conversation encrypted end to end, and readers who follow each other can write privately.
- **Reading circles.** A current read, meetings in person or online, an attendance list, a vote on the next book and a forum only members can read.
- **Lists, directory, activity.** Public reading lists, a directory of readers you can sort by distance, and a stream of what is happening nearby.
- **Self-hosted.** One small server with SQLite is enough. Mail and the Mastodon bot are optional; city lookups (Photon and Nominatim) also run on the server, so the browser never talks to them.

## Principles

**Reciprocity.** Sharing does not mean expecting something in return. Anyone can ask for any book and whoever has it decides freely whether to give it away or swap it. Every contribution helps keep books in circulation and knowledge reaching more people; there is no currency, no balance and no points.

**Non-profit and no market.** The project charges nothing, shows no advertising and sells no data. There is no premium tier and no paid placement: everything the platform offers is available to every account.

**Books as commons.** The platform manages hand-overs, not property: giving a copy away does not lose it, it puts it into circulation.

**Self-organisation.** Communities and reading circles decide for themselves what to read, when to meet and how to organise, without a central management.

**Transparency.** The source is open and the documentation is public, so what happens to your data can be checked rather than taken on trust. The instance serving the site runs exactly this code, with nothing added.

**Privacy.** Signing up asks for a name, a city and an email address; the password is stored only as a hash and the biography is optional. There is no third-party analytics and no tracking pixels: the project's own counters stay in the database and expire after 180 days. Your data can be exported as JSON and the account deleted entirely.

**Autonomy.** No dependency on a platform, a corporate account or a payment provider. Anyone who wants to can run their own instance.

None of these decisions is neutral. The platform is built so that knowledge circulates as a commons and so that the people who use it decide for themselves, not so that value is extracted from them.

## How it is built

The visible part is the smaller half. What defines the platform is what it does not do with other people's data.

- **The public catalogue carries no names.** The work pages that search engines index carry the book and figures per city; who offers the copy does not appear.
- **The server cannot read private messages.** The private key stays in the browser and the server only relays opaque envelopes, one per device. Account secrets such as the second factor are encrypted with a key that is not in the database.
- **Accessibility.** Sufficient contrast, visible focus, generous touch targets, keyboard operation and screen-reader labels, also when less motion is asked for.
- **Backups and continuity.** Encrypted backups every six hours and a rehearsed restore: the service can be rebuilt from scratch with the backup and the code.

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

The same documentation is in the application, at `/techdoc`, and in the repository. The project page at [wanderbibliothek.org/projekt](https://wanderbibliothek.org/projekt) explains what it is, why it exists and which decisions stand behind how it is built.

- [`DOCUMENTATION.md`](DOCUMENTATION.md): architecture, routes, data model, security and operations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): local environment, the checks a change has to pass, commit, migration and translation conventions.
- [`deploy/README.md`](deploy/README.md): production setup with systemd, nginx, TLS, backups and timers.

New works are announced on Mastodon at [@wanderbibliothek@mastodon.social](https://mastodon.social/@wanderbibliothek).

Bug reports, suggestions and pull requests are welcome.

Lint, type checking, 755 unit and integration tests (95 files), 53 browser tests, a production build and an image build run on every push in CI; `npm audit --omit=dev` currently reports no open issues.

## Security

Please report vulnerabilities through **Security → Report a vulnerability** in the repository (GitHub's private advisory, not a public issue). Scope, response times and self-hosting notes are in [`SECURITY.md`](SECURITY.md).

## License and credits

The code is released under the **MIT license**. Third-party material (the cover photograph, the typeface used on covers) keeps its own license and is credited in [`NOTICE`](NOTICE).
