/**
 * Dos pestañas que cifran a la vez no pueden pisarse el ratchet.
 *
 * El estado del dispositivo se guarda entero: si la pestaña B escribe encima de
 * lo que hizo la A, las sesiones de A desaparecen y sus mensajes dejan de
 * abrirse sin ningún error visible. El puente lo serializa con
 * `navigator.locks`; aquí se comprueba contra la función real, con un cerrojo de
 * mentira que encola como el del navegador.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { withLock } from "../src/lib/e2e-v2-chat.ts";

type LockManagerLike = {
  request<T>(name: string, run: () => Promise<T>): Promise<T>;
};

/** Cerrojo por nombre: encola, como el del navegador. */
function fakeLocks(): LockManagerLike & { colas: Map<string, Promise<unknown>> } {
  const colas = new Map<string, Promise<unknown>>();
  return {
    colas,
    request<T>(name: string, run: () => Promise<T>): Promise<T> {
      const previo = colas.get(name) ?? Promise.resolve();
      const siguiente = previo.then(run, run);
      colas.set(name, siguiente.catch(() => undefined));
      return siguiente;
    },
  };
}

/** `navigator` es de solo lectura en Node: se toca la propiedad `locks`. */
function stubLocks(value: LockManagerLike | undefined): void {
  Object.defineProperty(navigator, "locks", { value, configurable: true, writable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true, writable: true });
});

test("el cerrojo por cuenta serializa y no pierde escrituras", async () => {
  stubLocks(fakeLocks());

  // Estado compartido, como el almacén entre dos pestañas.
  let valor = 0;
  const sumar = () =>
    withLock("usr_ana", async () => {
      const leido = valor;
      // Un respiro: sin cerrojo, las dos leerían lo mismo.
      await new Promise((resolve) => setTimeout(resolve, 10));
      valor = leido + 1;
    });

  await Promise.all([sumar(), sumar()]);
  assert.equal(valor, 2, "sin cerrojo se habría quedado en 1");
});

test("dos cuentas distintas no se bloquean entre sí", async () => {
  const locks = fakeLocks();
  stubLocks(locks);
  await Promise.all([
    withLock("usr_ana", async () => undefined),
    withLock("usr_bruno", async () => undefined),
  ]);
  assert.equal(locks.colas.size, 2, "un cerrojo por cuenta");
});

test("sin navigator.locks se sigue funcionando", async () => {
  // Un navegador viejo no debe dejar la mensajería muda: el cerrojo es una
  // mejora, no un requisito.
  stubLocks(undefined);
  let hecho = false;
  await withLock("usr_ana", async () => {
    hecho = true;
  });
  assert.equal(hecho, true);
});
