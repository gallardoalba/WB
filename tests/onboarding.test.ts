/**
 * Progreso de los primeros pasos de la portada.
 *
 * Lo calcula el servidor para que la lista se tache igual desde cualquier
 * dispositivo. Aquí se comprueba que una cuenta recién creada empieza en cero y
 * que cada tarea se marca al hacerla de verdad (no al pulsar el enlace).
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;
let newcomerId = "";

before(async () => {
  repo = await import("../src/lib/repo.ts");
  const user = repo.createUser({
    name: "Nueva Lectora",
    email: "nueva@example.test",
    passwordHash: "scrypt$00$00",
    city: "Stuttgart",
  });
  newcomerId = user.id;
});

const params = (overrides: Record<string, unknown> = {}) => ({
  view: "home" as const,
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

const progress = () => repo.getSnapshot(repo.getUserById(newcomerId)!, params()).onboarding;

test("una cuenta recién creada no tiene ningún paso hecho", () => {
  assert.deepEqual(progress(), {
    profile: false,
    published: false,
    requested: false,
    following: false,
  });
});

test("fuera de la portada no se calcula el progreso", () => {
  const snapshot = repo.getSnapshot(repo.getUserById(newcomerId)!, params({ view: "discover" }));
  assert.deepEqual(snapshot.onboarding, {
    profile: false,
    published: false,
    requested: false,
    following: false,
  });
});

test("sin sesión tampoco hay progreso", () => {
  assert.deepEqual(repo.getSnapshot(null, params()).onboarding, {
    profile: false,
    published: false,
    requested: false,
    following: false,
  });
});

test("cada tarea se marca al completarla", () => {
  repo.updateProfile(newcomerId, {
    name: "Nueva Lectora",
    bio: "Leo sobre todo ensayo.",
    city: "Stuttgart",
  });
  assert.equal(progress().profile, true);

  const listing = repo.createListing(newcomerId, {
    title: "Un ensayo cualquiera",
    author: "Autora Ejemplo",
    category: "Humanidades",
    language: "Español",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: [],
  });
  assert.equal(progress().published, true);

  repo.createRequest(newcomerId, "lst_3", "");
  assert.equal(progress().requested, true);

  repo.setFollow(newcomerId, "usr_clara", true);
  assert.equal(progress().following, true);

  // La publicación propia no altera el resto de marcas.
  assert.equal(repo.getListing(listing.id, newcomerId)?.isMine, true);
});
