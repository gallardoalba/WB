# Wanderbibliothek

**Books travel, ideas connect people.**

Wanderbibliothek is a community project with no commercial purpose: a space to share the books that have shaped us and give them new readers.

Nothing is sold, and no one is rewarded for taking part.

## Why it exists

Some books stay with us. Passing one on shares what it gave us and keeps the library in common hands.

Knowledge grows when books circulate. Every copy passed on brings readings, conversations and disagreements. The platform is built around books people care about.

## What you can do

- **Share books.** List a book you'd like to pass on, including its condition and city. Entering an ISBN automatically retrieves its bibliographic details from Open Library, Google Books or the German National Library (DNB).
- **Exchange books.** Every exchange follows a simple, mutual process: one reader requests a book, the owner accepts, and both confirm the handover. Neither side can complete an exchange on their own. Once it's done, both readers can leave each other feedback. The book that has changed hands remains in the platform's history, while the recipient's own copy is temporarily paused.
- **No addresses, no shipping.** The platform never asks for postal addresses, postcodes or delivery details. Books are exchanged directly between readers.
- **Private messages.** Every exchange comes with an end-to-end encrypted conversation. Readers who follow each other can also send private messages.
- **Reading circles.** Start or join a reading circle, share what you're currently reading, organise in-person or online meetings, keep track of who's attending, vote on the next book and take part in a members-only discussion forum.
- **Lists and nearby readers.** Start public reading lists and browse a directory of readers by distance. Your home page shows what is happening around you.
- **Self-hosted and lightweight.** The entire platform can run on a single small server using SQLite. Book catalogue and location lookups are handled server-side and cached locally, so the browser never connects directly to external services.

## Principles

**Reciprocity.** Nobody has to give something back. Anyone can request any book, and whoever has it is free to give it away or exchange it. Every contribution helps keep books in circulation and knowledge within reach of more people; there is no currency, no balance and no points.

**Non-profit and no market.** The project charges nothing and shows no advertising. It does not sell data. There is no premium tier and no paid placement: everything the platform offers is available to every account.

**Books as commons.** Once you have read a book, it can travel on to someone else. The platform handles handovers, not ownership: passing a copy on does not lose it, it puts it back into circulation.

**Self-organisation.** Communities and reading circles decide for themselves what to read and when to meet. Nobody manages them from above.

**Transparency.** The source code is open and the documentation is public, so what happens to your data can be checked rather than taken on trust. The instance serving the site runs exactly this code, with nothing added.

**Privacy.** Signing up asks for a name, a city and an email address; the password is stored only as a hash and the biography is optional. There is no third-party analytics and no tracking pixels: the project's own counters stay in the database and expire after 180 days. You can export your data as JSON or delete the account permanently.

**Autonomy.** No dependence on a corporate platform or a payment provider. Anyone can run their own instance.

None of these decisions is neutral. The platform is built so that knowledge circulates as a commons and so that the people who use it decide for themselves, not so that value is extracted from them.

## Run it yourself

Requires Node.js 22 or newer.

```bash
git clone https://github.com/gallardoalba/wanderbibliothek.git
cd wanderbibliothek

npm install
npm run dev        # http://localhost:3000
```

The SQLite database is created automatically on first startup. In development mode, it is populated with demo data.

For production deployments, you need at least `NEXT_PUBLIC_SITE_URL`, `APP_ENCRYPTION_KEY` and an email provider (`BREVO_API_KEY` + `MAIL_FROM`, or `MAIL_WEBHOOK_URL` for anything else). Without an encryption key, the application will not store secrets. The full guide is in [`deploy/README.md`](deploy/README.md).

Create an admin account using `ADMIN_EMAIL` and `ADMIN_PASSWORD`, or run `npm run admin:create`.

## Documentation and contributing

The documentation is available both in the application at `/techdoc` and in the repository. The project page at [wanderbibliothek.org/projekt](https://wanderbibliothek.org/projekt) explains what it is and why it exists.

- [`DOCUMENTATION.md`](DOCUMENTATION.md) covers architecture, routes, the data model, security and operations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) explains the local environment, the checks a change has to pass, and the commit, migration and translation conventions.
- [`GOVERNANCE.md`](GOVERNANCE.md) says who decides what, how moderation and sanctions work, and how appeals are reviewed.
- [`deploy/README.md`](deploy/README.md) walks through production setup with systemd, nginx, TLS, backups and timers.

Project updates are posted on Mastodon at [@wanderbibliothek@mastodon.social](https://mastodon.social/@wanderbibliothek).

## License and credits

The code is under the **MIT License**. The cover photograph and the typeface used on book covers keep their own licenses and are credited in [`NOTICE`](NOTICE).
