/**
 * Núcleo de la autenticación: hash de contraseña, intentos fallidos y correo sin
 * confirmar.
 *
 * Son las piezas que nadie ve pero de las que depende que una cuenta no se
 * pueda abrir con otra contraseña, que probar claves a ciegas tenga un tope y
 * que en producción una cuenta recién creada no pueda usar la plataforma sin
 * confirmar su correo.
 */
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type PasswordModule = typeof import("../src/lib/password.ts");
type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let password: PasswordModule;
let repo: RepoModule;
let dbModule: DbModule;

const CORRECTA = "unaClaveLarga123";
const INCORRECTA = "otraClaveLarga456";

before(async () => {
  password = await import("../src/lib/password.ts");
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

beforeEach(() => {
  dbModule.getDb().prepare("DELETE FROM auth_attempts").run();
});

test("una contraseña se guarda con sal y se verifica sin guardarla en claro", async () => {
  const hash = await password.hashPassword(CORRECTA);

  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!hash.includes(CORRECTA), "el hash no puede contener la contraseña");
  assert.equal(await password.verifyPassword(CORRECTA, hash), true);
  assert.equal(await password.verifyPassword(INCORRECTA, hash), false);
});

test("dos hashes de la misma contraseña son distintos y los dos valen", async () => {
  const uno = await password.hashPassword(CORRECTA);
  const otro = await password.hashPassword(CORRECTA);

  assert.notEqual(uno, otro, "cada hash lleva su propia sal");
  assert.equal(await password.verifyPassword(CORRECTA, uno), true);
  assert.equal(await password.verifyPassword(CORRECTA, otro), true);
});

test("el hash síncrono de las herramientas se verifica igual", async () => {
  const hash = password.hashPasswordSync(CORRECTA);
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await password.verifyPassword(CORRECTA, hash), true);
  assert.equal(await password.verifyPassword(INCORRECTA, hash), false);
});

test("un hash guardado mal formado no autentica a nadie", async () => {
  const valido = await password.hashPassword(CORRECTA);
  const [esquema, sal, digest] = valido.split("$");
  for (const roto of [
    "",
    "texto-plano",
    `${esquema}$${sal}`,
    `bcrypt$${sal}$${digest}`,
    `scrypt$`,
    `scrypt$${sal}$`,
    // Hexadecimal no válido: `Buffer.from` no da 64 bytes.
    `scrypt$${sal}$zzzz`,
    // Hash truncado: la longitud ya no coincide.
    `scrypt$${sal}$${digest?.slice(0, -2)}`,
  ]) {
    assert.equal(await password.verifyPassword(CORRECTA, roto), false, `«${roto}» no debe valer`);
  }
});

test("el hash señuelo del login no abre ninguna cuenta", async () => {
  // Sirve para que el login tarde lo mismo cuando el correo no existe; no debe
  // coincidir con ninguna contraseña real.
  assert.match(password.DUMMY_PASSWORD_HASH, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  for (const intento of ["", CORRECTA, "password123", "1234567890"]) {
    assert.equal(await password.verifyPassword(intento, password.DUMMY_PASSWORD_HASH), false);
  }
});

test("seis fallos en quince minutos bloquean la clave", () => {
  const clave = "login:lectora@example.test";
  for (let intento = 1; intento <= 5; intento += 1) {
    if (repo.isAuthBlocked(clave)) {
      assert.fail(`no debería bloquear con ${intento - 1} fallos`);
    }
    repo.recordAuthFailure(clave);
  }
  // El sexto fallo deja la cuenta bloqueada hasta que pase la ventana.
  repo.recordAuthFailure(clave);
  assert.equal(repo.isAuthBlocked(clave), true);
});

test("el bloqueo es por clave: otra cuenta o otra IP no se ven afectadas", () => {
  const bloqueada = "login:lectora@example.test";
  for (let intento = 0; intento < 6; intento += 1) repo.recordAuthFailure(bloqueada);

  assert.equal(repo.isAuthBlocked(bloqueada), true);
  assert.equal(repo.isAuthBlocked("login:otra@example.test"), false);
  assert.equal(repo.isAuthBlocked("login:203.0.113.5"), false);
});

test("un acceso correcto limpia el contador", () => {
  const clave = "login:lectora@example.test";
  for (let intento = 0; intento < 6; intento += 1) repo.recordAuthFailure(clave);
  assert.equal(repo.isAuthBlocked(clave), true);

  repo.clearAuthFailures(clave);
  assert.equal(repo.isAuthBlocked(clave), false);
});

test("los fallos de hace más de quince minutos ya no cuentan", () => {
  const clave = "login:antiguo@example.test";
  const db = dbModule.getDb();
  // Seis fallos, pero todos de hace veinte minutos: la ventana ya pasó.
  for (let intento = 0; intento < 6; intento += 1) {
    db.prepare(
      "INSERT INTO auth_attempts (attempt_key, created_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'))",
    ).run(clave);
  }
  assert.equal(repo.isAuthBlocked(clave), false);

  // El fallo de ahora sí cuenta: cinco antiguos más uno nuevo no llegan a seis.
  repo.recordAuthFailure(clave);
  assert.equal(repo.isAuthBlocked(clave), false);
  repo.recordAuthFailure(clave);
  assert.equal(repo.isAuthBlocked(clave), false);
});

test("con la verificación activada, una cuenta sin confirmar no continúa", () => {
  const db = dbModule.getDb();
  db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = 'usr_ana'").run();
  process.env.REQUIRE_EMAIL_VERIFICATION = "1";
  try {
    assert.throws(() => repo.assertVerified("usr_ana"), /Confirma tu correo/);

    repo.markEmailVerified("usr_ana");
    assert.doesNotThrow(() => repo.assertVerified("usr_ana"));
  } finally {
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
  }
});

test("sin la verificación activada, la cuenta nueva puede continuar", () => {
  const db = dbModule.getDb();
  db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = 'usr_marcos'").run();
  // El desarrollo no exige el paso; `REQUIRE_EMAIL_VERIFICATION=0` lo apaga
  // incluso en producción.
  process.env.REQUIRE_EMAIL_VERIFICATION = "0";
  try {
    assert.doesNotThrow(() => repo.assertVerified("usr_marcos"));
  } finally {
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
  }
});

test("cambiar la contraseña invalida la anterior", async () => {
  const original = await password.hashPassword(CORRECTA);
  const user = repo.createUser({
    name: "Contraseña Cambiada",
    email: "cambio-de-clave@wanderbibliothek.test",
    city: "Stuttgart",
    passwordHash: original,
  });

  const guardado = repo.getUserWithPassword(user.email);
  assert.ok(guardado);
  assert.equal(guardado.passwordHash, original);
  assert.equal(await password.verifyPassword(CORRECTA, guardado.passwordHash), true);
  assert.equal(repo.getUserWithPassword("no-existe@example.test"), null);

  const nueva = await password.hashPassword(INCORRECTA);
  repo.changePassword(user.id, nueva);

  const actualizado = repo.getUserWithPassword(user.email);
  assert.ok(actualizado);
  assert.equal(await password.verifyPassword(INCORRECTA, actualizado.passwordHash), true);
  assert.equal(
    await password.verifyPassword(CORRECTA, actualizado.passwordHash),
    false,
    "la contraseña anterior deja de valer",
  );
});
