import assert from "node:assert/strict";
import { test } from "node:test";
import { assertEnv, checkEnv, formatEnvIssues, type EnvLike } from "../src/lib/env-check.ts";

const KEY_HEX = "a".repeat(64);
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

const complete = (patch: EnvLike = {}): EnvLike => ({
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://biblioteca.example.com",
  MAIL_WEBHOOK_URL: "https://mail.example/send",
  APP_ENCRYPTION_KEY: KEY_HEX,
  MAINTENANCE_TOKEN: "token-largo",
  TRUST_PROXY: "1",
  ERROR_WEBHOOK_URL: "https://errors.example/hook",
  BOOK2PEER_DB: "/var/lib/book2peer/book2peer.db",
  ...patch,
});

const keys = (issues: ReturnType<typeof checkEnv>, severity?: "error" | "warn") =>
  issues.filter((issue) => !severity || issue.severity === severity).map((issue) => issue.key);

test("en desarrollo no se comprueba nada", () => {
  assert.deepEqual(checkEnv({ NODE_ENV: "development" }), []);
});

test("un entorno completo y coherente no da problemas", () => {
  assert.deepEqual(checkEnv(complete()), []);
});

test("en producción faltan el correo, la URL y la clave de cifrado", () => {
  const issues = checkEnv({ NODE_ENV: "production" });
  assert.deepEqual(keys(issues, "error").sort(), [
    "APP_ENCRYPTION_KEY",
    "MAIL_WEBHOOK_URL",
    "NEXT_PUBLIC_SITE_URL",
  ]);
  // El resto son avisos: la app arranca, pero el operador debe saberlo.
  assert.ok(keys(issues, "warn").includes("MAINTENANCE_TOKEN"));
  assert.ok(keys(issues, "warn").includes("TRUST_PROXY"));
  assert.ok(keys(issues, "warn").includes("BOOK2PEER_DB"));
});

test("una URL sin https es un error: la cookie __Host- no sobrevive", () => {
  const issues = checkEnv(complete({ NEXT_PUBLIC_SITE_URL: "http://biblioteca.example.com" }));
  const issue = issues.find((item) => item.key === "NEXT_PUBLIC_SITE_URL");
  assert.equal(issue?.severity, "error");
  assert.match(issue!.message, /__Host-/);
});

test("la clave de cifrado admite hex y base64 de 32 bytes, y nada más", () => {
  assert.equal(checkEnv(complete({ APP_ENCRYPTION_KEY: KEY_B64 })).length, 0);
  for (const bad of ["corta", "a".repeat(63), Buffer.alloc(16, 1).toString("base64")]) {
    const issue = checkEnv(complete({ APP_ENCRYPTION_KEY: bad })).find(
      (item) => item.key === "APP_ENCRYPTION_KEY",
    );
    assert.equal(issue?.severity, "error", `«${bad}» debería rechazarse`);
  }
});

test("los avisos no bloquean el arranque y los errores sí", () => {
  const warningsOnly = complete({ MAINTENANCE_TOKEN: "", TRUST_PROXY: "", BOOK2PEER_DB: "" });
  assert.deepEqual(
    assertEnv(warningsOnly, () => {}).filter((issue) => issue.severity === "error"),
    [],
  );

  assert.throws(
    () => assertEnv({ NODE_ENV: "production" }, () => {}),
    /Entorno de producción incompleto/,
  );
});

test("la comprobación se puede saltar a propósito", () => {
  assert.deepEqual(checkEnv({ NODE_ENV: "production", BOOK2PEER_SKIP_ENV_CHECK: "1" }), []);
});

test("los mensajes dicen qué se rompe, no solo qué variable falta", () => {
  const lines = formatEnvIssues(checkEnv({ NODE_ENV: "production" }));
  assert.ok(lines.some((line) => line.startsWith("[env] ERROR ") && line.includes(":")));
  // El texto se lee en journalctl: debe explicar la consecuencia.
  assert.ok(lines.some((line) => /administración responde 403/.test(line)));
});
