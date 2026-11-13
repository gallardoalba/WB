/**
 * Ficha de un ISBN: DNB + Open Library en paralelo y fusión por campos.
 *
 * La publicación de un ejemplar no debería depender de que dos servicios
 * externos respondan. Lo que se fija aquí:
 *
 * - la DNB manda en título, autoría, idioma, sello, año y colección,
 * - Open Library rellena lo que falte y aporta la obra que agrupa ediciones,
 * - si una fuente falla, la otra sigue valiendo,
 * - si fallan las dos, el resultado es `null` y se recuerda un rato para no
 *   martillear los catálogos,
 * - una ficha encontrada se sirve de la caché sin volver a la red.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { cachedIsbnMetadata, fetchIsbnMetadata } from "../src/lib/isbn-metadata.ts";

type Llamada = { url: string };

async function conFetch<T>(
  responder: (url: string) => Response,
  run: (calls: Llamada[]) => Promise<T>,
): Promise<T> {
  const calls: Llamada[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push({ url });
    return responder(url);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const sinRespuesta = () => new Response("{}", { status: 500 });

const MARC = `
  <record>
    <numberOfRecords>1</numberOfRecords>
    <datafield tag="041"><subfield code="a">ger</subfield></datafield>
    <datafield tag="082"><subfield code="a">830</subfield></datafield>
    <datafield tag="100"><subfield code="a">Emcke, Carolin</subfield><subfield code="e">Verfasser</subfield></datafield>
    <datafield tag="245"><subfield code="a">Der Titel</subfield></datafield>
    <datafield tag="264"><subfield code="b">Rowohlt</subfield><subfield code="c">2000</subfield></datafield>
    <datafield tag="490"><subfield code="a">Rororo</subfield><subfield code="v">12</subfield></datafield>
  </record>
`;

const tagsFor = (category: string | null, subjects: readonly string[]) =>
  [category ?? "sin categoría", `materias:${subjects.length}`].slice(0, 3);

test("la DNB manda y Open Library aporta la obra y los temas", async () => {
  const isbn = "9783000000001";
  const resultado = await conFetch(
    (url) => {
      if (url.includes("services.dnb.de")) return new Response(MARC, { status: 200 });
      if (url.includes("openlibrary.org/api/books")) {
        return json({
          [`ISBN:${isbn}`]: {
            title: "Open Title",
            authors: [{ name: "Ana Open" }],
            subjects: [{ name: "Fiction" }, { name: "Books" }],
            publishers: [{ name: "OL Press" }],
            publish_date: "1999",
          },
        });
      }
      if (url.includes("openlibrary.org/isbn/")) {
        return json({
          number_of_pages: 318,
          languages: [{ key: "/languages/ger" }],
          works: [{ key: "/works/OL42W" }],
        });
      }
      if (url.includes("openlibrary.org/works/")) {
        return json({ description: "<p>Una sinopsis de la <i>obra</i>.</p>" });
      }
      return sinRespuesta();
    },
    async (calls) => {
      const ficha = await fetchIsbnMetadata(isbn, tagsFor);
      assert.ok(ficha);
      assert.equal(ficha.source, "dnb+openlibrary");
      // Título, autoría, idioma, sello, año y colección son los de la DNB.
      assert.equal(ficha.title, "Der Titel");
      assert.deepEqual(ficha.authors, ["Carolin Emcke"]);
      assert.equal(ficha.language, "Alemán");
      assert.equal(ficha.publisher, "Rowohlt");
      assert.equal(ficha.year, "2000");
      assert.equal(ficha.series, "Rororo 12");
      // La DDC dice que es narrativa y Open Library aporta la obra.
      assert.equal(ficha.category, "Ficción");
      assert.equal(ficha.workId, "/works/OL42W");
      assert.deepEqual(ficha.tags, ["Ficción", "materias:3"]);
      // Páginas de la edición y sinopsis de la obra, en texto plano.
      assert.equal(ficha.pages, 318);
      assert.equal(ficha.description, "Una sinopsis de la obra.");
      assert.equal(calls.length, 4, "una consulta a la DNB y tres a Open Library");
      return ficha;
    },
  );

  // La segunda vez sale de la caché: publicar dos ejemplares del mismo libro no
  // repite las consultas.
  await conFetch(
    () => {
      throw new Error("no debería salir a la red");
    },
    async () => {
      const segunda = await fetchIsbnMetadata(isbn, tagsFor);
      assert.deepEqual(segunda, resultado);
      assert.deepEqual(cachedIsbnMetadata(isbn), resultado);
    },
  );
});

test("si la DNB no responde, Open Library sostiene la ficha", async () => {
  const isbn = "9783000000002";
  await conFetch(
    (url) => {
      if (url.includes("services.dnb.de")) return sinRespuesta();
      if (url.includes("openlibrary.org/api/books")) {
        return json({
          [`ISBN:${isbn}`]: {
            title: "Open Title",
            authors: [{ name: "Ana Open" }],
            subjects: [{ name: "Fiction" }],
            publishers: [{ name: "OL Press" }],
            publish_date: "1999",
          },
        });
      }
      return json({
        subtitle: "Subtítulo",
        languages: [{ key: "/languages/eng" }],
        works: [{ key: "/works/OL7W" }],
      });
    },
    async () => {
      const ficha = await fetchIsbnMetadata(isbn, tagsFor);
      assert.ok(ficha);
      assert.equal(ficha.source, "openlibrary");
      assert.equal(ficha.title, "Open Title: Subtítulo");
      assert.deepEqual(ficha.authors, ["Ana Open"]);
      assert.equal(ficha.language, "Inglés");
      assert.equal(ficha.publisher, "OL Press");
      assert.equal(ficha.year, "1999");
      assert.equal(ficha.series, null, "la colección solo la da un catálogo nacional");
      assert.equal(ficha.workId, "/works/OL7W");
      // Sin DDC, la categoría sale de los temas de Open Library.
      assert.equal(ficha.category, "Ficción");
    },
  );
});

test("si fallan las dos fuentes no hay ficha, y el «no está» se recuerda", async () => {
  const isbn = "9783000000003";
  await conFetch(
    () => sinRespuesta(),
    async (calls) => {
      assert.equal(await fetchIsbnMetadata(isbn, tagsFor), null);
      assert.equal(cachedIsbnMetadata(isbn), null);
      const consultas = calls.length;
      assert.equal(consultas, 3);

      // Dentro del tiempo del «no está», no se repite la consulta.
      assert.equal(await fetchIsbnMetadata(isbn, tagsFor), null);
      assert.equal(calls.length, consultas);
    },
  );
});

test("un registro con cero resultados no bloquea a la otra fuente", async () => {
  const isbn = "9783000000004";
  await conFetch(
    (url) => {
      if (url.includes("services.dnb.de")) {
        // La DNB responde 200 pero sin el registro pedido.
        return new Response("<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>", {
          status: 200,
        });
      }
      if (url.includes("openlibrary.org/api/books")) {
        return json({
          [`ISBN:${isbn}`]: { title: "Solo Open Library", authors: [{ name: "Autora" }] },
        });
      }
      return json({});
    },
    async () => {
      const ficha = await fetchIsbnMetadata(isbn, tagsFor);
      assert.ok(ficha);
      assert.equal(ficha.source, "openlibrary");
      assert.equal(ficha.title, "Solo Open Library");
      assert.equal(ficha.language, null);
      assert.equal(ficha.workId, null);
    },
  );
});

test("un registro MARC sin campos útiles se trata como «sin datos»", async () => {
  const isbn = "9783000000005";
  await conFetch(
    (url) => {
      if (url.includes("services.dnb.de")) {
        return new Response("<record><numberOfRecords>1</numberOfRecords></record>", {
          status: 200,
        });
      }
      return sinRespuesta();
    },
    async () => {
      assert.equal(await fetchIsbnMetadata(isbn, tagsFor), null);
    },
  );
});
