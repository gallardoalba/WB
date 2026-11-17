import { expect, test } from "@playwright/test";

/**
 * Humo de las dos APIs de las que depende el cifrado en el navegador.
 *
 * No prueba la aplicación: comprueba que el motor concreto (Chromium, Firefox
 * o WebKit) genera un par P-256 exportable y abre IndexedDB. Un cambio de
 * motor o de políticas del navegador se ve aquí antes que en un hilo cifrado
 * que deja de abrirse.
 */
test("WebCrypto P-256 e IndexedDB funcionan en este navegador", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("wb-crypto-smoke", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(jwk, "public");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    indexedDB.deleteDatabase("wb-crypto-smoke");

    return { kty: jwk.kty, crv: jwk.crv, stored };
  });

  expect(result).toEqual({ kty: "EC", crv: "P-256", stored: true });
});
