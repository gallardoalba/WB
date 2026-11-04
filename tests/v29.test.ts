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

const params = (overrides: Partial<Record<string, unknown>> = {}) => ({
  view: "home" as const,
  q: "",
  category: "Todos",
  language: "Todos" as const,
  sort: "near" as const,
  radius: 0,
  shelf: "all" as const,
  feed: "all" as const,
  tag: "",
  tab: "conversations" as const,
  scope: "region" as const,
  page: 1,
  ...overrides,
});

const ana = () => repo.getUserById("usr_ana");

test("la portada no carga clubes, lectores, listas ni intercambios", () => {
  const snapshot = repo.getSnapshot(ana(), params());
  // 6 ejemplares en la semilla, uno ya entregado (`lst_6`).
  assert.equal(snapshot.listings.length, 5);
  assert.equal(snapshot.total, 5);
  assert.deepEqual(snapshot.clubs, []);
  assert.equal(snapshot.clubsTotal, 0);
  assert.deepEqual(snapshot.readers, []);
  assert.deepEqual(snapshot.publicLists, []);
  assert.deepEqual(snapshot.requests, []);
  assert.deepEqual(snapshot.activity, []);
  // El contador del menú sí se calcula siempre: Diego tiene una solicitud
  // pendiente en la semilla y la portada no carga la lista, solo el número.
  const diego = repo.getSnapshot(repo.getUserById("usr_diego"), params());
  assert.ok(diego.activeRequests >= 1);
  assert.deepEqual(diego.requests, []);
});

test("cada pestaña de la comunidad ejecuta solo su consulta", () => {
  repo.createClub("usr_clara", {
    name: "Club de los martes",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
    joinPolicy: "open",
  });
  repo.createReadingList("usr_ana", { title: "Lista de comunidad", description: "" });

  const clubs = repo.getSnapshot(ana(), params({ view: "community", tab: "clubs" }));
  assert.deepEqual(
    clubs.clubs.map((club) => club.name),
    ["Club de los martes"],
  );
  assert.equal(clubs.clubsTotal, 1);
  assert.equal(clubs.readers.length, 0);
  assert.equal(clubs.publicLists.length, 0);
  assert.equal(clubs.listings.length, 0);

  const readers = repo.getSnapshot(ana(), params({ view: "community", tab: "readers" }));
  assert.ok(readers.readers.length >= 1);
  assert.equal(readers.clubs.length, 0);
  assert.equal(readers.publicLists.length, 0);

  const lists = repo.getSnapshot(ana(), params({ view: "community", tab: "lists" }));
  assert.deepEqual(
    lists.publicLists.map((list) => list.title),
    ["Lista de comunidad"],
  );
  assert.equal(lists.clubs.length, 0);

  const conversations = repo.getSnapshot(
    ana(),
    params({ view: "community", tab: "conversations" }),
  );
  assert.ok(Array.isArray(conversations.conversations));
  assert.equal(conversations.clubs.length, 0);
});

test("los intercambios cargan la lista completa y nada del catálogo", () => {
  repo.createRequest("usr_ana", "lst_3", "");
  const snapshot = repo.getSnapshot(ana(), params({ view: "exchanges" }));
  assert.ok(snapshot.requests.length >= 1);
  assert.ok(snapshot.activeRequests >= 1);
  // `requests` trae todos los estados; el contador solo los abiertos.
  assert.ok(snapshot.activeRequests <= snapshot.requests.length);
  assert.deepEqual(snapshot.listings, []);
  assert.deepEqual(snapshot.clubs, []);
  assert.deepEqual(snapshot.activity, []);
});

test("la estantería usa su propia consulta y su propio tamaño de página", () => {
  repo.setFavorite("usr_ana", "lst_3", true);
  const snapshot = repo.getSnapshot(ana(), params({ view: "shelf", shelf: "saved" }));
  // Ana ya tenía `lst_2` guardado en la semilla.
  assert.deepEqual(
    snapshot.listings.map((listing) => listing.id).sort(),
    ["lst_2", "lst_3"],
  );
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.pageSize, 12);
  assert.deepEqual(snapshot.requests, []);
  assert.deepEqual(snapshot.clubs, []);
});

test("un invitado no dispara consultas de cuenta", () => {
  const snapshot = repo.getSnapshot(null, params({ view: "discover" }));
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.activeRequests, 0);
  assert.deepEqual(snapshot.notifications, []);
  assert.deepEqual(snapshot.availabilityAlerts, []);
  assert.deepEqual(snapshot.publicLists, []);
  assert.ok(snapshot.listings.length > 0);
});

test("la portada no supera un presupuesto razonable de consultas", () => {
  // Guardia de rendimiento: si una vista empieza a cargar datos que no pinta,
  // este número lo delata. Se cuentan sentencias preparadas, no filas.
  const db = dbModule.getDb() as unknown as { prepare: (sql: string) => unknown };
  const original = db.prepare;
  const shared = { stats: repo.getStats(), activity: repo.listActivity(8, null) };
  const viewer = ana();
  let count = 0;
  db.prepare = function (this: unknown, sql: string) {
    count += 1;
    return original.call(this, sql);
  };
  try {
    repo.getSnapshot(viewer, params(), shared);
  } finally {
    db.prepare = original;
  }
  // Catálogo (3) + intercambios abiertos (1) + avisos (2) + no leídos (1) +
  // publicados (1) + alertas (1) = 9-10.
  assert.ok(count <= 12, `la portada prepara ${count} consultas`);
});
