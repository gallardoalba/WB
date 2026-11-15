# Governance

Status: 2026-11-15. The same text is published by the application at `/normas`.

Wanderbibliothek is free software, and each instance is governed by its own community. This document separates what **the project** guarantees from what **each instance** decides. It also explains how moderation works and how a sanction can be appealed.

## Project and instance

- **The project** publishes the code under the MIT licence, maintains the documentation and publishes releases. It does not administer instances and does not decide their rules.
- **Each instance** decides its rules, whom it admits, how it organises moderation and who administers it. The software provides the mechanisms; the community gives them legitimacy.
- **The rules of conduct are public.** What an instance does not admit and which measure corresponds to each case must be visible before registering. This document describes the procedure; it does not replace those rules.
- **Minimum guarantees.** Rules alone are not enough. Even the smallest instance explains its moderation decisions and lets a suspension be appealed.

## Roles

| Role | Responsibilities | Limits |
| --- | --- | --- |
| Project maintenance | Reviews code, publishes releases, maintains documentation | Does not administer instances |
| Instance administration | Server, backups, team management, **account suspensions** | Cannot edit the code of other instances |
| Moderation | Reviews reports, hides content, documents actions, proposes suspensions | Does not apply suspensions or appoint the team |
| Community | Takes part in circles and lists, proposes changes, asks for reviews | — |

An administrator may also moderate, but moderation does not imply administration. In the application, `is_admin` and `is_moderator` are separate flags.

## Moderation

Moderation protects people. Discomfort or disagreement is not grounds for a sanction, and neither is a harsh review or an awkward conversation.

- **Proportionality.** Apply the least restrictive measure that solves the problem. Escalate only when a lesser measure has not worked: a correction first, then hiding the content, then a suspension. Serious or ongoing harm, such as threats, published personal data or sustained harassment, justifies acting immediately. Repeated conduct weighs in the decision, and the audit log keeps the record.
- **Who decides.** Moderation investigates and proposes; an administrator decides and applies a suspension. When one person holds both roles, the decision is taken under the administrator role and recorded as such.
- **What it contains.** The rule that was broken, the conduct behind it and how the case reached the team (a report or a proactive review), in the language of the account.
- **Time limit.** Suspensions last from 1 to 365 days and are lifted automatically when they expire. There is no indefinite suspension in the application.
- **Privacy.** The reporter is not named to the sanctioned person or in public; the team does need to know who it was in order to assess the case. Moderators do not read end-to-end encrypted messages; they act on what is reported.

## Sanctions and appeals

1. An administrator suspends an account with a reason and a duration.
2. The person receives an email in the language of their account with the reason, the end date and a personal appeal link valid for 30 days.
3. The appeal is submitted from `/apelar` without signing in, because a suspended account cannot log in, and may include any information the person considers relevant. If the link is lost or expires, a new one can be requested from the same page with the account email.
4. **Someone with no part in the original decision and no conflict of interest** reviews it, and the answer arrives within 14 days. Where the instance has nobody available, an external reviewer may do it and their name is recorded. The reviewer may lift the suspension or uphold it; the application does not allow shortening it.
5. If upheld, the account is reactivated and the person is notified. If rejected, the reply explains why. Both outcomes are recorded in the audit log.

One appeal may be open at a time per sanction; a rejection does not prevent a later one if the person obtains a new link. Resolved appeals are deleted after 730 days, enough to judge repeated conduct and to answer a later complaint; moderation actions are kept for `AUDIT_RETENTION_DAYS` (730 by default).

## Transparency

Moderation actions are written to an internal audit log that only the team can read. The application never edits it and prunes it according to `AUDIT_RETENTION_DAYS`. Each instance publishes an aggregate report at least once a year, without names or individual cases. It covers reports received and their outcome, measures applied, active suspensions, and appeals with their outcome and average response time. In a small community per-case detail would identify people, so the report stays at aggregate figures.

```bash
npm run informe:moderacion
```

## Continuity

An instance should not depend on a single person. The deployment guide recommends:

- at least two administrators, with `npm run admin:create` (and `npm run moderator:create` for moderation-only accounts);
- encrypted backups kept off the server, with a rehearsed restore (`npm run db:verify`);
- a documented handover for the domain, DNS, server provider, credentials, mail provider and backup keys;
- a documented closure procedure (tell the members, give them time to export their data, delete what the law does not require keeping).

## Changes to this document

The current version is published at `/normas` and in this file. Any change must be explained in the project's public history.
