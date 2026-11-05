import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type SecretBox = typeof import("../src/lib/secret-box.ts");

const CLAVE_A = "a".repeat(64);
const CLAVE_B = "b".repeat(64);

let box: SecretBox;

beforeEach(async () => {
  // El anillo de claves se cachea por firma del entorno: se reinicia entre
  // pruebas para poder cambiar de clave.
  box = await import("../src/lib/secret-box.ts");
  box.resetSecretBoxCache();
  delete process.env.APP_ENCRYPTION_OLD_KEYS;
  delete process.env.APP_ENCRYPTION_KEY_ID;
  delete process.env.WANDERBIBLIOTHEK_ALLOW_PLAINTEXT;
  process.env.APP_ENCRYPTION_KEY = CLAVE_A;
});

test("lo cifrado se descifra y el formato dice con qué clave se hizo", () => {
  const sobre = box.encryptSecret("secreto", "totp:usr_1");
  assert.match(sobre, /^enc:v2:[0-9a-f]{12}:a:/);
  assert.equal(box.decryptSecret(sobre, "totp:usr_1"), "secreto");
  // El id que viaja en el sobre es el de la clave activa.
  assert.ok(sobre.startsWith(`enc:v2:${box.activeKeyId()}:`));
});

test("dos cifrados del mismo texto son distintos (IV aleatorio)", () => {
  const uno = box.encryptSecret("secreto");
  const otro = box.encryptSecret("secreto");
  assert.notEqual(uno, otro);
  assert.equal(box.decryptSecret(uno), "secreto");
  assert.equal(box.decryptSecret(otro), "secreto");
});

test("el criptograma está atado a su contexto: no vale en otra fila", () => {
  const sobre = box.encryptSecret("123456789", box.shipContext("req_1", "ship_number"));
  assert.equal(box.decryptSecret(sobre, box.shipContext("req_1", "ship_number")), "123456789");
  // Mover el valor a otra solicitud (o a otra columna) hace fallar el descifrado.
  assert.throws(() => box.decryptSecret(sobre, box.shipContext("req_2", "ship_number")));
  assert.throws(() => box.decryptSecret(sobre, box.shipContext("req_1", "ship_city")));
  assert.throws(() => box.decryptSecret(sobre, ""));
});

test("rotar la clave: la anterior sigue leyendo mientras esté en OLD_KEYS", () => {
  const sobre = box.encryptSecret("secreto");

  // Se cambia la clave activa y la anterior queda como respaldo.
  process.env.APP_ENCRYPTION_KEY = CLAVE_B;
  process.env.APP_ENCRYPTION_OLD_KEYS = CLAVE_A;
  box.resetSecretBoxCache();
  assert.equal(box.decryptSecret(sobre), "secreto", "el respaldo abre lo antiguo");

  // Lo nuevo se cifra con la clave nueva.
  const nuevo = box.encryptSecret("otro secreto");
  assert.ok(nuevo.startsWith(`enc:v2:${box.activeKeyId()}:`));
  assert.notEqual(box.activeKeyId(), sobre.slice(6, 18));
  assert.equal(box.decryptSecret(nuevo), "otro secreto");

  // Y sin el respaldo, lo antiguo deja de poder leerse (no se pierde: se avisa).
  delete process.env.APP_ENCRYPTION_OLD_KEYS;
  box.resetSecretBoxCache();
  assert.throws(() => box.decryptSecret(sobre), /APP_ENCRYPTION_OLD_KEYS/);
});

test("un id de clave explícito se usa en el sobre", () => {
  process.env.APP_ENCRYPTION_KEY_ID = "2026-11";
  box.resetSecretBoxCache();
  const sobre = box.encryptSecret("secreto");
  assert.ok(sobre.startsWith("enc:v2:2026-11:-:"));
  assert.equal(box.activeKeyId(), "2026-11");
  assert.equal(box.decryptSecret(sobre), "secreto");
});

test("los valores heredados (enc:v1) se siguen leyendo", () => {
  // Se fabrica un v1 con el formato antiguo: iv.tag.datos y la misma clave.
  const iv = randomBytes(12);
  const key = Buffer.from(CLAVE_A, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const datos = Buffer.concat([cipher.update("antiguo", "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const heredado = `enc:v1:${iv.toString("base64url")}.${tag.toString("base64url")}.${datos.toString("base64url")}`;

  assert.equal(box.decryptSecret(heredado), "antiguo");
  // Aunque el contexto no coincida: los antiguos no lo llevaban.
  assert.equal(box.decryptSecret(heredado, "totp:usr_1"), "antiguo");
});

test("sin clave no se guarda nada en claro, salvo con la bandera explícita", () => {
  delete process.env.APP_ENCRYPTION_KEY;
  box.resetSecretBoxCache();
  assert.throws(() => box.encryptSecret("secreto"), /APP_ENCRYPTION_KEY/);

  // En desarrollo se puede pedir texto plano a propósito.
  process.env.WANDERBIBLIOTHEK_ALLOW_PLAINTEXT = "1";
  box.resetSecretBoxCache();
  assert.equal(box.encryptSecret("secreto"), "secreto");
});

test("una clave de longitud incorrecta es un error de configuración", () => {
  process.env.APP_ENCRYPTION_KEY = "1234";
  box.resetSecretBoxCache();
  assert.throws(() => box.encryptSecret("secreto"), /32 bytes/);
});
