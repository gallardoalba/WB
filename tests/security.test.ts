import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type ThrottleModule = typeof import("../src/lib/throttle.ts");

let throttle: ThrottleModule;

before(async () => {
  throttle = await import("../src/lib/throttle.ts");
});

const post = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/test", { method: "POST", headers });

test("acepta mutaciones del mismo origen", () => {
  assert.doesNotThrow(() =>
    throttle.assertSameOrigin(post({ origin: "http://localhost:3000", host: "localhost:3000" })),
  );
});

test("rechaza mutaciones con otro origen", () => {
  assert.throws(
    () =>
      throttle.assertSameOrigin(post({ origin: "https://evil.example", host: "localhost:3000" })),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 403,
  );
});

test("rechaza navegadores de otro sitio aunque falte Origin", () => {
  assert.throws(
    () => throttle.assertSameOrigin(post({ "sec-fetch-site": "cross-site", host: "localhost:3000" })),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 403,
  );
});

test("acepta clientes sin cabeceras de navegador", () => {
  assert.doesNotThrow(() => throttle.assertSameOrigin(post({ host: "localhost:3000" })));
});

test("sin TRUST_PROXY la IP es compartida y el XFF no sirve para saltarse la cuota", () => {
  delete process.env.TRUST_PROXY;
  assert.equal(throttle.clientIp(post({ "x-forwarded-for": "10.0.0.9" })), "direct");

  const quota = { bucket: "ipsinconfianza", key: throttle.clientIp(post({})), limit: 1, windowMs: 60_000 };
  throttle.hit(quota);
  const spoofed = { ...quota, key: throttle.clientIp(post({ "x-forwarded-for": "10.0.0.10" })) };
  assert.equal(spoofed.key, "direct");
  assert.throws(() => throttle.hit(spoofed), (error: unknown) => error instanceof Error);
});

test("con TRUST_PROXY se usa la última IP del XFF (la añade el proxy)", () => {
  process.env.TRUST_PROXY = "1";
  // La primera entrada la puede inventar el cliente; el proxy añade la real al
  // final, que es la que hay que usar.
  assert.equal(
    throttle.clientIp(post({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })),
    "10.0.0.1",
  );
  assert.equal(throttle.clientIp(post({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
  assert.equal(throttle.clientIp(post({ "x-real-ip": "203.0.113.6" })), "203.0.113.6");
  delete process.env.TRUST_PROXY;
});
test("TRUSTED_PROXY_HOPS permite contar varios proxies encadenados", () => {
  process.env.TRUST_PROXY = "1";
  process.env.TRUSTED_PROXY_HOPS = "2";
  // cliente, proxy1 (añadido por proxy2)
  assert.equal(
    throttle.clientIp(post({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" })),
    "198.51.100.7",
  );
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUST_PROXY;
});

test("con TRUST_PROXY acepta el host reenviado por el proxy", () => {
  process.env.TRUST_PROXY = "1";
  // nginx reescribe Host al nombre interno; el público llega en X-Forwarded-Host.
  assert.doesNotThrow(() =>
    throttle.assertSameOrigin(
      post({
        host: "interno:3000",
        origin: "https://wanderbibliothek.app",
        "x-forwarded-host": "wanderbibliothek.app",
      }),
    ),
  );
  // Sin TRUST_PROXY esa misma petición se rechaza.
  delete process.env.TRUST_PROXY;
  assert.throws(
    () =>
      throttle.assertSameOrigin(
        post({
          host: "interno:3000",
          origin: "https://wanderbibliothek.app",
          "x-forwarded-host": "wanderbibliothek.app",
        }),
      ),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 403,
  );
});

/** Captura el 429 de un `hit()` que se pasa de la cuota. */
function quotaError(quota: { bucket: string; key: string; limit: number; windowMs: number }) {
  try {
    throttle.hit(quota);
  } catch (error) {
    return error as Error & {
      status?: number;
      retryAfter?: number;
      details?: unknown;
      vars?: Record<string, number>;
    };
  }
  assert.fail("la cuota tenía que rechazar el intento");
}

test("una espera corta se anuncia como un momento", () => {
  const quota = { bucket: "espera-corta", key: "u1", limit: 1, windowMs: 60_000 };
  throttle.hit(quota);
  const error = quotaError(quota);
  assert.equal(error.status, 429);
  assert.match(error.message, /inténtalo de nuevo/);
  assert.equal(error.vars, undefined, "un minuto de espera no necesita marcador");
  assert.ok((error.retryAfter ?? 0) <= 60, `Retry-After inesperado: ${error.retryAfter}`);
  assert.deepEqual(error.details, { retryAfterSeconds: error.retryAfter });
});

test("una espera de minutos se anuncia en minutos", () => {
  const quota = { bucket: "espera-minutos", key: "u1", limit: 1, windowMs: 30 * 60 * 1000 };
  throttle.hit(quota);
  const error = quotaError(quota);
  // Antes decía «Espera un momento» con una espera de media hora.
  assert.doesNotMatch(error.message, /un momento/);
  assert.match(error.message, /\{minutos\}/);
  assert.ok((error.vars?.minutos ?? 0) >= 29, `minutos inesperados: ${error.vars?.minutos}`);
});

test("una cuota diaria no promete «un momento»: la espera es de horas", () => {
  const quota = { bucket: "espera-larga", key: "u1", limit: 1, windowMs: 24 * 60 * 60 * 1000 };
  throttle.hit(quota);
  const error = quotaError(quota);
  assert.equal(error.status, 429);
  assert.doesNotMatch(error.message, /un momento/);
  assert.match(error.message, /\{horas\}/);
  assert.ok((error.vars?.horas ?? 0) >= 23, `horas inesperadas: ${error.vars?.horas}`);
  assert.ok((error.retryAfter ?? 0) > 3600, `Retry-After inesperado: ${error.retryAfter}`);
  assert.deepEqual(error.details, { retryAfterSeconds: error.retryAfter });
});

test("la administración publica sin tope; el resto, no", () => {
  // El freno de publicaciones existe contra el abuso de una cuenta cualquiera:
  // quien mantiene el servicio y cataloga un fondo entero no es ese caso.
  assert.equal(throttle.publicaSinTope({ isAdmin: true }), true);
  assert.equal(throttle.publicaSinTope({ isAdmin: false }), false);
  assert.equal(throttle.publicaSinTope(null), false);
  assert.equal(throttle.publicaSinTope(undefined), false);
});
