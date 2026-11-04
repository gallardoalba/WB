import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db.ts");
  repo = await import("../src/lib/repo.ts");
});

/** JWK P-256 con la forma que valida el esquema (el servidor no verifica aquí). */
const jwk = (seed: string) => ({
  kty: "EC",
  crv: "P-256",
  x: seed.repeat(43).slice(0, 43),
  y: seed.repeat(43).slice(0, 43).replace(/a/g, "b").slice(0, 43),
});

test("la primera clave se publica sin contraseña y queda en el historial", async () => {
  const result = await repo.changePublicKey("usr_ana", jwk("a"));
  assert.equal(result.changed, true);
  assert.equal(result.previousKeyId, null);

  const history = repo.listPublicKeyHistory("usr_ana");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.reason, "initial");
  assert.equal(history[0]?.replacedAt, null);
});

test("republicar la misma clave es idempotente y no ensucia el historial", async () => {
  const result = await repo.changePublicKey("usr_ana", jwk("a"));
  assert.equal(result.changed, false);
  assert.equal(repo.listPublicKeyHistory("usr_ana").length, 1);
});

test("cambiar la clave exige la contraseña de la cuenta", async () => {
  await assert.rejects(
    () => repo.changePublicKey("usr_ana", jwk("c")),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      (error as { status: number }).status === 428 &&
      (error as { details?: { rotationRequired?: boolean } }).details?.rotationRequired === true,
  );
  // La clave anterior sigue siendo la publicada.
  assert.equal(
    repo.listPublicKeyHistory("usr_ana")[0]?.keyId,
    repo.getPublicKeyRecord("usr_ana")?.keyId,
  );
});

test("una contraseña incorrecta no permite la rotación", async () => {
  await assert.rejects(
    () => repo.changePublicKey("usr_ana", jwk("c"), { password: "no-es-mi-clave" }),
    (error: unknown) =>
      error instanceof Error && "status" in error && (error as { status: number }).status === 403,
  );
});

test("con la contraseña correcta la rotación cierra la clave anterior", async () => {
  const before = repo.getPublicKeyRecord("usr_ana")!;
  const result = await repo.changePublicKey("usr_ana", jwk("c"), { password: "demo1234" });
  assert.equal(result.changed, true);
  assert.equal(result.previousKeyId, before.keyId);
  assert.notEqual(result.keyId, before.keyId);

  const history = repo.listPublicKeyHistory("usr_ana");
  assert.equal(history.length, 2);
  assert.equal(history[0]?.reason, "rotation");
  assert.equal(history[0]?.replacedAt, null);
  assert.equal(history[1]?.keyId, before.keyId);
  assert.ok(history[1]?.replacedAt);
  const openRows = dbModule
    .getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM public_key_history WHERE user_id = ? AND replaced_at IS NULL",
    )
    .get("usr_ana") as { n: number };
  assert.equal(openRows.n, 1);
});

test("los avisos de cambio de clave llegan a las contrapartes del intercambio", () => {
  const request = repo.createRequest("usr_marcos", "lst_1", "");
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  assert.deepEqual(repo.listConversationPeers("usr_marcos"), ["usr_clara"]);
  // La semilla ya trae un intercambio cerrado de Ana con Lucía.
  assert.deepEqual(repo.listConversationPeers("usr_ana"), ["usr_lucia"]);
  assert.deepEqual(repo.listConversationPeers("usr_admin"), []);
});
