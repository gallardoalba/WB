/**
 * Códigos de recuperación del segundo factor.
 *
 * Sin ellos, perder el teléfono cierra la cuenta para siempre. Aquí se comprueba
 * lo que importa: que solo valen una vez, que se guardan hasheados (el texto en
 * claro no aparece en la base), que regenerar invalida los anteriores y que el
 * login acepta el código de la aplicación o uno de estos.
 */
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";
// El secreto TOTP se guarda cifrado con la clave de la instancia.
process.env.APP_ENCRYPTION_KEY = "c".repeat(64);

type RepoModule = typeof import("../src/lib/repo.ts");
type TotpModule = typeof import("../src/lib/totp.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let totp: TotpModule;
let dbModule: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  totp = await import("../src/lib/totp.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

beforeEach(() => {
  dbModule.getDb().prepare("DELETE FROM totp_recovery_codes").run();
});

let counter = 0;
function cuenta() {
  counter += 1;
  return repo.createUser({
    name: `Dos Pasos ${counter}`,
    email: `recuperacion-${counter}@wanderbibliothek.test`,
    city: "Stuttgart",
    passwordHash: "scrypt$00$00",
  });
}

/** Deja la cuenta con 2FA activo y devuelve su secreto. */
function conDosPasos(userId: string): string {
  const setup = repo.startTotpSetup(userId);
  const codes = repo.enableTotp(userId, totp.totpCode(setup.secret, totp.totpStep()));
  assert.equal(codes.length, repo.RECOVERY_CODE_COUNT);
  return setup.secret;
}

test("activar el segundo factor entrega diez códigos distintos y bien formados", () => {
  const user = cuenta();
  const secret = repo.startTotpSetup(user.id).secret;
  const codes = repo.enableTotp(user.id, totp.totpCode(secret, totp.totpStep()));

  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, "no se repiten");
  for (const code of codes) {
    assert.match(code, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/, code);
  }
  assert.equal(repo.countRecoveryCodes(user.id), 10);
});

test("en la base solo queda el hash: el código no se puede leer", () => {
  const user = cuenta();
  const secret = repo.startTotpSetup(user.id).secret;
  const [code] = repo.enableTotp(user.id, totp.totpCode(secret, totp.totpStep()));

  const rows = dbModule
    .getDb()
    .prepare("SELECT code_hash FROM totp_recovery_codes WHERE user_id = ?")
    .all(user.id) as { code_hash: string }[];
  assert.equal(rows.length, 10);
  assert.ok(
    rows.every((row) => !row.code_hash.includes(code!)),
    "el hash no puede contener el código",
  );
});

test("un código vale una sola vez y baja la cuenta", () => {
  const user = cuenta();
  const secret = repo.startTotpSetup(user.id).secret;
  const [code] = repo.enableTotp(user.id, totp.totpCode(secret, totp.totpStep()));

  assert.equal(repo.verifySecondFactor(user.id, code!), true);
  assert.equal(repo.verifySecondFactor(user.id, code!), false, "el segundo intento no vale");
  assert.equal(repo.countRecoveryCodes(user.id), 9);
});

test("se acepta escrito en minúsculas y sin el guion", () => {
  const user = cuenta();
  const secret = repo.startTotpSetup(user.id).secret;
  const [code] = repo.enableTotp(user.id, totp.totpCode(secret, totp.totpStep()));

  const suelto = code!.replace("-", "").toLowerCase();
  assert.equal(repo.verifySecondFactor(user.id, suelto), true);
});

test("regenerar invalida los códigos anteriores", () => {
  const user = cuenta();
  const secret = repo.startTotpSetup(user.id).secret;
  const antiguos = repo.enableTotp(user.id, totp.totpCode(secret, totp.totpStep()));

  const nuevos = repo.generateRecoveryCodes(user.id);
  assert.equal(repo.countRecoveryCodes(user.id), 10);
  assert.equal(repo.verifySecondFactor(user.id, antiguos[0]!), false);
  assert.equal(repo.verifySecondFactor(user.id, nuevos[0]!), true);
});

test("desactivar el segundo factor borra los códigos", () => {
  const user = cuenta();
  conDosPasos(user.id);
  assert.equal(repo.countRecoveryCodes(user.id), 10);

  repo.disableTotp(user.id);
  assert.equal(repo.countRecoveryCodes(user.id), 0);
});

test("el código de la aplicación sigue valiendo y no gasta códigos de recuperación", () => {
  const user = cuenta();
  const secret = conDosPasos(user.id);

  // Paso siguiente: el que se usó al activar ya quedó consumido (anti-replay).
  const step = totp.totpStep() + 1;
  assert.equal(repo.verifySecondFactor(user.id, totp.totpCode(secret, step)), true);
  assert.equal(repo.countRecoveryCodes(user.id), 10);
});

test("sin 2FA activo cualquier código vale: no hay segundo factor que comprobar", () => {
  const user = cuenta();
  assert.equal(repo.verifySecondFactor(user.id, "lo-que-sea"), true);
});

test("un código inventado no entra ni gasta la tanda", () => {
  const user = cuenta();
  conDosPasos(user.id);

  assert.equal(repo.verifySecondFactor(user.id, "AAAAA-BBBBB"), false);
  assert.equal(repo.verifySecondFactor(user.id, "123456"), false);
  assert.equal(repo.countRecoveryCodes(user.id), 10);
});
