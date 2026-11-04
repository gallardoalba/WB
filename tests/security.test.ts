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
