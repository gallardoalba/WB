# End-to-end encryption v2: protocol, threat model and migration

Status: **server side implemented, client side pending** (§14). Protocol version
`wanderbibliothek:v2`. v1 ([`e2e-protocol.md`](./e2e-protocol.md)) stays in
service until the client ships; this document says in every section what exists
and what does not.

## 0. Why v2 exists

v1 encrypts with a static ECDH key derived per conversation. The server cannot
read the text, but:

- a seized device plus the stored envelopes decrypts the whole history (no
  forward secrecy);
- the server can fabricate a message attributed to anyone (the AAD binds a
  sender id the server can write);
- anyone who talks to you is visible to the server, with times and volumes.

The threat model assumed here is a **hostile server**: whoever runs it —or
whoever can compel or compromise them— has legal power over the operator,
technical ability to reach the database, and physical access to devices that
are seized. Under that assumption the three points above are not acceptable,
and the fix is not a stronger cipher alone.

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
  claim it (§13).
- "As strong as Signal". The ratchet is the same family; the trust layer around
  it is smaller, and §6 lists what the server can still do.

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
- a **bundle signature**: Ed25519 over
  `wanderbibliothek:v2:bundle|<device_id>|<identity_key>|<signing_key>`;
- up to 50 one-time keys per publication, each one signed: Ed25519 over
  `wanderbibliothek:v2:otk|<device_id>|<key_id>|<key>`. The store keeps at most
  100 per device (libolm's own cap) and drops the oldest beyond that.

libolm does not sign one-time keys — X3DH signs a *signed prekey*, olm has no
equivalent — so these signatures are the only thing that stops a server from
handing out a key of its own and sitting in the middle of the handshake without
breaking any MAC. The server verifies both signatures before storing anything
(`src/lib/ed25519.ts`); the client verifies them again before opening a session
(§3), because the server is not trusted either.

Publishing is gated:

| Operation | Requires |
|---|---|
| First device of an account | Nothing (trust on first use, like v1) |
| Replenishing one-time keys | Nothing: the bundle signature proves the device |
| Adding another device | Password |
| Changing an existing device's identity | Password |
| Reactivating a revoked device | Password |

The password matters because the bundle signature only proves *possession of a
device key*, not that the person at the keyboard is the account holder. Every
change other than replenishment raises a security notification, and a change of
identity also notifies the people who talk to that account.

Removing a device marks it revoked and drops its one-time keys; peers see it
in the key-transparency history (§7). A suspended account publishes no devices
and its one-time keys cannot be claimed.

## 3. Session establishment

libolm's outbound session is a Triple-DH over the initiator's identity key, the
initiator's ephemeral key and one of the responder's one-time keys. The first
message is a *pre-key message*: it carries what the responder needs to build the
session.

1. Initiator fetches the peer device bundle (`GET /api/users/:id/devices`).
2. Initiator claims one one-time key (`POST …/devices/:deviceId/claim`). The
   server deletes the key inside the same transaction: **a one-time key is
   handed out at most once**. Claiming is capped per caller *and* per target
   device, so nobody can drain a stranger's keys with a handful of accounts.
3. Initiator **verifies** the bundle signature and the one-time-key signature
   with the device's signing key, and — if it has seen the device before —
   requires the **pair** `(identity_key, signing_key)` to be the one it stored,
   verifying against that stored key rather than the one that arrived
   (`startVerifiedSession`). Pinning only the identity key is not enough: the
   bundle signs itself, so a server that keeps the victim's identity key and
   swaps in its own signing key would still produce a valid-looking bundle. A
   bundle that does not verify never opens a session, and the client says so
   instead of silently falling back to v1.
4. Initiator builds the outbound session and sends a pre-key message.
5. Responder builds the inbound session from the pre-key message, removes the
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

The server stores one row per **recipient device** in `device_envelopes`
(`conversation`, `sender_user_id`, `sender_device_id`, `recipient_device_id`,
`type`, `body`, `created_at`) and validates shapes and sizes. It cannot open the
body. The sender's identity key is **not** stored with the envelope: the
receiver takes it from the signed device registry, which is what stops this
server from inventing a sender.

Transport:

| Endpoint | What it does |
|---|---|
| `POST /api/messages/v2` | Stores a batch for the devices of the other party. All or nothing: if any recipient device is gone, the whole batch is rejected with `409` |
| `GET /api/messages/v2?device=&conversation=` | Pending envelopes for **one of your devices** |
| `POST /api/messages/v2/ack` | Deletes the envelopes the client already decrypted |

`ACK` comes from the client after decryption, not from the `GET`: deleting on
delivery would lose messages on a dropped connection.

What is encrypted is not the bare text but a sealed record:

```
{"v":2,"c":"request:<id>","t":"<text>"}   ++ padding to a multiple of 256 chars
```

Two consequences, both tested:

- **Length**: the ciphertext only reveals which 256-character block the message
  falls into, not its exact size. v1.0.26 introduced this padding for v1 and v2
  keeps it.
- **Conversation**: libolm has no associated data, and a ratchet session is per
  device pair, not per thread. Without the conversation inside the sealed
  record, a hostile server could move a stored ciphertext to another thread with
  the same peer and the client would display it there as if it belonged to that
  thread. `decrypt(session, envelope, conversation)` refuses anything whose
  sealed record names a different conversation.

The server still refuses to move an envelope between conversations, but that is
a second line, not the only one: the check that counts happens inside the
ciphertext.

## 5. Replay, order and deletion

- libolm rejects a message key that was already used (replay).
- An envelope is deleted when the client acknowledges it, and never before; the
  maintenance cron purges unclaimed envelopes after 30 days.
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
| Swap the one-time key handed to the initiator | The key is signed by the device and the client verifies it before opening a session | — |
| Substitute a device identity key | The bundle is signed by the device, device keys are in the key-transparency set (§7) and safety numbers compare them | The signature proves a device key, not a person: only the transparency check or an out-of-band comparison binds it to the account |
| Add a device to someone's account | Password for anything but the first device; notification to the owner; the device enters the committed set (§7) | A hostile operator can still add one and rely on nobody checking |
| Move an envelope to another conversation | The conversation is inside the ciphertext and `decrypt` refuses a mismatch | — |
| Force the thread back to v1 | Anti-downgrade rule (§11): v2 is required once both devices have published keys | Not implemented until the client ships |
| Replay an envelope | Rejected by the ratchet | — |
| Drop or delay messages | Not prevented | Visible as gaps |
| Learn who talks to whom | Not prevented | §10 |

## 7. Key transparency

v1's catalogue snapshots are **not** a key directory. Since 1.0.26 there is a
separate signed snapshot of the key directory (`/api/transparency/keys`), a
Merkle root, a hash chain, and per-account inclusion proofs
(`/api/account/keys/proof`).

Committed today (`keyDirectoryLines`):

- each v1 platform slot: `account|slot|fingerprint|updated_at`;
- each v2 device: `account|device:<device_id>|<identity_key>|updated_at`,
  revocations included through the same `updated_at`.

Still missing, and not claimed anywhere else:

- **consistency proofs** between consecutive roots, so a server cannot present
  two histories;
- an external witness pinning key roots (the verifier already pins catalogue
  roots);
- verification in the client before trusting a device, and safety numbers for
  v2 devices.

Until the last one exists, the transparency log detects a substitution only the
day someone diffs two roots; the bundle signature (§2) is what makes the
substitution visible to a client that checks it.

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
2. Message size: padded to 256-character blocks inside the sealed record (§4),
   so the length only narrows the message to a bucket.
3. Opaque conversation ids: `request:` and `dm:` ids are already random; club
   fan-out uses random per-club ids.
4. Sealed sender, batching and delay: evaluated later; each costs latency and
   abuse control.

## 11. Migration

0. While both protocols coexist, a client that has a v2 device **sends both**:
   v1 envelopes for the platform slots and v2 envelopes for the devices. That is
   what makes the rollout non-breaking, and it stops the day no slot is left.
1. Clients publish a device bundle on first use; v1 `user_keys` rows become a
   read-only `web` device for existing accounts.
2. A thread uses v2 as soon as both devices have a session; otherwise it stays
   on v1. Both formats coexist; the server stores and returns either.
3. A message is never re-encrypted in place: rewriting ciphertext would break
   the ratchet.
4. v1 is removed once no thread has produced a v1 envelope in 90 days; the
   removal is a separate release with its own note.

**Anti-downgrade rule.** The server chooses which envelopes it returns, so it
can always try to keep a thread on v1 — where it can forge senders and read
history after a seizure. Therefore:

- once both devices have published a bundle, the thread is **v2 only**; a
  missing one-time key is a visible `409` and a retry, never a fall back;
- v1 is accepted only for threads created before v2 shipped, and the client
  marks those threads as legacy in the interface;
- a client that receives a v1 envelope in a v2 thread refuses it and reports it
  as an attack, not as a compatibility gap.

## 12. Acceptance tests

Required before calling v2 done:

- handshake between two devices, including the one-time key being consumed once;
- replay rejected; out-of-order accepted within the cap; beyond the cap
  rejected with a clear error;
- tampered body fails; body moved to another conversation fails;
- a bundle with a swapped identity key or a swapped one-time key is rejected
  before any session is opened;
- two messages of different lengths inside one 256-character block produce
  ciphertexts of the same size;
- a fresh device cannot read a session it was not part of;
- after `forget`, messages cannot be decrypted with the old state;
- the server never stores plaintext or private keys (schema assertion);
- key-transparency consistency proof detects a rewritten history;
- client verification of a peer's device key against the committed root.

## 13. The ratchet library

The ratchet is [libolm](https://gitlab.matrix.org/matrix-org/olm) (Apache-2.0,
WASM of a C/C++ library), the Double Ratchet Matrix used for years. It is a
deliberate choice over writing one here, and it is also the weakest link:

- **libolm is deprecated upstream.** Matrix rewrote it in Rust as
  [vodozemac](https://github.com/matrix-org/vodozemac) and recommends migrating.
  libolm is C/C++ — not memory-safe — and has had CVEs (CVE-2021-34813,
  CVE-2021-44538). Its primitive implementations are borrowed from an
  educational library (Brad Conte's `crypto-algorithms`).
- No npm advisory affects `@matrix-org/olm` 3.2.15 today (`npm audit` and OSV are
  clean), and in the browser it runs inside the WASM sandbox, with no filesystem
  or network access. Those mitigate the risk; they do not remove it.
- No post-quantum protection. Signal has PQXDH and a post-quantum ratchet; this
  does not, so recorded traffic is exposed to a future quantum adversary.

The migration target is `@matrix-org/matrix-sdk-crypto-wasm` (vodozemac compiled
to WASM, maintained, audited). It exposes the higher-level `OlmMachine` rather
than raw `Account`/`Session`, which also brings device tracking and cross-signing
— but it shapes the transport like Matrix events, so it belongs to the client
milestone, not to this increment. Until then this document must not claim "as
strong as Signal": the ratchet is comparable, and the layer around it is not.

## 14. Where the implementation stands

Shipped in this release:

| Piece | Where | Tested in |
|---|---|---|
| libolm wrapper: account, pre-key session, encrypt/decrypt, `pickle`, bundle and one-time-key signatures | `src/lib/e2e-v2.ts`, `src/lib/e2e-v2-format.ts` | `tests/e2e-v2.test.ts` |
| Sealed record: padding to 256 and conversation inside the ciphertext | `src/lib/e2e-v2.ts` | `tests/e2e-v2.test.ts` |
| Server-side Ed25519 verification of bundle and keys | `src/lib/ed25519.ts` | `tests/devices.test.ts` |
| Device registry, gated publishing, one-time keys handed out once, pruning, revocation | `src/lib/repo/devices.ts`, migration v65 | `tests/devices.test.ts` |
| `PUT/DELETE /api/account/devices/:deviceId`, `GET /api/users/:id/devices`, `POST …/devices/:deviceId/claim` | `src/app/api/**/devices*` | the static scan in `tests/route.test.ts` (wrapper, quota and origin for every route file) plus the repository behind them in `tests/devices.test.ts` |
| Device keys in the signed key directory | `src/lib/transparency.ts` | `tests/key-transparency.test.ts` |
| Envelope transport: store, list by device, acknowledge, retention | `src/lib/repo/envelopes.ts`, `/api/messages/v2*` | `tests/envelopes.test.ts` |
| Client: open the device, send to every device, decrypt and acknowledge, pin peers | `src/lib/e2e-v2-device.ts` | `tests/e2e-v2-device.test.ts` |
| Device state at rest: `AES-GCM` with a non-extractable key in IndexedDB | `src/lib/e2e-v2-idb.ts` | `tests/e2e-v2-idb.test.ts` |
| Bridge for the interface: dual-send, decrypt what arrives, activation | `src/lib/e2e-v2-chat.ts`, `src/components/account-settings.tsx`, `src/components/dialogs/exchange-dialog.tsx` | `tests/e2e-v2-device.test.ts` |
| libolm served from `/olm/` and loaded at runtime, with `wasm-unsafe-eval` in the CSP | `scripts/olm-assets.ts`, `src/lib/olm-runtime.ts`, `src/proxy.ts` | smoke run in a real browser |

How far the interface goes: activating v2 in «Mi cuenta» publishes the device,
and from then on exchanges **send both formats** (§11) and decrypt whatever
arrives, so the rollout does not cut anyone off. Direct messages still send v1
only.

Not implemented yet, and therefore **not** claimed by the documentation:
dropping v1 once the rollout ends, safety numbers for v2 devices, club fan-out
(§8), consistency proofs and client-side verification of the log (§7). Until those ship, the interface keeps
using v1 and the protections that depend on the ratchet — forward secrecy,
sender authentication, anti-downgrade — are **not** in place in production.

## 15. Change control

`wanderbibliothek:v2`, the envelope fields and the `conversation` strings are
part of the protocol. Changing them requires a new version, dual-read in both
clients, and an entry here.
