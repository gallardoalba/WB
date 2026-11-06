/**
 * Tamaño de la portada tras reducirla.
 *
 * Es la parte de `cover-image.ts` que se puede probar sin navegador; el resto
 * (decodificar y recomprimir) necesita `canvas`, así que se comprueba a mano en
 * el navegador.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_COVER_SIDE, coverSize } from "../src/lib/cover-image.ts";

test("una portada que ya cabe se queda como está", () => {
  assert.deepEqual(coverSize(300, 450), { width: 300, height: 450 });
  assert.deepEqual(coverSize(MAX_COVER_SIDE, 900), { width: MAX_COVER_SIDE, height: 900 });
});

test("reduce por el lado mayor y mantiene la proporción", () => {
  // Foto de móvil apaisada y cubierta vertical.
  assert.deepEqual(coverSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(coverSize(3000, 4000), { width: 1200, height: 1600 });
});

test("acepta otro límite y no deja lados a cero", () => {
  assert.deepEqual(coverSize(4000, 3000, 800), { width: 800, height: 600 });
  assert.deepEqual(coverSize(5000, 1, 1600), { width: 1600, height: 1 });
});

test("un tamaño inválido no produce NaN ni negativos", () => {
  assert.deepEqual(coverSize(0, 0), { width: 0, height: 0 });
  assert.deepEqual(coverSize(Number.NaN, 100), { width: 0, height: 0 });
});
