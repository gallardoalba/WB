/**
 * Archivar un intercambio cerrado es una decisión de cada parte.
 *
 * La lista de intercambios crece con el historial y los cerrados se quedan
 * para siempre. Archivar los aparta solo de la vista de quien lo pide: el
 * estado no cambia, la otra parte sigue viéndolo y los recuentos de la cuenta
 * no bajan. Aquí se fija esa frontera: qué se puede archivar, quién puede
 * hacerlo y qué ve cada lado después.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const errorDe = (action: () => unknown): Error & { status?: number } => {
  try {
    action();
  } catch (error) {
    return error as Error & { status?: number };
  }
  assert.fail("se esperaba un error y no lo hubo");
};

test("solo se archiva un intercambio cancelado o completado", () => {
  // `req_seed_2` sigue pendiente: archivarla escondería trabajo por hacer.
  const error = errorDe(() => repo.setRequestArchived("req_seed_2", "usr_clara", true));
  assert.equal(error.status, 409);
  assert.match(error.message, /cancelados o completados/);
});

test("un tercero no puede archivar ni ver el cajón de otra persona", () => {
  const error = errorDe(() => repo.setRequestArchived("req_seed_1", "usr_clara", true));
  assert.equal(error.status, 404);
});

test("archivar es personal: la otra parte sigue viendo el intercambio", () => {
  // `req_seed_1` está completado entre Ana y Lucía.
  const archived = repo.setRequestArchived("req_seed_1", "usr_ana", true);
  assert.equal(archived.archived, true);
  assert.equal(archived.status, "completed", "archivar no cambia el estado");

  assert.equal(
    repo.listRequests("usr_ana").some((item) => item.id === "req_seed_1"),
    false,
    "desaparece de la lista activa de quien lo archiva",
  );
  assert.equal(
    repo.listRequests("usr_ana", { archived: "archived" }).some((item) => item.id === "req_seed_1"),
    true,
    "y aparece en su cajón",
  );

  assert.equal(
    repo.listRequests("usr_lucia").some((item) => item.id === "req_seed_1"),
    true,
    "la otra parte no lo pierde de vista",
  );
  assert.equal(
    repo.getRequest("req_seed_1", "usr_lucia")?.archived,
    false,
    "ni lo ve como archivado",
  );
});

test("los recuentos de la cuenta no bajan al archivar", () => {
  assert.equal(repo.countRequests("usr_ana", { archived: "archived" }), 1);
  assert.equal(
    repo.countRequests("usr_ana", { archived: "all" }),
    repo.countRequests("usr_ana") + repo.countRequests("usr_ana", { archived: "archived" }),
  );
});

test("devolverlo a la lista es la misma operación al revés", () => {
  const restored = repo.setRequestArchived("req_seed_1", "usr_ana", false);
  assert.equal(restored.archived, false);
  assert.equal(
    repo.listRequests("usr_ana").some((item) => item.id === "req_seed_1"),
    true,
  );
  assert.equal(repo.countRequests("usr_ana", { archived: "archived" }), 0);

  // Archivar dos veces no duplica la fila ni falla: el botón puede repetirse.
  repo.setRequestArchived("req_seed_1", "usr_ana", true);
  repo.setRequestArchived("req_seed_1", "usr_ana", true);
  assert.equal(repo.countRequests("usr_ana", { archived: "archived" }), 1);
  repo.setRequestArchived("req_seed_1", "usr_ana", false);
});
