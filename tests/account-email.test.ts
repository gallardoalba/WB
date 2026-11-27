/**
 * Cambio de correo de la cuenta.
 *
 * Cambiar la dirección es cambiar la llave con la que se recupera la cuenta:
 * por eso la dirección nueva no se aplica al pedirla, sino al abrir el enlace
 * que se manda a ese mismo buzón. Aquí se comprueba esa separación, que un
 * token de un propósito no sirve para otro y que dos cuentas no acaban con la
 * misma dirección.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type TokensModule = typeof import("../src/lib/account-tokens.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let tokens: TokensModule;
let dbModule: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  tokens = await import("../src/lib/account-tokens.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

beforeEach(() => {
  // Cada prueba empieza con la tabla de tokens vacía: los enlaces caducan solos,
  // pero uno de la prueba anterior no debe colarse en la siguiente.
  dbModule.getDb().prepare("DELETE FROM account_tokens").run();
});

let counter = 0;
function cuenta(email?: string) {
  counter += 1;
  return repo.createUser({
    name: `Lectora ${counter}`,
    email: email ?? `cambio-${counter}@wanderbibliothek.test`,
    city: "Stuttgart",
    passwordHash: "scrypt$00$00",
  });
}

test("pedir el cambio no cambia el correo: solo deja la dirección pendiente", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "nueva@wanderbibliothek.test");

  const estado = repo.getAccountEmail(user.id);
  assert.deepEqual(estado, {
    email: user.email,
    pendingEmail: "nueva@wanderbibliothek.test",
  });
  // El correo de la sesión sigue siendo el de siempre hasta confirmar.
  assert.equal(repo.getUserById(user.id)?.email, user.email);
});

test("confirmar el cambio aplica la dirección nueva y la deja verificada", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "confirmada@wanderbibliothek.test");

  const cambio = repo.applyEmailChange(user.id);
  assert.deepEqual(cambio, { previous: user.email, email: "confirmada@wanderbibliothek.test" });

  const actualizado = repo.getUserById(user.id);
  assert.equal(actualizado?.email, "confirmada@wanderbibliothek.test");
  assert.equal(actualizado?.emailVerified, true);
  assert.equal(repo.getAccountEmail(user.id)?.pendingEmail, null);
});

test("no se puede confirmar dos veces el mismo cambio", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "una-vez@wanderbibliothek.test");
  assert.ok(repo.applyEmailChange(user.id));
  assert.equal(repo.applyEmailChange(user.id), null);
});

test("el correo actual y el de otra cuenta se rechazan", () => {
  const primera = cuenta();
  const segunda = cuenta();

  assert.throws(() => repo.requestEmailChange(primera.id, primera.email), /ya tienes/);
  assert.throws(() => repo.requestEmailChange(primera.id, segunda.email), /ya está en uso/);
});

test("cancelar borra la dirección pendiente y su enlace deja de valer", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "cancelada@wanderbibliothek.test");
  const token = tokens.issueAccountToken(user.id, "change_email");

  repo.cancelEmailChange(user.id);
  tokens.revokeAccountTokens(user.id, "change_email");

  assert.equal(repo.getAccountEmail(user.id)?.pendingEmail, null);
  assert.equal(tokens.consumeAccountToken(token, "change_email"), null);
});

test("el enlace del cambio no sirve para otras confirmaciones", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "cruzado@wanderbibliothek.test");
  const token = tokens.issueAccountToken(user.id, "change_email");

  // Ni como recuperación de contraseña ni como confirmación de cuenta.
  assert.equal(tokens.consumeAccountToken(token, "reset_password"), null);
  assert.equal(tokens.consumeAccountToken(token, "verify_email"), null);

  // Y en su propio propósito sigue valiendo, con el propósito en la respuesta.
  const consumido = tokens.consumeAccountToken(token, ["verify_email", "change_email"]);
  assert.deepEqual(consumido, { userId: user.id, purpose: "change_email" });
});

test("un enlace de cambio solo se gasta una vez", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "unico@wanderbibliothek.test");
  const token = tokens.issueAccountToken(user.id, "change_email");

  assert.ok(tokens.consumeAccountToken(token, "change_email"));
  assert.equal(tokens.consumeAccountToken(token, "change_email"), null);
});

test("un enlace caducado deja de contar como cambio pendiente", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "caducado@wanderbibliothek.test");
  const token = tokens.issueAccountToken(user.id, "change_email");
  assert.equal(tokens.hasValidAccountToken(user.id, "change_email"), true);

  // Se envejece el enlace: la dirección sigue apuntada, pero ya no se puede
  // confirmar y la interfaz no debe anunciarla como pendiente.
  dbModule
    .getDb()
    .prepare(
      "UPDATE account_tokens SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') WHERE token_hash = ?",
    )
    .run(createHash("sha256").update(token).digest("hex"));

  assert.equal(tokens.hasValidAccountToken(user.id, "change_email"), false);
  assert.equal(tokens.consumeAccountToken(token, "change_email"), null);
});

test("la exportación incluye la dirección pendiente", () => {
  const user = cuenta();
  repo.requestEmailChange(user.id, "exportada@wanderbibliothek.test");
  const data = repo.exportAccountData(user.id) as { pendingEmail: string | null };
  assert.equal(data.pendingEmail, "exportada@wanderbibliothek.test");

  // Sin cambio en curso no hay nada que enseñar.
  repo.cancelEmailChange(user.id);
  const limpio = repo.exportAccountData(user.id) as { pendingEmail: string | null };
  assert.equal(limpio.pendingEmail, null);
});

test("si otra cuenta toma la dirección antes, la confirmación no la pisa", () => {
  const primera = cuenta();
  const segunda = cuenta();
  repo.requestEmailChange(primera.id, "disputada@wanderbibliothek.test");

  // Entre la petición y la confirmación, otra cuenta se registra con esa
  // dirección (el índice único de `users.email` es el que lo impide).
  dbModule
    .getDb()
    .prepare("UPDATE users SET email = ? WHERE id = ?")
    .run("disputada@wanderbibliothek.test", segunda.id);

  assert.throws(() => repo.applyEmailChange(primera.id), /ya está en uso/);
  assert.equal(repo.getUserById(primera.id)?.email, primera.email);
});
