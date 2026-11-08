/**
 * Formatos guardados del cifrado de secretos.
 *
 * `decryptSecret` tiene que ser estricto con lo que lee: un sobre truncado o con
 * una clave que ya no está no puede devolver basura ni un texto vacío, sino un
 * error de configuración que lleve a la causa. Los valores anteriores al anillo
 * de claves (`enc:v1`) se siguen leyendo y, tras una rotación, se prueban las
 * claves antiguas antes de rendirse.
 */
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { beforeEach, test } from "node:test";

type SecretBox = typeof import("../src/lib/secret-box.ts");

const CLAVE_A = "a".repeat(64);
const CLAVE_B = "b".repeat(64);

let box: SecretBox;

beforeEach(async () => {
  box = await import("../src/lib/secret-box.ts");
  box.resetSecretBoxCache();
  delete process.env.APP_ENCRYPTION_OLD_KEYS;
  delete process.env.APP_ENCRYPTION_KEY_ID;
  delete process.env.WANDERBIBLIOTHEK_ALLOW_PLAINTEXT;
  process.env.APP_ENCRYPTION_KEY = CLAVE_A;
});

/** Fabrica un `enc:v1` con una clave concreta (formato anterior al anillo). */
function v1(clave: string, texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(clave, "hex"), iv);
  const datos = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}.${tag.toString("base64url")}.${datos.toString("base64url")}`;
}

test("un sobre con formato roto no devuelve texto: es un error de datos", () => {
  for (const roto of [
    "enc:v2:sin-separadores",
    "enc:v2:2026-11",
    "enc:v2:2026-11:a",
    "enc:v2:2026-11:a:solo.dos",
    // Sin id de clave delante.
    "enc:v2::a:AAAA.BBBB.CCCC",
  ]) {
    assert.throws(() => box.decryptSecret(roto), /formato válido/, roto);
  }

  for (const roto of ["enc:v1:un-solo-trozo", "enc:v1:uno.dos", "enc:v1:uno.dos.tres.cuatro"]) {
    assert.throws(() => box.decryptSecret(roto), /formato válido/, roto);
  }
});

test("un sobre de una clave desconocida pide la clave antigua, no devuelve nada", () => {
  const ajeno = "enc:v2:clave-que-no-existe:-:AAAA.BBBB.CCCC";
  assert.throws(() => box.decryptSecret(ajeno), /APP_ENCRYPTION_OLD_KEYS/);
});

test("un valor v1 cifrado con la clave anterior se abre tras la rotación", () => {
  const antiguo = v1(CLAVE_A, "secreto heredado");

  // Se rota: la clave activa es la B y la A queda como respaldo.
  process.env.APP_ENCRYPTION_KEY = CLAVE_B;
  process.env.APP_ENCRYPTION_OLD_KEYS = CLAVE_A;
  box.resetSecretBoxCache();
  assert.equal(box.decryptSecret(antiguo), "secreto heredado");

  // Sin el respaldo, el mismo valor ya no se puede leer.
  delete process.env.APP_ENCRYPTION_OLD_KEYS;
  box.resetSecretBoxCache();
  assert.throws(() => box.decryptSecret(antiguo));
});

test("sin clave configurada no se descifra ni un valor heredado", () => {
  const antiguo = v1(CLAVE_A, "secreto");
  const v2 = box.encryptSecret("otro secreto");
  delete process.env.APP_ENCRYPTION_KEY;
  box.resetSecretBoxCache();

  assert.throws(() => box.decryptSecret(antiguo), /APP_ENCRYPTION_KEY/);
  assert.throws(() => box.decryptSecret(v2), /APP_ENCRYPTION_KEY/);
});

test("el texto plano heredado se devuelve tal cual", () => {
  // Bases de desarrollo creadas antes de que existiera el cifrado.
  assert.equal(box.decryptSecret("123456"), "123456");
  assert.equal(box.decryptSecret(""), "");
});
