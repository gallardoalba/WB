/**
 * Propiedades del cifrado, con entradas generadas.
 *
 * Los casos de `message-encryption.test.ts` fijan ejemplos; aquí se comprueba
 * que el contrato aguanta texto arbitrario y JSON hostil venido de la base.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import * as e2e from "../src/lib/e2e.ts";

type Device = { privateKey: CryptoKey; publicJwk: JsonWebKey; keyId: string };

async function newDevice(): Promise<Device> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk, keyId: await e2e.keyIdFromJwk(publicJwk) };
}

test("cifrar y descifrar devuelve siempre el mismo texto", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const conversation = "req_propiedad";
  const key = await e2e.deriveConversationKey(
    sender.privateKey,
    destination.publicJwk,
    conversation,
  );

  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 400 }), async (text) => {
      const envelope = await e2e.encryptMessage(key, text);
      assert.equal(await e2e.decryptMessage(key, envelope), text);
    }),
    { numRuns: 30 },
  );
});

test("un AAD distinto nunca descifra", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const conversation = "req_propiedad_aad";
  const key = await e2e.deriveConversationKey(
    sender.privateKey,
    destination.publicJwk,
    conversation,
  );

  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.string({ minLength: 1, maxLength: 80 }),
      async (first, second) => {
        fc.pre(first !== second);
        const envelope = await e2e.encryptMessage(key, "secreto", first);
        assert.equal(await e2e.decryptMessage(key, envelope, second), null);
      },
    ),
    { numRuns: 15 },
  );
});

test("envelopesOf no lanza con JSON arbitrario y solo devuelve sobres completos", () => {
  fc.assert(
    fc.property(
      fc.anything(),
      fc.anything(),
      fc.anything(),
      fc.anything(),
      (envelopes, ciphertext, iv, keyId) => {
        const message = {
          isMine: false,
          keyId,
          ciphertext,
          iv,
          envelopes,
        } as unknown as Parameters<typeof e2e.envelopesOf>[0];

        const result = e2e.envelopesOf(message);
        assert.ok(Array.isArray(result));
        for (const envelope of result) {
          assert.equal(typeof envelope.keyId, "string");
          assert.equal(typeof envelope.ciphertext, "string");
          assert.equal(typeof envelope.iv, "string");
        }
      },
    ),
    { numRuns: 200 },
  );
});

test("la huella de seguridad es simétrica, estable y cambia con un dispositivo", async () => {
  const me = await newDevice();
  const peer = await newDevice();
  const peerTablet = await newDevice();

  const mine = await e2e.safetyNumber([me.publicJwk, peer.publicJwk]);
  const theirs = await e2e.safetyNumber([peer.publicJwk, me.publicJwk]);
  assert.equal(mine, theirs, "el orden no cambia el número");
  assert.equal(mine, await e2e.safetyNumber([me.publicJwk, peer.publicJwk]), "es estable");

  const withTablet = await e2e.safetyNumber([me.publicJwk, peer.publicJwk, peerTablet.publicJwk]);
  const withTabletOtherSide = await e2e.safetyNumber([
    peerTablet.publicJwk,
    peer.publicJwk,
    me.publicJwk,
  ]);
  assert.equal(withTablet, withTabletOtherSide);
  assert.notEqual(withTablet, mine, "añadir un aparato cambia la huella");

  const other = await newDevice();
  assert.notEqual(await e2e.safetyNumber([me.publicJwk, other.publicJwk]), mine);
  assert.match(mine, /^([0-9A-F]{5} ){5}[0-9A-F]{5}$/);
});
