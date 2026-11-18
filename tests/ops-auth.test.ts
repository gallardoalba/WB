/**
 * El token de operación.
 *
 * Es la llave que abre `/api/metrics` sin cookie de sesión: lo que usan el
 * vigilante y un recolector. Una comparación normal filtra el prefijo por el
 * tiempo de respuesta y una cabecera vacía no puede valer como token.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { bearerToken, hasOpsToken, safeEqual } from "../src/lib/ops-auth.ts";

const entorno = process.env as Record<string, string | undefined>;
const previo = entorno.MAINTENANCE_TOKEN;

afterEach(() => {
  if (previo === undefined) delete entorno.MAINTENANCE_TOKEN;
  else entorno.MAINTENANCE_TOKEN = previo;
});

function conCabecera(value?: string): Request {
  return new Request("http://localhost:3100/api/metrics", {
    headers: value === undefined ? {} : { authorization: value },
  });
}

test("la cabecera Bearer se lee y cualquier otra forma es vacío", () => {
  assert.equal(bearerToken(conCabecera("Bearer abc")), "abc");
  assert.equal(bearerToken(conCabecera("Basic abc")), "");
  assert.equal(bearerToken(conCabecera()), "");
});

test("dos cadenas distintas no son iguales, y una más corta tampoco revienta", () => {
  assert.equal(safeEqual("secreto", "secreto"), true);
  assert.equal(safeEqual("secreto", "secretp"), false);
  assert.equal(safeEqual("corto", "mucho más largo"), false);
  assert.equal(safeEqual("", ""), true);
});

test("sin token configurado no hay nada que aceptar", () => {
  delete entorno.MAINTENANCE_TOKEN;
  assert.equal(hasOpsToken(conCabecera("Bearer ") ), false);
  assert.equal(hasOpsToken(conCabecera("Bearer cualquiera")), false);
});

test("con token configurado solo vale el mismo", () => {
  entorno.MAINTENANCE_TOKEN = "token-de-operacion";
  assert.equal(hasOpsToken(conCabecera("Bearer token-de-operacion")), true);
  assert.equal(hasOpsToken(conCabecera("Bearer token-de-operaciom")), false);
  assert.equal(hasOpsToken(conCabecera()), false);
});
