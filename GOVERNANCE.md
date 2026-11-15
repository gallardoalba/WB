# Governance

Status: 2026-11-15. The same text is published by the application at `/normas`.

Wanderbibliothek is free software, and each instance is governed by its own community. This document separates what **the project** guarantees from what **each instance** decides. It also explains how moderation, sanctions and appeals work in the application.

## Project and instance

- **The project** publishes the code under the MIT licence, maintains the documentation and publishes releases. It does not administer instances and does not decide their rules.
- **Each instance** decides its rules, whom it admits, how it organises moderation and who administers it. The software provides the mechanisms; the community gives them legitimacy.
- **The rules of conduct are public.** What an instance does not admit and which measure corresponds to each case must be visible before registering. This document describes the procedure; it does not replace those rules.
- **Minimum guarantees.** Whatever its size or how it organises itself, an instance must publish its rules, explain every moderation decision and offer a way to appeal a suspension.

## Roles

| Role | Responsibilities | Limits |
| --- | --- | --- |
| Project maintenance | Reviews code, publishes releases, maintains documentation | Does not administer instances |
| Instance administration | Server, backups, team management, **account suspensions** | Cannot edit the code of other instances |
| Moderation | Reviews reports, hides content, documents actions and proposes suspensions | Does not suspend accounts or appoint the team |
| Community | Takes part in circles and lists, proposes changes, requests reviews | — |

An administrator may also moderate, but moderation does not imply administration. In the application, `is_admin` and `is_moderator` are separate flags.

## Moderation

Moderation protects people; it does not punish discomfort or disagreement. Criticism, a harsh review or an awkward conversation are not, by themselves, grounds for a sanction.

- **Proportionality.** Apply the least restrictive measure that solves the problem, escalating only when a lesser measure has not worked: a correction first, then hiding the content, then a suspension. Serious or ongoing harm — threats, publishing personal data, sustained harassment — justifies acting immediately. Repeated conduct weighs in the decision, and the audit log keeps the record.
- **Who decides.** Moderation investigates and proposes; an administrator decides and applies a suspension. When one person holds both roles, the decision is taken under the administrator role and recorded as such.
- **Notice.** The notice states which rule was broken, which conduct led to it and how the case reached the team — a report or a proactive review — in the language of the account.
- **Time limit.** Suspensions last from 1 to 365 days and are lifted automatically when they expire. There is no indefinite suspension in the application.
- **Privacy.** The reporter is not revealed to the sanctioned person or publicly; the team does need to know who reported in order to assess the report. Moderators do not read end-to-end encrypted messages; they act on what is reported.

## Sanctions and appeals

1. An administrator suspends an account with a reason and a duration.
2. The person receives an email in the language of their account with the reason, the end date and a personal appeal link valid for 30 days.
3. The appeal is submitted from `/apelar` without signing in — a suspended account cannot log in — and may include any information the person considers relevant.
4. **Another member of the team** reviews it, free of any involvement in the original decision and of conflicts of interest, and answers within 14 days. The reviewer may lift the suspension or uphold it; the application does not allow shortening it. An instance with a single moderator must arrange that review with another member of the team, another instance or a trusted third party, who receives only the information needed and is bound to confidentiality, before a member of the team records the outcome.
5. If upheld, the account is reactivated and the person is notified. If rejected, the reply explains why. Both outcomes are recorded in the audit log.

One appeal may be open at a time per sanction; a rejection does not prevent a later one if the person obtains a new link. Resolved appeals are deleted after 730 days — enough to judge repeated conduct and to answer a later complaint — and moderation actions are kept for `AUDIT_RETENTION_DAYS` (730 by default).

## Transparency

Moderation actions are written to an internal audit log. Only the team can read it, the application never edits it, and it is pruned according to `AUDIT_RETENTION_DAYS`. Each instance publishes an aggregate report at least once a year — reports received and their outcome, measures applied, active suspensions and appeals with their outcome and average response time — without names or individual cases. In a small community, per-case detail can identify people: the report stays aggregate.

```bash
npm run informe:moderacion
```

## Continuity

An instance should not depend on a single person. The deployment guide recommends:

- at least two administrators, with `npm run admin:create` (and `npm run moderator:create` for moderation-only accounts);
- encrypted backups kept off the server, with a rehearsed restore (`npm run db:verify`);
- a documented handover for the domain, DNS, server provider, credentials, mail provider and backup keys;
- a documented procedure for closing the instance: notice to its members, a window to export their data and deletion of what is not required by law.

## Changes to this document

The current version is published at `/normas` and in this file. Any change must be explained in the project's public history.
