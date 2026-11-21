# End-to-end encryption v2: protocol, threat model and migration

Status: **draft, being implemented**. Protocol version `wanderbibliothek:v2`.
v1 ([`e2e-protocol.md`](./e2e-protocol.md)) stays in service for existing
threads until the migration finishes.

## 0. Why v2 exists

v1 encrypts with a static ECDH key derived per conversation. The server cannot
read the text, but:

- a seized device plus the stored envelopes decrypts the whole history (no
  forward secrecy);
- the server can fabricate a message attributed to anyone (the AAD binds a
  sender id the server can write);
- anyone who talks to you is visible to the server, with times and volumes.

That is acceptable for a book club. It is not acceptable for a movement: the
adversary is assumed to have legal power over the operator, technical ability
to compromise it, and physical access to devices.

**v2 changes the model, not just the algorithms.** The ratchet is not written
here: it is [libolm](https://gitlab.matrix.org/matrix-org/olm) (Audited,
Apache-2.0, WASM), the same Double Ratchet implementation Matrix used for
years. This repository contributes the protocol binding, key publication,
envelopes, storage and tests — not a new cipher.

## 1. Goals and non-goals

Goals:

1. Forward secrecy: a device compromised today does not read yesterday.
2. Post-compromise security: after a fresh DH ratchet, the session heals.
3. Sender authentication inside the session: only the two participants hold the
   ratchet keys, so a forged envelope fails the MAC even if the server writes
   the sender id. No public per-message signatures, so deniability survives.
4. Identity per **device**, not per platform slot.
5. Key distribution that a server cannot silently rewrite undetected (see §7).
6. Club content encrypted end to end, with moderation by disclosure (§8).

Non-goals, stated so nobody assumes them:

- Anonymity and unlinkability. The server still sees who talks to whom.
- Protection against a malicious **client build**. §9 explains the limit.
- Post-quantum confidentiality. It is planned as a later revision; v2 does not
  claim it.

## 2. Identity and devices

| Concept | Value |
|---|---|
| Device identity | libolm `Account` (Curve25519 identity key + Ed25519 signing key) |
| Device id | Random 16-byte base64url, generated on the device |
| Account ↔ device | `device_keys(user_id, device_id)` — one row per device |
| Private material | IndexedDB, never exported, never sent |
| Server knows | device id, public identity key, one-time public keys |

A user can have several devices. Adding one no longer replaces another: each
device has its own session and its own key. **Losing a device loses that
device's history**, not the account's.

Devices are published with:

- `identity_key` (Curve25519, base64);
- `signing_key` (Ed25519, base64);
- up to 20 one-time keys (`key_id` + `key`, Curve25519).

Removing a device marks it revoked and drops its one-time keys; peers see it
in the key-transparency history (§7).

## 3. Session establishment

libolm's outbound session is a Triple-DH over the initiator's identity key, the
initiator's ephemeral key and one of the responder's one-time keys. The first
message is a *pre-key message*: it carries what the responder needs to build the
session.

1. Initiator fetches the peer device bundle (`GET /api/users/:id/devices`).
2. Initiator claims one one-time key (`POST …/devices/:deviceId/claim`). The
   server deletes the key inside the same transaction: **a one-time key is
   handed out at most once**.
3. Initiator builds the outbound session and sends a pre-key message.
4. Responder builds the inbound session from the pre-key message, removes the
   used one-time key from its account, and replies with normal messages.

If no one-time key is left, the claim returns `409` and the client waits for the
peer to publish more; there is no fallback to an unauthenticated handshake.

## 4. Envelopes

```
type: 0 | 1            # pre-key message | normal message
body: base64           # libolm ciphertext (includes its own MAC and header)
senderDeviceId: string # device that produced it
senderKey: string      # libolm Ed25519 key of that device, base64
conversation: string   # "request:<id>" | "dm:<threadId>" | "club:<clubId>"
```

The server stores `{senderDeviceId, senderKey, type, body, conversation}` per
recipient device and validates shapes and sizes. It cannot open the body.

Binding to the conversation is done twice: libolm authenticates its own
session, and the server refuses to move a stored envelope to another
`conversation` column. A message replayed to another thread does not decrypt
because the session does not exist there.

## 5. Replay, order and deletion

- libolm rejects a message key that was already used (replay).
- Out-of-order messages are kept as skipped keys, capped per session; beyond
  the cap the oldest are dropped and those messages are unrecoverable by
  design.
- After decryption the message key is deleted by libolm. The client stores only
  cleartext locally, in memory for the open thread; it does not keep the cipher
  state decades longer than needed.
- A session is forgotten (`session.free()`) when the conversation closes and the
  user leaves it; reopening starts a new session.

## 6. What the server can still do (and what stops it)

