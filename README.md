# Wanderbibliothek

**Books that keep travelling.**

Wanderbibliothek brings together people who don't want the books they have read to gather dust on a shelf. Publish a book and it becomes findable for readers nearby; look for one and you ask for it, and the two of you agree on the hand-over.

The platform is deliberately built as a counter-model to commercial marketplaces: it sells nothing, runs no ads, tracks nobody and rewards nobody for being active. It assumes that people share when it is made easy for them and they are not distrusted, and that a community can negotiate its own rules.

## What the platform does

- **Publishing books.** Put the books you have finished on the shelf in a couple of steps, with the condition they are in and where they are. Readers nearby find them and can ask for them.
- **Swapping.** Request, acceptance, hand-over, a confirmation from both sides with a six-digit code, then a review. Each side confirms separately, so nobody can close an exchange on their own.
- **Shipping without revealing the address.** Every shipping field is stored encrypted and readable only by the two people in the exchange.
- **Talking without being overheard.** Each exchange opens a conversation that is encrypted end to end, and readers who follow each other can write privately; the server stores sealed envelopes it cannot open.
- **Reading circles.** Organised by city, with a current read, meetings, an attendance list, a vote on the next book and a forum only members can read.
- **Lists, directory, activity.** Reading lists as public curation, a directory of readers sorted by distance, and a stream of what is happening around you.
- **Self-hosted.** One instance runs on a small server with SQLite, without third-party services.

## Principles

**Reciprocity.** Whoever gives a book away gets one back. There is no currency, no balance and no points pushing anyone to trade more, only the expectation that you give too.

**Free of charge.** No fees, no premium tier, no advertising, no handing data to third parties. What the platform does not cost it does not need to earn, and what it does not earn it cannot sell.

**Books as commons.** A book that has been read is not dead stock; it is something that wants to be passed on. So the platform manages hand-overs rather than property: giving a copy away does not lose it, it puts it into circulation.

**Self-organisation.** What a reading circle reads, when it meets and who joins is decided by the reading circle, not by a head office. Moderation is reversible and traceable too: what has been taken down can be restored, and every decision leaves a trail.

**Transparency.** The source is open and the rules sit where they apply. If you want to know what happens to your data, you can read it up instead of taking it on trust.

**Privacy.** No advertising or analytics services, no profiles for third parties. Messages between two people are end-to-end encrypted, shipping data is encrypted, and all your own data can be exported as JSON and deleted completely.

**Autonomy.** No dependency on a platform, a corporate account or a payment provider: one server, one database file, one system service. Anyone who wants to can run their own instance.

## Run it yourself

Requires Node.js 22 or newer.

```bash
git clone https://github.com/gallardoalba/wanderbibliothek.git
cd wanderbibliothek

npm install
npm run dev        # http://localhost:3000
```

The SQLite database creates itself on first start, with demo data in development. For a real deployment you need at least `NEXT_PUBLIC_SITE_URL`, `APP_ENCRYPTION_KEY` and `MAIL_WEBHOOK_URL`; without an encryption key no secret is ever stored. The full guide with systemd, nginx, TLS, backups and timers is in [`deploy/README.md`](deploy/README.md).

An admin account is created with `ADMIN_EMAIL`/`ADMIN_PASSWORD` or with `npm run admin:create`.

## Technical documentation

Architecture, routes, data model, security, environment variables and operations have moved out of this README:

- **Inside the application** at `/documentacion` – the same page the instance serves, readable without an account.
- **In the repository**: [`CONTRIBUTING.md`](CONTRIBUTING.md) (environment, quality commands, commit conventions, migration rules), [`deploy/README.md`](deploy/README.md) (operations) and [`SECURITY.md`](SECURITY.md) (how to report a vulnerability).

Lint, type checking, more than 320 automated tests, browser tests, a production build and an image build run on every push in CI; `npm audit --omit=dev` currently reports no open issues.

## Contributing

Bug reports, suggestions and pull requests are welcome. A look at [`CONTRIBUTING.md`](CONTRIBUTING.md) first is worthwhile: it lists the commands a change has to pass and the rule that new strings always arrive in both languages.

## Security

Please report vulnerabilities through **Security → Report a vulnerability** in the repository (GitHub's private advisory, not a public issue). Scope, response times and self-hosting notes are in [`SECURITY.md`](SECURITY.md).

## License and credits

The code is released under the **MIT license** – see [`LICENSE`](LICENSE).

Third-party material (the cover photograph, the typeface used on covers) keeps its own license and is credited in [`NOTICE`](NOTICE).
