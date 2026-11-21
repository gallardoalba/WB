import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
  WANDERBIBLIOTHEK_BACKUP_KEY: KEY_HEX,
  WANDERBIBLIOTHEK_BACKUP_HOOK: "rclone copy $BACKUP_FILE remoto:/wb",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA",
  TURNSTILE_SECRET: "0x4AAAAAABBB",
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

test("la bandera de texto plano no se admite en producción", () => {
  // Dejaría los secretos TOTP y los datos de envío legibles en el fichero.
  const issues = checkEnv(complete({ WANDERBIBLIOTHEK_ALLOW_PLAINTEXT: "1" }));
  assert.deepEqual(keys(issues, "error"), ["WANDERBIBLIOTHEK_ALLOW_PLAINTEXT"]);

  // El escape para entornos de prueba sigue siendo el del checker, no esa bandera.
  assert.deepEqual(
    checkEnv(complete({ WANDERBIBLIOTHEK_ALLOW_PLAINTEXT: "1", WANDERBIBLIOTHEK_SKIP_ENV_CHECK: "1" })),
    [],
  );
});

test("en producción faltan el correo, la URL y las dos claves", () => {
  const issues = checkEnv({ NODE_ENV: "production" });
  assert.deepEqual(keys(issues, "error").sort(), [
    "APP_ENCRYPTION_KEY",
    "MAIL_WEBHOOK_URL",
    "NEXT_PUBLIC_SITE_URL",
    "WANDERBIBLIOTHEK_BACKUP_KEY",
  ]);
  // El resto son avisos: la app arranca, pero el operador debe saberlo.
  assert.ok(keys(issues, "warn").includes("MAINTENANCE_TOKEN"));
  assert.ok(keys(issues, "warn").includes("TRUST_PROXY"));
  assert.ok(keys(issues, "warn").includes("WANDERBIBLIOTHEK_DB"));
  // Que la copia no salga del servidor sí es un aviso: la copia existe y está
  // cifrada, solo le falta el segundo destino.
  assert.ok(keys(issues, "warn").includes("WANDERBIBLIOTHEK_BACKUP_HOOK"));
  assert.ok(keys(issues, "warn").includes("TURNSTILE_SECRET"));
});

test("sin clave de copias no se arranca; el registro sin captcha solo avisa", () => {
  const issues = checkEnv(
    complete({ WANDERBIBLIOTHEK_BACKUP_KEY: undefined, TURNSTILE_SECRET: undefined }),
  );
  // Una copia en claro lleva correos y hashes: no es un aviso, es un fallo de
  // configuración. `assertEnv` aborta el arranque con esto.
  assert.deepEqual(keys(issues, "error"), ["WANDERBIBLIOTHEK_BACKUP_KEY"]);
  assert.ok(keys(issues, "warn").includes("TURNSTILE_SECRET"));
  assert.match(
    issues.find((issue) => issue.key === "WANDERBIBLIOTHEK_BACKUP_KEY")!.message,
    /en claro/,
  );
  // Sin captcha el sitio funciona: solo pierde la barrera contra registros
  // automatizados, y por eso no bloquea el arranque.
  assert.equal(
    checkEnv(complete({ TURNSTILE_SECRET: undefined })).some(
      (issue) => issue.severity === "error",
    ),
    false,
  );
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
  // Con una clave inválida la copia falla: tampoco hay respaldo cifrado.
  assert.equal(issue?.severity, "error");
  assert.match(issue!.message, /16 bytes|32 bytes/);
  // Una clave válida (hex o base64) no genera ningún aviso.
  assert.deepEqual(checkEnv(complete({ WANDERBIBLIOTHEK_BACKUP_KEY: KEY_B64 })), []);
});

