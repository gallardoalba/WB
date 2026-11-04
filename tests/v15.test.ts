import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type TotpModule = typeof import("../src/lib/totp.ts");
type DbModule = typeof import("../src/lib/db.ts");

let repo: RepoModule;
let totp: TotpModule;
let dbModule: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  totp = await import("../src/lib/totp.ts");
  dbModule = await import("../src/lib/db.ts");
});

test("el algoritmo TOTP coincide con el vector de la RFC 6238", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totp.totpStep(59_000), 1);
  assert.equal(totp.totpCode(secret, 1), "287082");
  assert.equal(totp.verifyTotp(secret, "287082", { at: 59_000 }), 1);
  // Ventana de un paso: el código anterior sigue valiendo durante 30 s.
  assert.equal(totp.verifyTotp(secret, "287082", { at: 89_000 }), 1);
  // Un paso consumido no se puede reutilizar.
  assert.equal(totp.verifyTotp(secret, "287082", { at: 89_000, afterStep: 1 }), null);
});

test("la base migra a la versión actual con 2FA y privacidad", () => {
  const db = dbModule.getDb();
  assert.equal(db.pragma("user_version", { simple: true }), dbModule.SCHEMA_VERSION);
  const columns = (db.pragma("table_info(users)") as { name: string }[]).map((c) => c.name);
  for (const column of [
    "totp_secret",
    "totp_enabled_at",
    "totp_last_step",
    "public_key",
    "public_key_at",
  ]) {
    assert.ok(columns.includes(column), `falta ${column}`);
  }
});

test("activar, verificar y desactivar la verificación en dos pasos", () => {
  assert.deepEqual(repo.getTotpState("usr_ana"), { enabled: false, pending: false });

  const setup = repo.startTotpSetup("usr_ana");
  assert.match(setup.secret, /^[A-Z2-7]+$/);
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
  assert.deepEqual(repo.getTotpState("usr_ana"), { enabled: false, pending: true });

  const code = totp.totpCode(setup.secret, totp.totpStep());
  assert.throws(() => repo.enableTotp("usr_ana", "000000"), /no es válido/);
  repo.enableTotp("usr_ana", code);
  assert.deepEqual(repo.getTotpState("usr_ana"), { enabled: true, pending: false });

  // El código recién usado ya no vale (anti-replay).
  assert.equal(repo.verifyUserTotp("usr_ana", code), false);
  // Sin 2FA, la verificación no bloquea.
  assert.equal(repo.verifyUserTotp("usr_clara", "000000"), true);

  repo.disableTotp("usr_ana");
  assert.deepEqual(repo.getTotpState("usr_ana"), { enabled: false, pending: false });
});

test("no se puede activar sin generar el secreto", () => {
  assert.throws(() => repo.enableTotp("usr_diego", "123456"), /Genera primero/);
});
