import assert from "node:assert/strict";
import { test } from "node:test";
import { assertEnv, checkEnv, formatEnvIssues, type EnvLike } from "../src/lib/env-check.ts";

const KEY_HEX = "a".repeat(64);
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const complete = (patch: EnvLike = {}): EnvLike => ({
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://biblioteca.example.com",
  MAIL_WEBHOOK_URL: "https://mail.example/send",
  APP_ENCRYPTION_KEY: KEY_HEX,
  MAINTENANCE_TOKEN: TOKEN,
  TRUST_PROXY: "1",
  ERROR_WEBHOOK_URL: "https://errors.example/hook",
  WANDERBIBLIOTHEK_DB: "/var/lib/wanderbibliothek/wanderbibliothek.db",
  LEGAL_CONTROLLER: "Equipo Wanderbibliothek",
  LEGAL_ADDRESS: "Calle 1, 00000 Stuttgart",
  LEGAL_CONTACT_EMAIL: "privacidad@example.com",
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
  assert.ok(keys(issues, "warn").includes("WANDERBIBLIOTHEK_DB"));
});

test("Brevo sustituye al webhook, pero exige remitente", () => {
  const brevo = { MAIL_WEBHOOK_URL: undefined, BREVO_API_KEY: "xkeysib-prueba" };
  assert.deepEqual(
    checkEnv(complete({ ...brevo, MAIL_FROM: "Wanderbibliothek <no-reply@biblioteca.example>" })),
    [],
  );

  // Sin remitente, la API de Brevo rechaza cada envío: se avisa al arrancar.
  const sinRemitente = checkEnv(complete(brevo)).find((issue) => issue.key === "MAIL_FROM");
  assert.equal(sinRemitente?.severity, "error");

  const remitenteRoto = checkEnv(complete({ ...brevo, MAIL_FROM: "no-es-un-correo" })).find(
    (issue) => issue.key === "MAIL_FROM",
  );
  assert.equal(remitenteRoto?.severity, "error");

  // Con los dos, manda el webhook: la clave de Brevo quedaría muerta y se dice.
  const losDos = checkEnv(
    complete({ BREVO_API_KEY: "xkeysib-prueba", MAIL_FROM: "no-reply@biblioteca.example" }),
  ).find((issue) => issue.key === "BREVO_API_KEY");
  assert.equal(losDos?.severity, "warn");
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

test("un token de mantenimiento corto se avisa: protege una ruta de escritura", () => {
  const issue = checkEnv(complete({ MAINTENANCE_TOKEN: "corto" })).find(
    (item) => item.key === "MAINTENANCE_TOKEN",
  );
  assert.equal(issue?.severity, "warn");
  assert.match(issue!.message, /openssl rand -hex 32/);
});

test("las rutas de la base y de las copias deben ser absolutas", () => {
  const issues = checkEnv(
    complete({
      WANDERBIBLIOTHEK_DB: ".data/wanderbibliothek.db",
      WANDERBIBLIOTHEK_BACKUP_DIR: ".data/backups",
    }),
  );
  assert.deepEqual(
    issues.map((item) => item.key).sort(),
    ["WANDERBIBLIOTHEK_BACKUP_DIR", "WANDERBIBLIOTHEK_DB"],
  );
  assert.ok(issues.every((item) => item.severity === "warn"));
});

test("una clave de copias mal escrita se detecta al arrancar, no a las 03:20", () => {
  const issue = checkEnv(complete({ WANDERBIBLIOTHEK_BACKUP_KEY: "secreto-corto" })).find(
    (item) => item.key === "WANDERBIBLIOTHEK_BACKUP_KEY",
  );
  assert.equal(issue?.severity, "warn");
  assert.match(issue!.message, /16 bytes|32 bytes/);
  // Una clave válida (hex o base64) no genera ningún aviso.
  assert.deepEqual(checkEnv(complete({ WANDERBIBLIOTHEK_BACKUP_KEY: KEY_B64 })), []);
});

test("ADMIN_EMAIL y ADMIN_PASSWORD se exigen juntas", () => {
  const issue = checkEnv(complete({ ADMIN_EMAIL: "admin@example.com" })).find(
    (item) => item.key === "ADMIN_PASSWORD",
  );
  assert.equal(issue?.severity, "warn");
  assert.match(issue!.message, /las dos variables/);
  // Con el par completo solo queda el aviso de «retíralas cuando el
  // administrador ya exista», no el de configuración incompleta.
  const both = checkEnv(complete({ ADMIN_EMAIL: "a@b.c", ADMIN_PASSWORD: "x".repeat(20) }));
  assert.ok(both.every((item) => !/las dos variables/.test(item.message)));
});

test("faltan los datos del responsable: aviso, no bloqueo", () => {
  const issue = checkEnv(complete({ LEGAL_CONTROLLER: "", LEGAL_ADDRESS: "" })).find((item) =>
    item.key.startsWith("LEGAL_"),
  );
  assert.equal(issue?.severity, "warn");
  assert.match(issue!.message, /aviso legal/i);
});

test("los avisos no bloquean el arranque y los errores sí", () => {
  const warningsOnly = complete({ MAINTENANCE_TOKEN: "", TRUST_PROXY: "", WANDERBIBLIOTHEK_DB: "" });

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
  assert.deepEqual(checkEnv({ NODE_ENV: "production", WANDERBIBLIOTHEK_SKIP_ENV_CHECK: "1" }), []);
});

test("los mensajes dicen qué se rompe, no solo qué variable falta", () => {
  const lines = formatEnvIssues(checkEnv({ NODE_ENV: "production" }));
  assert.ok(lines.some((line) => line.startsWith("[env] ERROR ") && line.includes(":")));
  // El texto se lee en journalctl: debe explicar la consecuencia.
  assert.ok(lines.some((line) => /administración responde 403/.test(line)));
});

test("una clave antigua mal formada se detecta antes de necesitarla", () => {
  const conRotacion = complete({
    APP_ENCRYPTION_OLD_KEYS: `2025-06:${"b".repeat(64)}`,
  });
  // Con claves antiguas pero sin id para la activa: funciona, pero se avisa.
  const aviso = checkEnv(conRotacion).find((item) => item.key === "APP_ENCRYPTION_KEY_ID");
  assert.equal(aviso?.severity, "warn");
  assert.match(aviso!.message, /2026-11/);
  // Con id explícito, el aviso desaparece.
  assert.ok(
    !checkEnv({ ...conRotacion, APP_ENCRYPTION_KEY_ID: "2026-11" }).some(
      (item) => item.key === "APP_ENCRYPTION_KEY_ID",
    ),
  );

  // Una entrada que no es una clave de 32 bytes es un error, y el mensaje
  // muestra el principio de la entrada para localizarla.
  const rota = checkEnv(
    complete({ APP_ENCRYPTION_OLD_KEYS: `2025-06:${"b".repeat(64)},2024-01:corta` }),
  ).find((item) => item.key === "APP_ENCRYPTION_OLD_KEYS");
  assert.equal(rota?.severity, "error");
  assert.match(rota!.message, /2024-01:corta/);
});

test("un TRUSTED_PROXY_HOPS que no es un entero positivo se avisa", () => {
  for (const valor of ["0", "-2", "dos"]) {
    const issue = checkEnv(complete({ TRUSTED_PROXY_HOPS: valor })).find(
      (item) => item.key === "TRUSTED_PROXY_HOPS",
    );
    assert.equal(issue?.severity, "warn", `«${valor}» debería avisarse`);
    assert.match(issue!.message, /1 salto/);
  }
  // Un valor razonable no genera nada.
  assert.deepEqual(checkEnv(complete({ TRUSTED_PROXY_HOPS: "2" })), []);
});
