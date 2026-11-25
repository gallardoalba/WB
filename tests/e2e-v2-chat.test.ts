/**
 * El puente de la interfaz, fuera del navegador.
 *
 * Aquí no hay IndexedDB ni sesión: lo que se comprueba es que **no finja** tener
 * dispositivo. Es la diferencia entre «no hay cifrado v2 en este navegador» y un
 * fallo silencioso que acabe mandando en v1 un mensaje que debía salir cifrado.
 *
 * Las rutas con almacén de verdad se cubren en `e2e-v2-device.test.ts` (con
 * dobles del almacén) y en la E2E `crypto-v2.spec.ts`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import * as bridge from "../src/lib/e2e-v2-chat.ts";

test("sin IndexedDB el puente dice que no hay dispositivo en vez de inventarlo", async () => {
  assert.equal(bridge.v2Supported(), false);
  assert.equal(await bridge.hasV2Device("usr_ana"), false);
  assert.equal(await bridge.deviceIdFor("usr_ana"), null);
  assert.equal(await bridge.loadV2Session("usr_ana"), null);
  assert.equal(await bridge.safetyWith("usr_ana", "usr_bruno"), null);
});

test("cifrar y descifrar sin dispositivo no lanzan: lo dicen en el resultado", async () => {
  assert.deepEqual(
    await bridge.encryptV2({
      userId: "usr_ana",
      peerUserId: "usr_bruno",
      conversation: "dm:usr_ana:usr_bruno",
      text: "hola",
    }),
    { status: "no-device" },
  );

  assert.deepEqual(
    await bridge.decryptV2({
      userId: "usr_ana",
      peerUserId: "usr_bruno",
      conversation: "dm:usr_ana:usr_bruno",
      messages: [],
    }),
    { texts: {}, failed: 0 },
  );
});

test("guardar u olvidar el dispositivo sin almacén no rompe la página", async () => {
  await bridge.rememberSentV2("usr_ana", "request:rq_1", "msg_1", "hola");
  await bridge.forgetV2Device("usr_ana");
  bridge.forgetV2Session();
});

test("activar sin almacén explica por qué no se puede", async () => {
  await assert.rejects(() => bridge.activateV2("usr_ana"), /no puede guardar/);
});
