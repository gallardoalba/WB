# Governance

Status: 2026-11-15. The same text is published by the application at `/normas`.

Wanderbibliothek is free software, and each instance is governed by its own community. This document separates what **the project** guarantees from what **each instance** decides. It also explains how moderation, sanctions and appeals work in the application.

## Project and instance

- **The project** publishes the code under the MIT licence, maintains the documentation and publishes releases. It does not administer instances and does not decide their rules.
- **Each instance** decides its rules, whom it admits, how it organises moderation and who administers it. The software provides the mechanisms; the community gives them legitimacy.

## Roles

| Role | Responsibilities | Limits |
| --- | --- | --- |
| Project maintenance | Reviews code, publishes releases, maintains documentation | Does not administer instances |
| Instance administration | Server, backups, team management, **account suspensions** | Cannot edit the code of other instances |
| Moderation | Reviews reports, hides content, documents actions | Does not suspend accounts or appoint the team |
| Community | Takes part in circles and lists, proposes changes, requests reviews | — |

An administrator may also moderate, but moderation does not imply administration. In the application, `is_admin` and `is_moderator` are separate flags.

## Moderation

Moderation protects people; it does not punish discomfort or disagreement. Criticism, a harsh review or an awkward conversation are not, by themselves, grounds for a sanction.

- **Proportionality.** Apply the least restrictive measure that solves the problem: hiding content before suspending an account.
- **Reason.** Every sanction states which rule was broken and which conduct led to it. The affected person receives it by email.
- **Time limit.** Suspensions last from 1 to 365 days and are lifted automatically when they expire. There is no indefinite suspension in the application.
- **Privacy.** The reporter is never revealed. Moderators do not read end-to-end encrypted messages; they act on what is reported.

## Sanctions and appeals

1. An administrator suspends an account with a reason and a duration.
2. The person receives an email with the reason, the end date and a personal appeal link valid for 30 days.
3. The appeal is submitted from `/apelar` without signing in: a suspended account cannot log in.
4. **Another member of the team** reviews it. The person who imposed the sanction cannot review their own decision.
5. If upheld, the account is reactivated and the person is notified. If rejected, the reply explains why. Both outcomes are recorded in the audit log.

One open appeal is allowed per sanction. Resolved appeals and moderation actions are retained according to `AUDIT_RETENTION_DAYS` (730 days by default).

## Transparency

Moderation actions are written to an internal audit log. Each instance may publish aggregate reports — reports received, measures applied, appeals and response times — without names or individual cases:

```bash
npm run informe:moderacion
```

## Continuity

An instance should not depend on a single person. The deployment guide recommends:

- at least two administrators, with `npm run admin:create` (and `npm run moderator:create` for moderation-only accounts);
- encrypted backups kept off the server, with a rehearsed restore (`npm run db:verify`);
- a documented handover for the domain, DNS, server provider, credentials, mail provider and backup keys.

## Changes to this document

The current version is published at `/normas` and in this file. Any change must be explained in the project's public history.
