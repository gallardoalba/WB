# End-to-end encryption: protocol and threat model

Protocol version: `wanderbibliothek:v1` (release 1.0.20 onwards).
Scope: message bodies of an accepted book exchange (`requestId`) and direct
messages between two accounts (`dm:<threadId>`). Club posts, comments,
notifications and listings are not end-to-end encrypted.

The reference implementation is [`src/lib/e2e.ts`](../src/lib/e2e.ts); the
server side is [`src/lib/repo/direct.ts`](../src/lib/repo/direct.ts),
[`src/app/api/account/keys/route.ts`](../src/app/api/account/keys/route.ts) and
[`src/lib/key-id.ts`](../src/lib/key-id.ts).

## 1. Goals

- The server operator (and anyone who reads a database dump) cannot read
  message bodies.
- Ciphertext is bound to one conversation, one claimed sender and one key:
  moving a message to another thread, or replaying it, fails the AEAD check.
- Each side can detect that the other side's key changed.

Non-goals: hiding metadata, anonymity, forward secrecy and post-compromise
security (see §6, decisions D1-D5).

## 2. Identity keys

- Each account has one ECDH P-256 key pair **per device slot**. The browser
  uses the `web` slot. Pairs are generated on the client.
- The private half never leaves the device. In the browser it is stored in
  IndexedDB as a **non-extractable** `CryptoKey`, in a record per account
  (`identity-v2:<userId>`): neither page JavaScript nor the server can export
  it. Two accounts on the same browser never share a pair.
- `keyId` is `base64url(SHA-256("<kty>.<crv>.<x>.<y>"))` (43 characters): the
  canonical fields of the JWK joined by dots, without JSON punctuation. The
  client and the server compute it with the same rule (`keyIdFromJwk`), and the
  server rejects an envelope whose `keyId` is not the fingerprint of the
  published key.

### Publication and rotation

| Situation | Control |
|---|---|
| First key of an account | TOFU: published without a password |
| Replacing a slot's key | Password required (`428` → password, then `403` if wrong) |
| Adding a slot to an account that already has one | Password required, same reason: a stolen session must not install the attacker's key |
| Any change | Row in `public_key_history` + security notification to the account and to peers with an open exchange |

The reason for the password on *adding* a slot: a stolen session could
otherwise publish a second key and read everything encrypted to it from then
on, while the original key kept working and nothing looked wrong.

## 3. Conversation key

```
shared = ECDH(private_me, public_peer)            # P-256, 256 bits
key    = HKDF-SHA256(
           ikm  = shared,
           salt = "wanderbibliothek:v1",
           info = "wanderbibliothek:request:<requestId>"   # exchange thread
                | "wanderbibliothek:dm:<threadId>"         # direct thread
         ) -> AES-GCM-256
```

The conversation identifier is in `info`, so the same key pair never produces
the same key for two threads.

## 4. Message envelope

- AES-GCM-256, with a fresh random 96-bit IV per message.
- AAD binds the context:
  `wanderbibliothek:v1|request:<id>|sender:<senderId>|key:<keyId>`
  (and the `dm:` equivalent for direct messages).
- The sender encrypts the plaintext once per active recipient key
  (1 to 4 envelopes). Envelopes produced by clients older than v40 (a single
  `ciphertext`/`iv` pair) are still accepted.
- Before encrypting, the plaintext is padded to a multiple of 256 bytes with a
  five-byte header (`0x01` and a 32-bit length). The server sees the size of
  each envelope, so without padding a «yes» and a long paragraph would be
  distinguishable by length alone. Messages stored before this change carry no
  header and are read as they are.
- The server stores only `{ keyId, ciphertext, iv }`. It validates the base64
  shape, the size limits and the fingerprint; it never receives a private key
  or plaintext.
- There is no digital signature: see D3.

## 5. Safety number

`SHA-256` over the sorted canonical JWKs of both accounts (all active slots),
truncated to 120 bits and shown as six groups of five hex characters. Both
sides compare it out of band. Adding or rotating a slot changes it. This is the
Signal-style "safety number" and it is what turns server key substitution from
invisible into detectable.

## 6. Threat model

### Assets

Message bodies, private keys, account identity. Metadata is **not** an asset
here: who talks to whom, when and how much is visible to the server (D5).

### Adversaries considered

