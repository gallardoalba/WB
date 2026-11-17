/**
 * Procedencia de una copia: de dónde vino y por dónde ha pasado.
 *
 * La cadena la crea el propio cierre del intercambio (v44), así que estas
 * pruebas la generan con el flujo real en vez de escribir filas a mano. Lo que
 * se fija: el recorrido es agregado (ciudades y meses, sin nombres), respeta la
 * ciudad oculta de una parada anterior y se apaga entero cuando quien tiene el
 * libro lo decide.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let dbModule: DbModule;
/** Copia que estrena Lucía tras pedir «lst_1» a Clara. */
let copyId = "";

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db/index.ts");
  // lst_1 es de Clara (Stuttgart); Lucía la pide desde Karlsruhe.
  copyId = swap("lst_1", "usr_lucia", "usr_clara");
});

const params = (overrides: Record<string, unknown> = {}) => ({
  view: "discover" as const,
  q: "",
  category: "Todos",
  language: "Todos" as const,
  sort: "recent" as const,
  radius: 0,
  shelf: "all" as const,
  feed: "all" as const,
  tag: "",
  tab: "conversations" as const,
  scope: "region" as const,
  page: 1,
  ...overrides,
});

const privacy = (overrides: Record<string, unknown> = {}) => ({
  profileVisibility: "members",
  cityPrecision: "exact",
  signAs: "name",
  dmPolicy: "mutual",
  ...overrides,
});

/** Cierra un intercambio como lo hace la interfaz: aceptar y confirmar los dos. */
function swap(listingId: string, requesterId: string, ownerId: string): string {
  const request = repo.createRequest(requesterId, listingId, "");
  repo.updateRequestStatus(request.id, ownerId, "accepted");
  repo.updateRequestStatus(request.id, ownerId, "completed");
  repo.updateRequestStatus(request.id, requesterId, "completed");
  const copy = dbModule
    .getDb()
    .prepare("SELECT id FROM listings WHERE from_request_id = ?")
    .get(request.id) as { id: string } | undefined;
  assert.ok(copy, "el cierre no creó la copia de quien recibe");
  return copy.id;
}

test("una copia que no ha viajado no tiene recorrido", () => {
  assert.equal(repo.getCopyJourney("lst_2", "usr_ana"), null);
  assert.equal(repo.getCopyJourney("lst_2", null), null);
});

test("tras un intercambio el recorrido une las dos ciudades", () => {
  const received = repo.getListing(copyId, "usr_lucia");
  assert.ok(received);
  assert.equal(received.travelled, true, "la copia recibida no lleva la insignia");
  assert.equal(received.status, "paused");

  const journey = repo.getCopyJourney(copyId, "usr_lucia");
  assert.ok(journey);
  assert.equal(journey.readers, 2);
  assert.deepEqual(
    journey.stops.map((stop) => stop.city),
    ["Stuttgart", "Karlsruhe"],
  );
  // Los meses, no los días: es lo único que se enseña de las fechas.
  for (const stop of journey.stops) assert.match(stop.since, /^\d{4}-\d{2}$/);
  assert.ok(journey.km > 0, "Stuttgart y Karlsruhe no están a cero kilómetros");
  assert.equal(journey.hidden, false);
});

test("el recorrido es público y agregado, sin identidades", () => {
  const journey = repo.getCopyJourney(copyId, null);
  assert.ok(journey, "sin sesión también se puede leer el recorrido");
  for (const stop of journey.stops) {
    assert.deepEqual(Object.keys(stop).sort(), ["city", "since"]);
  }
});

test("la ciudad oculta de una parada anterior no se filtra", () => {
  const original = repo.getCopyJourney(copyId, "usr_lucia");
  assert.ok(original);
  assert.ok(original.km > 0);

  // Clara prefiere no enseñar su ciudad: su parada sale sin nombre y el tramo
  // no suma kilómetros (la distancia también la delataría).
  repo.setUserPrivacy("usr_clara", privacy({ cityPrecision: "hidden" }));
  const hidden = repo.getCopyJourney(copyId, "usr_lucia");
  assert.ok(hidden);
  assert.equal(hidden.stops[0].city, "");
  assert.equal(hidden.km, 0);

  repo.setUserPrivacy("usr_clara", privacy());
  assert.equal(repo.getUserById("usr_clara")?.cityPrecision, "exact");
});

test("quien tiene el libro puede ocultar el recorrido entero", () => {
  repo.setUserPrivacy("usr_lucia", privacy({ showJourney: false }));
  assert.equal(
    repo.getCopyJourney(copyId, "usr_ana"),
    null,
    "el recorrido oculto no debe salir para otra persona",
  );
  const own = repo.getCopyJourney(copyId, "usr_lucia");
  assert.ok(own, "quien lo oculta tiene que poder seguir viéndolo");
  assert.equal(own.hidden, true);

  // Las cuentas que no envían la preferencia (clientes antiguos) no la tocan.
  repo.setUserPrivacy("usr_lucia", privacy());
  assert.equal(repo.getUserById("usr_lucia")?.showJourney, false);

  repo.setUserPrivacy("usr_lucia", privacy({ showJourney: true }));
  assert.equal(repo.getUserById("usr_lucia")?.showJourney, true);
});

test("un segundo intercambio alarga la cadena y el catálogo marca la copia", () => {
  // Lucía vuelve a ponerla en circulación y Marcos (Freiburg) la pide.
  repo.setListingStatus("usr_lucia", copyId, "available");
  const second = swap(copyId, "usr_marcos", "usr_lucia");

  const journey = repo.getCopyJourney(second, "usr_marcos");
  assert.ok(journey);
  assert.equal(journey.readers, 3);
  assert.deepEqual(
    journey.stops.map((stop) => stop.city),
    ["Stuttgart", "Karlsruhe", "Freiburg im Breisgau"],
  );

  // La copia nueva está en pausa; al ofrecerla aparece en el catálogo con la
  // insignia de procedencia.
  repo.setListingStatus("usr_marcos", second, "available");
  const found = repo.catalogPage("usr_ana", params()).items.find((item) => item.id === second);
  assert.ok(found, "la copia activada no aparece en el catálogo");
  assert.equal(found.travelled, true);

  // Las que nunca se han movido no llevan insignia.
  assert.equal(repo.getListing("lst_2", "usr_ana")?.travelled, false);
});
