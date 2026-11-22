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
recipientDeviceId: string  # device the envelope is for
conversation: string   # "request:<id>" | "dm:<threadId>" | "club:<clubId>"
```

An envelope travels **inside the message it belongs to**, not in a separate
mailbox: `message_envelopes` and `dm_message_envelopes` gained `protocol` (1 =
v1 slot, 2 = v2 device) and `type`, and `club_post_envelopes` was created for the
forum. Keeping one row per recipient device in the same tables is what lets the
thread, the unread counters, the notifications, the export and the retention
work for both protocols without a second copy of all of it.

The row that holds the message keeps `sender_device_id` (a dedicated column, not
the v1 `key_id`: the v1 associated data is derived from `key_id` and mixing them
would make every v1 envelope unreadable). The sender's identity key is **not**
stored with the envelope: the receiver takes it from the signed device registry,
which is what stops this server from inventing a sender.

Server-side rules, all tested:

- the author participates in the thread; the recipients are that thread's other
  party (or the club's members) and **only** them;
- the sender device is the caller's own and is not revoked;
- a suspended account neither sends nor receives;
- once both sides have a v2 device, a v1-only message is **refused** (`409`):
  the conversation cannot fall back to the protocol without forward secrecy
  (§11);
- in the club forum, an author who has a v2 device cannot publish plaintext
  either — that is the whole point of encrypting the forum.

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
| **Re**attribute an authentic message to someone else | The client resolves the author from the signed registry by `sender_device_id` and refuses a mismatch | A hostile server can still hide the message; it cannot make it appear to be from someone who never signed it (once the client checks, which the club forum does) |
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
- verification in the client against the committed root before trusting a
  device — **done for the peer's device**: `verifyDeviceProof` walks the line to
  the root, checks the snapshot signature and pins the operator's signing key,
  so a second history fails and a swapped signer key is noticed. What is still
  missing is the **consistency proof between roots**.

The witness now exists, but it is the operator's own: because the signature is
theirs, one operator can sign two coherent histories and both would verify. What
catches that is someone keeping the roots they saw. `npm run
transparency:witness` fetches `/api/transparency` and `/api/transparency/keys`,
checks every signature and both hash chains, and appends one line per snapshot
(`id`, `createdAt`, `merkleRoot`, `previousRoot`, `itemCount`, `signature`,
`publicKey`, `seenAt`) to a JSONL file; `--check` re-verifies without writing and
fails if a pinned root changed, a signature changed, a snapshot disappeared or a
chain broke. The daily `testigo` workflow runs it and keeps the file as an
artifact — which only counts as evidence if it is also copied **outside** the
instance: an artifact that only the witness holds is worth nothing once the
witness is the one being watched. Until those copies exist, and until
consistency proofs land, the log still detects substitution only the day
somebody diffs two roots; §2's bundle signature is what makes a substitution
visible to a client that checks it.

What does exist is the out-of-band check: `v2SafetyNumber` hashes every device
of both sides (`device_id|identity_key|signing_key`, sorted, iterated SHA-512
5200 times) into the 60 digits the interface shows. Adding a device changes the
number, so a comparison made before stops being valid — which is the point.

Until the last one exists, the transparency log detects a substitution only the
day someone diffs two roots; the bundle signature (§2) is what makes the
substitution visible to a client that checks it.

## 8. Clubs and moderation

Club messages written from a browser with a v2 device are encrypted with
**pairwise v2 sessions fanned out to each member device** (one envelope per
device); an author without a device still writes plaintext, which is what the
server refuses as soon as they publish one. This is not MLS: membership changes
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
- An anonymous post (signed as «Comunidad») does not reveal which device wrote
  it: the device id maps to its owner through the club's device list, so it is
  withheld and the receiver tries the sessions it already has.

### Cost of the fan-out, and its caps

One message in a club of *m* members with *d* devices each is *m·d* envelopes:
roughly 20–30 KB and the same number of rows. That is fine for the clubs this
software is built for and bad for a thousand-person group, so the limits are
explicit rather than silent:

| Limit | Value | What happens at the limit |
|---|---|---|
| Devices per account | 5 | Adding another returns `409` with the way out: retire one |
| Envelopes per club message | 400 (≈100 members) | The post is refused with `409` that names the remedy |
| Disclosure retention | 2 years | `runMaintenance` purges older ones |

MLS is what removes the *m·d* factor (§8); until then these caps are the honest
answer for a small server.

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

0. While both protocols coexist, a client **tries v2 first**. If the peer has
   any device, the message goes out **only** in v2: shipping a v1 copy as well
   would hand the server a static-key ciphertext of every message, which is the
   hole v2 exists to close. v1 envelopes are produced only for peers that have
   no device yet, which keeps the rollout non-breaking without keeping the
   weaker copy around.
1. Clients publish a device bundle on first use; v1 `user_keys` rows become a
   read-only `web` device for existing accounts.
2. A thread uses v2 as soon as both devices have a session; otherwise it stays
   on v1. Both formats coexist; the server stores and returns either.
3. A message is never re-encrypted in place: rewriting ciphertext would break
   the ratchet.
4. v1 is removed once no thread has produced a v1 envelope in 90 days. The
   switch is `E2E_V1_SUNSET`: an ISO date after which the server answers `410`
   to any message carrying a v1 envelope. It is not silent — the maintenance
   report counts `legacyV1Messages` (v1 envelopes in the last 30 days) so the
   date is set with numbers in hand, not by hope.

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
| Envelopes carried inside each message (v1 slot or v2 device), refused from outsiders | `src/lib/repo/shared.ts`, `requests.ts`, `direct.ts`, migration v66 | `tests/message-v2.test.ts` |
| Client: open the device, send to every device, decrypt and acknowledge, pin peers | `src/lib/e2e-v2-device.ts` | `tests/e2e-v2-device.test.ts` |
| Device state at rest: `AES-GCM` with a non-extractable key in IndexedDB | `src/lib/e2e-v2-idb.ts` | `tests/e2e-v2-idb.test.ts` |
| Safety number over **all** devices of both sides, iterated SHA-512 (5200) | `src/lib/e2e-v2-safety.ts` | `tests/e2e-v2-safety.test.ts` |
| Client check that a device is in the signed directory (inclusion proof + snapshot signature, signer pinned) | `src/lib/e2e-v2-directory.ts`, `GET /api/users/:id/devices/:deviceId/proof` | `tests/e2e-v2-directory.test.ts`, `tests/e2e-v2-device.test.ts` |
| One-time keys replenished on their own when the device runs low | `src/lib/e2e-v2-device.ts` | `tests/e2e-v2-device.test.ts` |
| Club forum encrypted per member device, with moderation by disclosure | `src/lib/repo/clubcrypto.ts`, `POST /api/clubs/:id/posts`, `…/posts/:postId/reveal` | `tests/club-crypto.test.ts` |
| Caps that keep the fan-out affordable: 5 devices per account, 400 envelopes per club message | `src/lib/repo/devices.ts`, `clubcrypto.ts` | `tests/devices.test.ts`, `tests/club-crypto.test.ts` |
| Device state serialised across tabs (`navigator.locks`), re-read inside the lock | `src/lib/e2e-v2-chat.ts` | `tests/e2e-v2-locks.test.ts` |
| libolm copied to `/olm/` only if it matches the package's own `checksums.txt` | `scripts/olm-assets.ts` | `tests/olm-integrity.test.ts` |
| Anti-downgrade: once both sides have a device, a v1-only message is refused | `src/lib/repo/shared.ts`, requests and direct messages | `tests/message-v2.test.ts` |
| Bridge for the interface: v2 first, v1 only for peers without a device, decrypt what arrives, activation | `src/lib/e2e-v2-chat.ts`, `src/components/account-settings.tsx`, both message dialogs | `tests/e2e-v2-device.test.ts` |
| v2 accepted by exchange **and** direct messages, with the recipient device checked server-side | `src/lib/repo/requests.ts`, `src/lib/repo/direct.ts`, `src/lib/repo/shared.ts` | `tests/message-v2.test.ts` |
| libolm served from `/olm/` and loaded at runtime, with `wasm-unsafe-eval` in the CSP | `scripts/olm-assets.ts`, `src/lib/olm-runtime.ts`, `src/proxy.ts` | smoke run in a real browser |
| Moderation panel: the moderator opens the disclosed text on their own device | `src/components/club-disclosures.tsx`, `GET /api/clubs/:id/disclosures`, `POST …/disclosures/:id` | `tests/club-crypto.test.ts` |
| Disclosures purged after 730 days, so a report does not become an archive | `src/lib/repo/clubcrypto.ts` | `tests/club-crypto.test.ts` |
| Sunset switch for v1: a date after which v1 envelopes are refused with `410`, and a count of what is left | `src/lib/repo/shared.ts`, `src/lib/repo/maintenance.ts` | `tests/message-v2.test.ts` |
| Witness: pins catalogue and key roots, verifies signatures and chains, `--check` fails on a rewritten root or a missing snapshot | `src/lib/witness.ts`, `scripts/witness-roots.ts`, `.github/workflows/testigo.yml` | `tests/witness.test.ts` |

How far the interface goes: activating v2 in «Mi cuenta» publishes the device.
Exchanges and direct messages **prefer v2 and send only v2** when the peer has
a device, falling back to v1 —one envelope per slot, no ratchet— only while the
peer has none (§11). They decrypt whatever arrives, so the rollout does not cut
anyone off, and the thread shows the device safety number (§7) next to the v1
one. The club forum sends **only v2** when the
device exists — there is no v1 copy, because the whole point is that the
moderation cannot read it — and decrypts its own envelopes on load.

The moderator's panel lists the disclosures with who filed them, when and why,
and decrypts the text on the moderator's device from the envelopes the reporter
produced — the server never holds it in clear. Marking one read is a `POST`; the
rows age out after two years.

Not implemented yet, and therefore **not** claimed by the documentation:
consistency proofs between consecutive roots and a witness that is not the
operator (§7 — the script exists, the independent copy is a human step), v1
actually being switched off (the switch exists, the date is an operator
decision), and MLS for large clubs.

## 15. Change control

`wanderbibliothek:v2`, the envelope fields and the `conversation` strings are
part of the protocol. Changing them requires a new version, dual-read in both
clients, and an entry here.
