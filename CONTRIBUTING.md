# Contributing

Thanks for your interest. This document sums up what a change needs so that it
can be reviewed and merged quickly.

## Environment

- Node.js **22** (there is a `.nvmrc`).
- `npm ci` (includes devDependencies: the build needs TypeScript and Tailwind).
- `npm run dev` starts at `http://localhost:3000` with **demo data** (accounts
  `@wanderbibliothek.test`, password `demo1234`). To skip seeding them,
  `SEED_DEMO=0 npm run dev`.

## Before opening a pull request

All of this has to pass; CI runs the same:

```bash
npm run typecheck   # next typegen + tsc
npm run lint
npm test            # 863 unit and integration tests (110 files)
npm run build
npm run test:e2e    # Playwright: 54 cases in 9 files (Chromium); first time:
                    # npx playwright install chromium
npm run test:e2e:smoke  # WebCrypto/IndexedDB en Firefox y WebKit
                    # npx playwright install firefox webkit
```

`npm run test:e2e` starts its own server on `localhost:3100`. If you already have
`npm run dev` running, use `PLAYWRIGHT_BASE_URL=http://localhost:3000
npm run test:e2e` (Next does not allow two development instances in the same
directory).

## Project conventions

- **Commits** in Spanish, with a first line that says *what* changes and a short
  body with the *why* and the validation you ran. Example:

  ```
  Avisa al aceptar si el ejemplar ya no está disponible

  El servidor lo comprobaba, pero la interfaz seguía mostrando «Aceptar»
  hasta que llegaba el 409.

  Validado: tsc, eslint, 863 pruebas unitarias y de integración (110 ficheros),
  build y 54/54 E2E (Chromium) y el humo en Firefox/WebKit.
  ```

- **UI language**: strings are written in Spanish, and the German and English
  dictionaries in `src/lib/i18n.ts` use that text as the key. The language is
  decided by the selector cookie and, without it, by the browser
  (`Accept-Language`); `DEFAULT_LOCALE` (`src/lib/locale.ts`, German) is the last
  resort. `tests/i18n.test.ts` fails if a string used with `t()` has no German
  translation or if English does not cover the same keys: always add the German
  and English entries. If the text depends on a label map, type the map with
  `MessageKey` (`satisfies Record<…, MessageKey>`) so the compiler catches it.
- **Database**: any schema change is a new migration in
  `src/lib/db/migrations.ts` (`SCHEMA_VERSION` + `migrateToVNN`) plus a test that
  exercises it. A migration that has already been published is never edited.
- **Dates**: do not read the clock during render; use SQLite's
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')` (Next treats `Date.now()` as an unstable
  value when prerendering).
- **Secure by default**: every mutation in `src/app/api` goes through `guard()`
  (origin + quota) or justifies its exception; `tests/route.test.ts` checks it.
  The body is read with `readJson()` (requires `application/json` and cuts at
  64 KB) and errors are returned with `handleApiError()`.
- **Styles**: tokens from `src/app/styles/tokens.css`; no literal colours in
  components, because dark mode shares the same markup.
- **Accessibility**: new controls must be operable with the keyboard and have an
  accessible name; there are keyboard tests in `e2e/app.spec.ts`.

## What not to include in a PR

- Files under `.data/`, databases, backups, real `.env` files, screenshots with
  personal data, or tokens.
- Dependency changes without a reason (CI audits with `npm audit --omit=dev`).
- Removing the `overrides` block from `package.json` without checking first: it
  pins a single `minimatch` (the one under
  `@typescript-eslint/typescript-estree`) to the fixed version, and that is what
  keeps `npm audit` at zero without dropping below Next 16. It can go once
  `typescript-eslint` depends on a fixed `minimatch`.
- Broad refactors mixed with functional fixes: smaller PRs are better.

## Deployment

Not needed to contribute; if you are interested, the guide is in
[`deploy/README.md`](deploy/README.md) (systemd + nginx) and the `Dockerfile`.
