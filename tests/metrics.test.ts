/**
 * Métricas en memoria que sirve `/api/metrics`.
 *
 * La ventana es acotada: una instancia que lleva meses encendida no puede
 * acumular una entrada por petición.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { latencySnapshot, loggedRequestCount, recordRequest, reportedErrorCount, reportError } from "../src/lib/observability.ts";
import { acquireStream, openStreamCount, releaseStream } from "../src/lib/live.ts";

// Estas pruebas generan miles de líneas de registro a propósito; se silencian
// para que la salida del runner siga siendo legible.
const original = { log: console.log, warn: console.warn, error: console.error };

before(() => {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

after(() => {
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
});

test("el resumen de latencia calcula percentiles sobre la ventana", () => {
  for (let ms = 1; ms <= 100; ms += 1) {
    recordRequest({ id: `req_${ms}`, method: "GET", path: "/api/prueba", status: 200, ms });
  }
  const snapshot = latencySnapshot();
  assert.equal(snapshot.samples, 100);
  assert.equal(snapshot.p50, 51);
  assert.equal(snapshot.p95, 96);
  assert.equal(snapshot.p99, 100);
  assert.equal(snapshot.max, 100);
});

test("la ventana no crece sin límite", () => {
  for (let ms = 1; ms <= 2_000; ms += 1) {
    recordRequest({ id: `req_${ms}`, method: "GET", path: "/api/prueba", status: 200, ms });
  }
  assert.equal(latencySnapshot().samples, 512, "se conservan las últimas 512 muestras");
  assert.equal(latencySnapshot().max, 2000);
});

test("los contadores de peticiones registradas y errores avanzan", () => {
  const before = loggedRequestCount();
  recordRequest({ id: "req_x", method: "GET", path: "/api/prueba", status: 200, ms: 5 });
  assert.equal(loggedRequestCount(), before + 1);

  const errores = reportedErrorCount();
  reportError(new Error("fallo de prueba"));
  assert.equal(reportedErrorCount(), errores + 1);
});

test("los flujos abiertos se reflejan en las métricas", () => {
  const user = "usr_metricas";
  try {
    assert.equal(acquireStream(user), "ok");
    assert.equal(openStreamCount(), 1);
  } finally {
    releaseStream(user);
  }
  assert.equal(openStreamCount(), 0);
});