| Attack | v2 answer | Residual |
|---|---|---|
| Read message bodies | No: ratchet keys never leave devices | — |
| Forge a message as another user | Fails the session MAC | Compromised **sender device** can still forge its own messages |
| Substitute a device identity key | Detected by key transparency (§7) and safety numbers | Needs the peer to check |
| Replay an envelope | Rejected by the ratchet | — |
| Drop or delay messages | Not prevented | Visible as gaps |
| Learn who talks to whom | Not prevented | §10 |

## 7. Key transparency

v1's catalogue snapshots are **not** a key directory. Since 1.0.26 there is a
separate signed snapshot of the device directory
(`/api/transparency/keys`), a Merkle root, a hash chain, and per-account
inclusion proofs (`/api/account/keys/proof`). v2 extends it with:

- device identity keys and revocations in the committed set;
- **consistency proofs** between consecutive roots, so a server cannot present
  two histories;
- an external witness that pins roots (the verifier already pins catalogue
  roots; it will pin key roots too);
- verification in the client before trusting a new device.

## 8. Clubs and moderation

All club content is encrypted with **pairwise v2 sessions fanned out to each
member device** (one envelope per device). This is not MLS: membership changes
cost one session per pair, and a removed member keeps what they already
received. MLS is the target for large clubs; the fan-out ships first because it
reuses the audited ratchet instead of introducing a second group protocol.

Moderation without reading:

- The moderator sees that a report exists and who filed it, not the text.
- The reporter may **disclose** a message: the client re-encrypts the chosen
  excerpt to the moderator's device and records the disclosure in the audit
  log. Disclosure is explicit and attributable.
- Moderators cannot decrypt anything else. A club whose rules require reading
  everything cannot be E2EE; that is a product decision, not a technical gap.

## 9. Client trust

Anything the server serves runs with the user's keys. Mitigations: strict CSP
with nonces, no third-party scripts, signed releases with SBOM and provenance,
and — the real fix — reproducible builds plus a native client later. Until a
user can verify the build they run, v2 protects against a passive or database-
level adversary, not against an operator who ships malicious JavaScript. This is
documented in `/techdoc` and must not be sold otherwise.

## 10. Metadata

v2 does not hide who talks to whom. Concrete reductions, in order:

1. Retention: closed exchanges keep envelopes for a bounded period; the cron
   purges the rest.
2. Message size: already padded to 256-byte blocks in v1.0.26.
3. Opaque conversation ids: `request:` and `dm:` ids are already random; club
   fan-out uses random per-club ids.
4. Sealed sender, batching and delay: evaluated later; each costs latency and
   abuse control.

## 11. Migration

1. Clients publish a device bundle on first use; v1 `user_keys` rows become a
   read-only `web` device for existing accounts.
2. A thread uses v2 as soon as both devices have a session; otherwise it stays
   on v1. Both formats coexist; the server stores and returns either.
3. A message is never re-encrypted in place: rewriting ciphertext would break
   the ratchet.
4. v1 is removed once no thread has produced a v1 envelope in 90 days; the
   removal is a separate release with its own note.

## 12. Acceptance tests

Required before calling v2 done:

- handshake between two devices, including the one-time key being consumed once;
- replay rejected; out-of-order accepted within the cap; beyond the cap
  rejected with a clear error;
- tampered body fails; body moved to another conversation fails;
- a fresh device cannot read a session it was not part of;
- after `forget`, messages cannot be decrypted with the old state;
- the server never stores plaintext or private keys (schema assertion);
- key-transparency consistency proof detects a rewritten history;
- client verification of a peer's device key against the committed root.

## 13. Where the implementation stands

Shipped in this release:

| Piece | Where | Tested in |
|---|---|---|
| libolm wrapper: account, pre-key session, encrypt/decrypt, pickle | `src/lib/e2e-v2.ts` | `tests/e2e-v2.test.ts` |
| Device registry, one-time keys handed out once, revocation | `src/lib/repo/devices.ts`, migration v65 | `tests/devices.test.ts` |
| `PUT/DELETE /api/account/devices/:deviceId`, `GET /api/users/:id/devices`, `POST …/devices/:deviceId/claim` | `src/app/api/**/devices*` | wrapper, quota and origin in `tests/route.test.ts`; the repository behind them in `tests/devices.test.ts` |

Not implemented yet, and therefore **not** claimed by the documentation:
sending and receiving v2 envelopes from the interface, dual-read on the client,
club fan-out (§8), and the consistency proof the client checks in §7. Until
those ship, the interface keeps using v1 and the residual risks of §6 that
depend on the ratchet (forward secrecy, sender authentication) are **not** in
place in production.

## 14. Change control

`wanderbibliothek:v2`, the envelope fields and the `conversation` strings are
part of the protocol. Changing them requires a new version, dual-read in both
clients, and an entry here.
