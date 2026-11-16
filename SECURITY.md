# Security policy

Wanderbibliothek handles accounts, sessions, personal data (city, biography,
email) and end-to-end encrypted messaging. Security bugs are treated as a
priority.

## Supported versions

The project ships as an application, not as a library: only the **latest version
of the `main` branch** gets security support. If you self-host a copy, update
before reporting.

## How to report a vulnerability

**Do not open a public issue.** Use the repository's **Security → Report a
vulnerability** tab (GitHub Security Advisories): it is private and does not
expose your email or the details of the bug.

Include, if you can:

- impact and exploitation scenario;
- steps to reproduce it (version or commit, relevant configuration);
- whether it affects other people's data or only the attacker's own.

Response commitment: acknowledgement within **72 hours** and a first assessment
within **7 days**. Once the bug is fixed the corresponding advisory will be
published and you will be credited if you want.

## Scope

These are considered vulnerabilities, among others:

- bypassing authentication, two-step verification or role authorisation (for
  example, moderating without being an administrator);
- reading or modifying another account's data (listings, requests,
  notifications, lists, clubs);
- breaking message encryption, leaking message content to the server or
  exposing private keys;
- XSS, CSRF, SQL injection, SSRF, open redirects;
- bypassing request limits or quotas;
- exposing secrets, session tokens or personal data in responses, logs or
  headers;
- privilege escalation in the deployment process.

**Out of scope**: brute force or spam with accounts of your own, volumetric
denial of service against a specific instance, social engineering, content
published by other people (use the report button) and automated scanner results
without demonstrated impact.

## Good practice for self-hosters

- Always serve over **HTTPS**: the session cookie is `__Host-` and the browser
  drops it over HTTP.
- Set `APP_ENCRYPTION_KEY`, `MAIL_WEBHOOK_URL`, `MAINTENANCE_TOKEN` and
  `TRUST_PROXY=1` before opening public registration (startup warns about what
  is missing).
- Enable two-step verification on the administration account.
- Keep backups encrypted and **off** the server.
- Do not publish the `.data/` directory or the contents of
  `/var/lib/wanderbibliothek`.
- Deploy by **digest**, not by tag, and verify the signature before starting:
  `./deploy/verify-release.sh` (needs `cosign`). `/api/version` shows the commit
  and the digest being served.
- Set `TRANSPARENCY_SIGNING_KEY` so the public catalogue snapshots are signed;
  without a key they are published with no cryptographic proof and
  `/api/transparency` says so.