test("la imagen puede validar la clave en el host sin exponerla al proceso web", () => {
  const image = `ghcr.io/gallardoalba/wb@sha256:${"a".repeat(64)}`;
  const hostValidated = complete({
    WANDERBIBLIOTHEK_BACKUP_KEY: undefined,
    WANDERBIBLIOTHEK_BACKUP_KEY_CONFIGURED: "1",
    WANDERBIBLIOTHEK_BACKUP_HOOK: undefined,
    WANDERBIBLIOTHEK_BACKUP_OFFSITE: "1",
    APP_IMAGE: image,
  });
  assert.deepEqual(checkEnv(hostValidated), []);

  const invalidKey = checkEnv({
    ...hostValidated,
    WANDERBIBLIOTHEK_BACKUP_KEY: "secreto-corto",
  }).find((issue) => issue.key === "WANDERBIBLIOTHEK_BACKUP_KEY");
  assert.equal(invalidKey?.severity, "error");

  const missingDigest = checkEnv({ ...hostValidated, APP_IMAGE: "wanderbibliothek:latest" }).find(
    (issue) => issue.key === "WANDERBIBLIOTHEK_BACKUP_KEY",
  );
  assert.equal(missingDigest?.severity, "error");
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

test("un TRUSTED_PROXY_HOPS por encima del máximo se avisa en vez de recortarse en silencio", () => {
  const issue = checkEnv(complete({ TRUSTED_PROXY_HOPS: "12" })).find(
    (item) => item.key === "TRUSTED_PROXY_HOPS",
  );
  assert.equal(issue?.severity, "warn");
  assert.match(issue!.message, /máximo/);
  // El límite (10) sí vale.
  assert.deepEqual(checkEnv(complete({ TRUSTED_PROXY_HOPS: "10" })), []);
});

test("el secreto de Turnstile sin su clave pública impide arrancar", () => {
  // Este es el fallo que dejó el registro cerrado en producción: la imagen se
  // compiló sin la clave pública y el servidor seguía exigiendo el token, así
  // que toda alta acababa en «Completa la verificación humana».
  const issues = checkEnv(complete({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined }));
  const error = issues.find((issue) => issue.severity === "error");
  assert.ok(error, "tiene que ser un error, no un aviso");
  assert.equal(error!.key, "NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  assert.match(error!.message, /registro rechazaría todas las altas/i);
});

test("exigir transparencia firmada sin clave no deja arrancar", () => {
  // Una instancia que anuncia transparencia y publica raíces sin firmar ofrece
  // menos de lo que dice; la bandera convierte esa diferencia en un fallo de
  // arranque en vez de en una sorpresa al verificar.
  const issues = checkEnv(complete({ REQUIRE_TRANSPARENCY_SIGNING: "1" }));
  assert.deepEqual(keys(issues, "error"), ["TRANSPARENCY_SIGNING_KEY"]);
  assert.match(
    issues.find((issue) => issue.key === "TRANSPARENCY_SIGNING_KEY")!.message,
    /transparency:key/,
  );
});

test("una clave de firma que no es Ed25519 se rechaza al arrancar", () => {
  // Base64 que no es una clave PKCS#8 válida (y que el escáner de secretos no
  // confunde con una credencial de verdad).
  const issues = checkEnv(
    complete({ REQUIRE_TRANSPARENCY_SIGNING: "1", TRANSPARENCY_SIGNING_KEY: "bm8tZXMtdW5hLWNsYXZl" }),
  );
  assert.deepEqual(keys(issues, "error"), ["TRANSPARENCY_SIGNING_KEY"]);

  // Y una Ed25519 de verdad pasa: si no, la comprobación sería un adorno.
  const { privateKey } = generateKeyPairSync("ed25519");
  const valid = Buffer.from(
    privateKey.export({ format: "der", type: "pkcs8" }),
  ).toString("base64");
  assert.deepEqual(
    keys(checkEnv(complete({ REQUIRE_TRANSPARENCY_SIGNING: "1", TRANSPARENCY_SIGNING_KEY: valid }))),
    [],
  );
});

test("sin la bandera, la clave de firma sigue siendo opcional", () => {
  assert.deepEqual(keys(checkEnv(complete())), []);
});
