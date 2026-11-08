/**
 * Buscar obras del catálogo y editar la ficha de un ejemplar.
 *
 * La ficha bibliográfica cuelga de la **obra**, no de la copia: corregir una
 * errata en un ejemplar cambia el título de todas las copias del mismo libro y
 * tiene que reaparecer en las búsquedas. `searchBooks` alimenta el buscador
 * global y la elección de lectura de un club.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let dbModule: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

/** Parámetros del catálogo con solo lo que cambia en cada prueba. */
const catalogParams = (patch: Record<string, unknown> = {}) => ({
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
  ...patch,
});

function nuevaCuenta(nombre: string, email: string) {
  return repo.createUser({
    name: nombre,
    email,
    city: "Leipzig",
    passwordHash: "scrypt$00$00",
  });
}

function publicar(userId: string, title: string, author: string, isbn: string | null = null) {
  return repo.createListing(userId, {
    title,
    author,
    category: "Ficción",
    condition: "Buen estado",
    isbn,
    city: "Leipzig",
    tags: [],
  });
}

test("el catálogo va de diez en diez", async () => {
  const { PAGE_SIZE } = await import("../src/lib/repo/catalog.ts");
  assert.equal(PAGE_SIZE, 10, "diez tarjetas: dos filas completas de cinco columnas");

  const user = nuevaCuenta("Paginador", "paginador@example.test");
  for (let index = 1; index <= 12; index += 1) {
    publicar(user.id, `Paginador ${String(index).padStart(2, "0")}`, "Autora", null);
  }

  const primera = repo.catalogPage(null, catalogParams({ q: "paginador" }));
  assert.equal(primera.total, 12);
  assert.equal(primera.items.length, 10);
  assert.equal(primera.pageSize, 10);
  assert.equal(primera.hasMore, true);

  const segunda = repo.catalogPage(null, catalogParams({ q: "paginador", page: 2 }));
  assert.equal(segunda.items.length, 2);
  assert.equal(segunda.hasMore, false);
  // Ninguna tarjeta se repite entre páginas.
  const ids = new Set([...primera.items, ...segunda.items].map((listing) => listing.id));
  assert.equal(ids.size, 12);

  // Un enlace viejo con una página que ya no existe cae a la última real.
  const fuera = repo.catalogPage(null, catalogParams({ q: "paginador", page: 99 }));
  assert.equal(fuera.page, 2);
  assert.equal(fuera.items.length, 2);
});

test("el buscador ignora términos demasiado cortos y los comodines de SQL", () => {
  assert.deepEqual(repo.searchBooks(""), []);
  assert.deepEqual(repo.searchBooks(" a "), []);
  // `%` y `_` son comodines de `LIKE`: no deben convertirse en «todo».
  assert.deepEqual(repo.searchBooks("%%"), []);
  assert.deepEqual(repo.searchBooks("__"), []);
});

test("el buscador encuentra por título y por autoría sin acentos", () => {
  const user = nuevaCuenta("Buscador", "buscador@example.test");
  publicar(user.id, "El infinito en un junco", "Irene Vallejo", "9788417860790");

  const porTitulo = repo.searchBooks("infinito");
  assert.ok(porTitulo.some((book) => book.title === "El infinito en un junco"));

  const porAutor = repo.searchBooks("vallejo");
  assert.ok(porAutor.some((book) => book.author === "Irene Vallejo"));

  // Consulta con acento contra título sin acento y al revés.
  const conAcento = repo.searchBooks("infínito");
  assert.ok(conAcento.some((book) => book.title === "El infinito en un junco"));
});

test("el buscador devuelve primero los títulos que empiezan por el término", () => {
  const user = nuevaCuenta("Orden", "orden@example.test");
  publicar(user.id, "Der Vorleser", "Bernhard Schlink", null);
  publicar(user.id, "Der Prozess", "Franz Kafka", null);
  publicar(user.id, "Der", "Anónimo", null);

  const resultados = repo.searchBooks("der", 10);
  assert.ok(resultados.length >= 3);
  // El más corto y el que empieza por el término van delante.
  assert.equal(resultados[0]?.title, "Der");
  assert.ok(resultados.findIndex((book) => book.title === "Der Prozess") <
    resultados.findIndex((book) => book.title === "Der Vorleser"));

  // El límite se acota entre 1 y 20 aunque quien llama pida otra cosa.
  assert.equal(repo.searchBooks("der", 0).length, 1);
  assert.ok(repo.searchBooks("der", 100).length <= 20);
});

