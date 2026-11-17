/**
 * Contabilidad de flujos SSE.
 *
 * El tope por cuenta ya existía; el global es el que evita que muchas cuentas
 * correctas agoten descriptores y temporizadores del único proceso.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { acquireStream, openStreamCount, releaseStream } from "../src/lib/live.ts";

test("una cuenta no abre más de tres flujos a la vez", () => {
  const user = "usr_tope_cuenta";
  try {
    assert.equal(acquireStream(user), "ok");
    assert.equal(acquireStream(user), "ok");
    assert.equal(acquireStream(user), "ok");
    assert.equal(acquireStream(user), "user", "el cuarto se rechaza por cuenta");
  } finally {
    for (let i = 0; i < 3; i += 1) releaseStream(user);
  }
  assert.equal(openStreamCount(), 0);
});

test("el tope global se aplica aunque cada cuenta esté dentro de su límite", () => {
  const previous = process.env.SSE_MAX_STREAMS;
  process.env.SSE_MAX_STREAMS = "2";
  const users = ["usr_global_a", "usr_global_b", "usr_global_c"];
  try {
    assert.equal(acquireStream(users[0]), "ok");
    assert.equal(acquireStream(users[1]), "ok");
    assert.equal(acquireStream(users[2]), "global", "la tercera cuenta se queda fuera");
    assert.equal(openStreamCount(), 2);

    releaseStream(users[0]);
    assert.equal(acquireStream(users[2]), "ok", "al liberar un flujo entra la siguiente");
    assert.equal(openStreamCount(), 2);
  } finally {
    for (const user of users) releaseStream(user);
    releaseStream(users[0]);
    if (previous === undefined) delete process.env.SSE_MAX_STREAMS;
    else process.env.SSE_MAX_STREAMS = previous;
  }
  assert.equal(openStreamCount(), 0, "liberar de más no deja el contador negativo");
});

test("una cuenta distinta no hereda los flujos de otra", () => {
  const first = "usr_aislado_1";
  const second = "usr_aislado_2";
  try {
    assert.equal(acquireStream(first), "ok");
    assert.equal(acquireStream(first), "ok");
    assert.equal(acquireStream(second), "ok", "el tope es por cuenta, no global entre dos");
  } finally {
    releaseStream(first);
    releaseStream(first);
    releaseStream(second);
  }
  assert.equal(openStreamCount(), 0);
});
