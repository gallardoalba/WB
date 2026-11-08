/**
 * Mantenimiento del limitador de peticiones.
 *
 * La tabla `throttle` crece con cada intento; se limpia una de cada 32
 * inserciones para no convertir el limitador en un punto de escritura. Además,
 * el número de proxies de confianza se acota: un valor absurdo en el entorno no
 * puede hacer que se tome una IP inventada por el cliente.
 */
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type ThrottleModule = typeof import("../src/lib/throttle.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let throttle: ThrottleModule;
let dbModule: DbModule;

before(async () => {
  throttle = await import("../src/lib/throttle.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

beforeEach(() => {
  dbModule.getDb().prepare("DELETE FROM throttle").run();
});

const quota = (overrides: Partial<{ bucket: string; key: string; limit: number; windowMs: number }> = {}) => ({
  bucket: "mantenimiento",
  key: "cliente",
  limit: 100,
  windowMs: 60_000,
  ...overrides,
});

function registros(bucket: string): number {
  return (
    dbModule
      .getDb()
      .prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?")
      .get(bucket) as { n: number }
  ).n;
}

function insertarAntiguo(bucket: string) {
  dbModule
    .getDb()
    .prepare(
      "INSERT INTO throttle (bucket, throttle_key, created_at) VALUES (?, 'viejo', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'))",
    )
    .run(bucket);
}

test("la limpieza oportunista borra lo que ya no cuenta en ninguna ventana", () => {
  insertarAntiguo("mantenimiento");

  // 31 inserciones: la limpieza aún no ha tocado nada.
  for (let intento = 0; intento < 31; intento += 1) throttle.hit(quota());
  assert.equal(registros("mantenimiento"), 32, "los 31 intentos y la fila antigua");

  // La 32.ª dispara la limpieza: fuera lo de hace más de un día.
  throttle.hit(quota({ key: "cliente-32" }));
  assert.equal(registros("mantenimiento"), 32, "la fila antigua se borra y entra la nueva");
  const antiguos = dbModule
    .getDb()
    .prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket = ? AND throttle_key = 'viejo'")
    .get("mantenimiento") as { n: number };
  assert.equal(antiguos.n, 0);
});

test("con TRUST_PROXY, un número de saltos absurdo se acota", () => {
  process.env.TRUST_PROXY = "1";
  const get = (name: string) =>
    name === "x-forwarded-for" ? "198.51.100.7, 10.0.0.1" : null;
  try {
    // Más saltos que entradas: se toma la primera, nunca una posición negativa.
    process.env.TRUSTED_PROXY_HOPS = "5";
    assert.equal(throttle.clientIpFrom(get), "198.51.100.7");

    // Un valor no numérico vuelve al comportamiento por defecto (un salto).
    process.env.TRUSTED_PROXY_HOPS = "no-es-un-numero";
    assert.equal(throttle.clientIpFrom(get), "10.0.0.1");

    // Un cero tampoco deja el limitador sin IP.
    process.env.TRUSTED_PROXY_HOPS = "0";
    assert.equal(throttle.clientIpFrom(get), "10.0.0.1");
  } finally {
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUST_PROXY;
  }
});

test("la cuota anuncia cuánto falta para poder volver a intentarlo", () => {
  const estrecha = quota({ key: "una-sola", limit: 1, windowMs: 60_000 });
  throttle.hit(estrecha);

  assert.throws(
    () => throttle.hit(estrecha),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const conEstado = error as Error & { status?: number; retryAfter?: number };
      assert.equal(conEstado.status, 429);
      const retryAfter = conEstado.retryAfter ?? 0;
      // La ventana es de un minuto: como mucho, un minuto de espera.
      assert.ok(retryAfter >= 1 && retryAfter <= 60, `retryAfter fuera de rango: ${retryAfter}`);
      return true;
    },
  );
});