test("editar la ficha cambia el sello, el año y la colección de la obra", () => {
  const user = nuevaCuenta("Ficha", "ficha@example.test");
  const listing = publicar(user.id, "Libro con ficha", "Autora Ficha", "9783000000010");

  repo.editListing(user.id, listing.id, {
    condition: "Como nuevo",
    city: "Leipzig",
    notes: "",
    tags: [],
    publisher: "  Suhrkamp  ",
    year: "  1999 ",
    series: "  Bibliothek Suhrkamp  ",
  });

  const editado = repo.getListing(listing.id, user.id);
  assert.ok(editado);
  assert.equal(editado.publisher, "Suhrkamp", "se recortan los espacios");
  assert.equal(editado.year, "1999");
  assert.equal(editado.series, "Bibliothek Suhrkamp");

  // Un campo vacío vuelve a `null`, no a cadena vacía.
  repo.editListing(user.id, listing.id, {
    condition: "Como nuevo",
    city: "Leipzig",
    notes: "",
    tags: [],
    publisher: "   ",
    year: "",
    series: " ",
  });
  const limpio = repo.getListing(listing.id, user.id);
  assert.equal(limpio?.publisher, null);
  assert.equal(limpio?.year, null);
  assert.equal(limpio?.series, null);
});

test("corregir el título actualiza la búsqueda de todas las copias", () => {
  const primera = nuevaCuenta("Copia Uno", "copia-uno@example.test");
  const segunda = nuevaCuenta("Copia Dos", "copia-dos@example.test");
  // Mismo ISBN: las dos copias comparten obra.
  const mia = publicar(primera.id, "Titulo con errata", "Autora Compartida", "9783000000011");
  const suya = publicar(segunda.id, "Titulo con errata", "Autora Compartida", "9783000000011");

  repo.editListing(primera.id, mia.id, {
    condition: "Buen estado",
    city: "Leipzig",
    notes: "",
    tags: [],
    title: "Título corregido",
  });

  // La otra copia enseña la corrección: la ficha es de la obra.
  assert.equal(repo.getListing(suya.id, segunda.id)?.title, "Título corregido");

  // Y las dos entran en la búsqueda por el título nuevo.
  const encontrados = repo.searchBooks("corregido");
  assert.ok(encontrados.some((book) => book.title === "Título corregido"));
  const claves = dbModule
    .getDb()
    .prepare("SELECT search_key FROM listings WHERE book_id = (SELECT book_id FROM listings WHERE id = ?)")
    .all(mia.id) as { search_key: string }[];
  assert.equal(claves.length, 2, "las dos copias de la obra");
  for (const fila of claves) {
    assert.match(fila.search_key, /titulo corregido/, "sin tildes, como busca el catálogo");
  }
});

test("no se edita la ficha de un ejemplar ajeno ni de uno retirado", () => {
  const duena = nuevaCuenta("Dueña", "duena@example.test");
  const otra = nuevaCuenta("Otra", "otra@example.test");
  const listing = publicar(duena.id, "Solo mía", "Autora", null);

  assert.throws(
    () =>
      repo.editListing(otra.id, listing.id, {
        condition: "Buen estado",
        city: "Leipzig",
        notes: "",
        tags: [],
        title: "Robado",
      }),
    /Solo puedes editar tus publicaciones/,
  );

  repo.removeListing(duena.id, listing.id);
  assert.throws(
    () =>
      repo.editListing(duena.id, listing.id, {
        condition: "Buen estado",
        city: "Leipzig",
        notes: "",
        tags: [],
      }),
    /El ejemplar no existe/,
  );
});

test("las obras de una cuenta salen sin duplicados y sin las retiradas", () => {
  const user = nuevaCuenta("Estantería", "estanteria@example.test");
  const primera = publicar(user.id, "Misma obra A", "Autora", "9783000000012");
  const segunda = publicar(user.id, "Misma obra A", "Autora", "9783000000012");
  const tercera = publicar(user.id, "Otra obra B", "Autora", null);

  const libros = repo.listOwnerBooks(user.id);
  assert.deepEqual(
    libros.map((book) => book.title).sort(),
    ["Misma obra A", "Otra obra B"],
    "dos copias de la misma obra son un solo libro",
  );

  // Al retirar **una** copia, la obra sigue estando por la otra.
  repo.removeListing(user.id, primera.id);
  repo.setListingStatus(user.id, tercera.id, "paused");
  assert.deepEqual(
    repo.listOwnerBooks(user.id).map((book) => book.title).sort(),
    ["Misma obra A", "Otra obra B"],
    "una copia retirada no oculta las demás; una pausada sigue siendo suya",
  );

  // Retiradas todas sus copias, la obra desaparece de la lista.
  repo.removeListing(user.id, segunda.id);
  assert.deepEqual(repo.listOwnerBooks(user.id).map((book) => book.title), ["Otra obra B"]);
});
