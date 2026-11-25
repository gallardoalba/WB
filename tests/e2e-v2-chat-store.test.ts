/**
 * El puente cuando el almacén existe pero no funciona.
 *
 * Hay dos situaciones que se parecen y no son lo mismo: «este navegador no tiene
 * dispositivo v2» y «tiene uno, pero no se puede abrir». La primera permite
 * seguir con v1; la segunda es un fallo y, si se confundieran, el mensaje
 * saldría por el protocolo viejo justo cuando algo va mal.
 *
 * El almacén se elige al importar el módulo, así que el navegador de mentira va
 * antes del `import`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
Object.defineProperty(globalThis, "navigator", {
  value: { locks: { request: (_name: string, run: () => Promise<unknown>) => run() } },
  configurable: true,
});
Object.defineProperty(globalThis, "indexedDB", {
  value: {
    open() {
      throw new Error("IndexedDB roto");
    },
  },
  configurable: true,
});

test("un almacén roto no se confunde con no tener dispositivo", async () => {
  const bridge = await import("../src/lib/e2e-v2-chat.ts");
  assert.equal(bridge.v2Supported(), true, "el navegador dice que puede");

  const resultado = await bridge.encryptV2({
    userId: "usr_ana",
    peerUserId: "usr_bruno",
    conversation: "dm:usr_ana:usr_bruno",
    text: "hola",
  });

  assert.equal(resultado.status, "error", "no se cae a v1 por un fallo de almacenamiento");
  assert.match(
    resultado.status === "error" ? resultado.message : "",
    /No se pudo abrir el dispositivo/,
  );
});
