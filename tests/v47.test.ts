/**
 * Catálogo público y metadatos para buscadores.
 *
 * Lo que se publica sin sesión son obras y cifras: ni el nombre, ni el id, ni el
 * perfil de quien ofrece el ejemplar. Estas pruebas fijan esa frontera, porque
 * es fácil romperla sin darse cuenta al añadir un campo a la consulta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

const ROOT = path.join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const params = (overrides: Partial<Record<string, unknown>> = {}) => ({
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

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("solo se publican obras con al menos un ejemplar disponible", () => {
  const works = repo.listPublicWorks();
  assert.ok(works.length > 0, "el catálogo público está vacío");
  for (const work of works) {
    assert.ok(work.copies > 0, `«${work.title}» se publica sin ejemplares`);
    assert.equal(
      work.copies,
      work.cities.reduce((sum, city) => sum + city.copies, 0),
      `las ciudades de «${work.title}» no suman sus ejemplares`,
    );
  }
  // «Gott und der Staat» ya se entregó: su obra no entra en el índice.
  assert.deepEqual(
    works.filter((work) => work.title === "Gott und der Staat"),
    [],
  );
});

test("la ficha pública no lleva ningún dato de quien ofrece el libro", () => {
  const work = repo.listPublicWorks()[0]!;
  assert.deepEqual(Object.keys(work).sort(), [
    "author",
    "category",
    "cities",
    "copies",
    "coverUrl",
    "id",
    "isbn",
    "language",
    "publisher",
    "series",
    "title",
    "year",
  ]);
  const publico = JSON.stringify(repo.listPublicWorks());
  for (const id of ["usr_marcos", "usr_clara", "usr_diego", "usr_ines"]) {
    assert.ok(!publico.includes(id), `el id ${id} viaja en el catálogo público`);
  }
});

test("las ciudades salen agregadas, sin repetir y de más a menos", () => {
  for (const work of repo.listPublicWorks()) {
    const names = work.cities.map((city) => city.city);
    assert.equal(new Set(names).size, names.length, `«${work.title}» repite ciudad`);
    const counts = work.cities.map((city) => city.copies);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  }
});

test("cualquier edición resuelve a la obra y un id desconocido no revienta", () => {
  const { items } = repo.catalogPage(null, params());
  assert.ok(items.length > 0);
  for (const item of items.filter((row) => row.status === "available")) {
    const work = repo.getPublicWork(item.bookId);
    assert.ok(work, `«${item.title}» no se encuentra por su obra`);
    assert.ok(
      work.cities.some((city) => city.city === item.city),
      `la ciudad de «${item.title}» no aparece en su ficha pública`,
    );
  }
  assert.equal(repo.getPublicWork("bok_inexistente"), null);
});

test("la portada declara canonical y el layout ya no lo hereda", () => {
  // Con `alternates` en el layout, toda página que no lo definía se anunciaba
  // como duplicado de la portada. Ahora la portada lo pide al ayudante de SEO,
  // que añade además los `hreflang` de los tres idiomas.
  assert.match(read("src/app/page.tsx"), /alternatesFor\(await getLocale\(\), "\/"\)/);
  assert.doesNotMatch(read("src/app/layout.tsx"), /^\s*alternates:/m);
});

test("la tarjeta social usa la imagen grande y el sitio publica su entidad", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /card:\s*"summary_large_image"/);
  assert.ok(layout.includes('"@type": "Organization"'));
  assert.ok(layout.includes("siteSchema"));
});

test("robots deja rastrear el catálogo público y no el resto", () => {
  const robots = read("src/app/robots.ts");
  assert.ok(!robots.includes('"/werk'));
  assert.ok(!robots.includes('"/buecher"'));
  for (const privada of ['"/libro/"', '"/u/"', '"/ofrecer"']) {
    assert.ok(robots.includes(privada), `robots.txt debería bloquear ${privada}`);
  }
});

test("el sitemap anuncia las fichas de obra y no la vieja URL del catálogo", () => {
  const sitemap = read("src/app/sitemap.ts");
  assert.ok(sitemap.includes("/werk/"));
  // `/buecher` solo sobrevive como redirección a `/descubrir`.
  assert.ok(!sitemap.includes("/buecher"));
});

test("el catálogo (Descubrir) se ve sin sesión", () => {
  const view = read("src/app/app-view.tsx");
  assert.match(view, /PUBLIC_VIEWS[^=]*=\s*\["home", "discover"\]/);
});

test("las vistas con sesión llevan noindex aunque respondan 200", () => {
  const proxy = read("src/proxy.ts");
  assert.ok(proxy.includes("X-Robots-Tag"));
  assert.ok(proxy.includes("PRIVATE_PREFIXES"));
});

test("una lista se publica sin firma salvo que quien la crea lo acepte", () => {
  const list = repo.createReadingList("usr_ana", {
    title: "Lista para probar la firma",
    description: "",
  });
  assert.equal(list.showOwner, false, "por defecto no se firma en público");

  repo.updateReadingList("usr_ana", list.id, {
    title: "Lista para probar la firma",
    description: "",
    showOwner: true,
  });
  assert.equal(repo.getReadingList(list.id, null)?.showOwner, true);
});

test("la edición corrige la ficha de la obra y recalcula la búsqueda", () => {
  const listing = repo.catalogPage(null, params()).items[0];
  assert.ok(listing, "el catálogo de demostración está vacío");

  repo.editListing(listing.owner.id, listing.id, {
    condition: listing.condition,
    city: listing.city,
    notes: "",
    tags: [],
    title: "Die Antiquiertheit der Menschen",
    author: "Günther Anders",
    category: "Humanidades",
    language: "Alemán",
    publisher: "C. H. Beck",
    year: "1980",
    series: "Beck'sche Reihe 12",
  });

  const updated = repo.getListing(listing.id, null);
  assert.equal(updated?.title, "Die Antiquiertheit der Menschen");
  assert.equal(updated?.author, "Günther Anders");
  assert.equal(updated?.publisher, "C. H. Beck");
  assert.equal(updated?.year, "1980");
  assert.equal(updated?.series, "Beck'sche Reihe 12");

  // `search_key` se recalcula en todas las copias: el título nuevo se encuentra.
  const found = repo.catalogPage(null, params({ q: "Antiquiertheit" }));
  assert.ok(found.items.some((item) => item.id === listing.id));
});