| # | Adversary | Capability |
|---|---|---|
| A1 | Server operator, or a database dump | Reads and writes every table, every public key, every envelope |
| A2 | Stolen session cookie | Acts as the account until the session ends |
| A3 | Stolen device, or a copy of the browser profile | Has the private `CryptoKey` of that slot |
| A4 | Malicious or compromised peer | Is a legitimate participant of its own threads |
| A5 | Network attacker | Breaks or intercepts TLS |
| A6 | XSS in the application origin | Runs code in the page that holds the key |

### Outcome per adversary

- **A1**: reads metadata and ciphertext, cannot decrypt; can substitute a public
  key before the safety number is compared; can inject an envelope claiming any
  sender (D2, D3).
- **A2**: cannot install or rotate a key without the password, so cannot read
  future messages on its own; can send messages as the account through the
  normal API while the session lasts.
- **A3**: decrypts every thread encrypted to that slot, past and future (D1);
  can send messages.
- **A4**: reads its own threads only; server-side authorization keeps it out of
  the others.
- **A5**: with TLS broken, bodies stay encrypted; metadata does not.
- **A6**: uses the non-extractable key *in the page* to decrypt. Non-extractability
  prevents exporting the key, not misusing it.

### Decisions

**D1 - No forward secrecy and no post-compromise security. Accepted.**
The protocol uses static ECDH identity keys and no ratchet. Consequences:

- An attacker who obtains a slot's private key (A3) and has recorded ciphertext
  decrypts every past message of every thread encrypted to that key, and keeps
  reading the future ones.
- Rotating the key (password + notifications) cuts future exposure, but does
  not protect what was already sent.

This is accepted for v1 because the threat model at this stage is a
self-hosted community service, and a correct ratchet (per-message ephemeral
keys, skipped-message handling, multi-device session state) adds failure modes
that are worse than the limitation it fixes if it is not audited. Revisit when
any of these becomes true: the service targets high-risk users, a device
compromise is considered likely, or an external audit requires it. A ratchet
would arrive as `wanderbibliothek:v2` with dual-read support.

**D2 - No key transparency. TOFU + pinning + safety number.**
A malicious server can answer with different public keys to two parties. The
safety number differs, so a comparison detects it; a change after first contact
is detected by the client pin (`b2p-key-pin:<userId>` for the `web` slot,
`b2p-key-pin:<userId>:<platform>` for any other) and shown as `keyChanged`. Nothing prevents the substitution automatically: the control is
the out-of-band comparison.

**D3 - No cryptographic sender authentication.**
The AAD binds conversation, sender id and key id, but every party (including the
server) can compute it. The authoritative "who sent this" is the server's row.
A compromised server can therefore forge a message from any account. Mitigating
this needs signatures over the envelope (a new protocol version); until then the
control is server-side authorization and the audit trail.

**D4 - No key escrow or recovery.**
The private key exists only on the device. Clearing the browser storage or
losing the device loses the history of that slot. This is the price of
"nobody else can read it" and is documented in the user-facing texts.

**D5 - Metadata is not protected.**
Timestamps, participants, thread identifiers, envelope count and sizes are
visible to the server.

## 7. Verification

- [`tests/e2e-identity.test.ts`](../tests/e2e-identity.test.ts): identity per
  account, adoption of legacy identities, non-extractable key.
- [`tests/e2e-property.test.ts`](../tests/e2e-property.test.ts): envelope
  properties (round trip, wrong key, tampering).
- [`tests/message-encryption.test.ts`](../tests/message-encryption.test.ts):
  the server never stores plaintext and cannot read a message.
- [`tests/v16.test.ts`](../tests/v16.test.ts): server only keeps the envelope;
  moderation cannot read message bodies.
- [`e2e/crypto-smoke.spec.ts`](../e2e/crypto-smoke.spec.ts): WebCrypto and
  IndexedDB smoke test in Firefox and WebKit.
- [`tests/v31.test.ts`](../tests/v31.test.ts): publishing the same key is
  idempotent; a rotation goes through the history.

## 8. Change control

The strings `wanderbibliothek:v1` (HKDF salt) and the AAD layout are part of the
protocol. Any change to key derivation, AAD or envelope format requires:

1. a new version prefix (`wanderbibliothek:v2`);
2. dual-read on the client and the server until the old envelopes age out;
3. a note in this document and in `DOCUMENTATION.md`.

Changes that only affect how a key is stored locally (for example, the
`identity-v2` record layout) do not change the wire protocol and can be handled
with a client-side migration, as `adoptLegacyIdentity` does.
