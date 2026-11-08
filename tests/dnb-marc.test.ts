/**
 * Detalles del registro MARC21 de la DNB.
 *
 * `v36` fija el caso real completo; aquí se cubren las decisiones que se toman
 * con registros raros: subtítulos promocionales, colecciones sin número, años
 * que no son un año, materias que marcan ficción y autorías repetidas o con
 * roles que no son de autoría.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDnbCreator, parseMarcRecord, stripQuotes } from "../src/lib/isbn-metadata.ts";

/** Envuelve los campos en un registro mínimo con título. */
const registron = (...campos: string[]) =>
  parseMarcRecord(`<record>${campos.join("")}</record>`);

const campo = (tag: string, ...subcampos: [string, string][]) =>
  `<datafield tag="${tag}">${subcampos
    .map(([code, value]) => `<subfield code="${code}">${value}</subfield>`)
    .join("")}</datafield>`;

test("un subtítulo corto acompaña al título y uno largo se descarta", () => {
  const corto = registron(
    campo("245", ["a", "El infinito en un junco"], ["b", "ensayo"]),
  );
  assert.equal(corto?.title, "El infinito en un junco: ensayo");

  const largo = registron(
    campo("245", ["a", "Historia de España"], ["b", "x".repeat(71)]),
  );
  assert.equal(largo?.title, "Historia de España", "el texto promocional no ensucia la ficha");

  const justo = registron(
    campo("245", ["a", "Historia de España"], ["b", "y".repeat(70)]),
  );
  assert.equal(justo?.title, `Historia de España: ${"y".repeat(70)}`, "70 caracteres sí entran");
});

test("la colección sale de 490 o, si falta, de 830", () => {
  assert.equal(
    registron(campo("245", ["a", "T"]), campo("490", ["a", "Rororo"], ["v", "22530"]))?.series,
    "Rororo 22530",
  );
  assert.equal(
    registron(campo("245", ["a", "T"]), campo("830", ["a", "Suhrkamp Taschenbuch"], ["v", "12"]))
      ?.series,
    "Suhrkamp Taschenbuch 12",
    "830 es el respaldo cuando no hay 490",
  );
  assert.equal(
    registron(campo("245", ["a", "T"]), campo("490", ["a", "Serie sin número"]))?.series,
    "Serie sin número",
  );
  assert.equal(registron(campo("245", ["a", "T"]))?.series, null);
});

test("del año se toma el primer número de cuatro cifras", () => {
  assert.equal(registron(campo("245", ["a", "T"]), campo("264", ["c", "c2001"]))?.year, "2001");
  assert.equal(
    registron(campo("245", ["a", "T"]), campo("264", ["c", "[2020?]"]))?.year,
    "2020",
    "los corchetes de la DNB no estorban",
  );
  // Sin cifras no se inventa un año, pero tampoco se pierde lo que dijo el registro.
  assert.equal(registron(campo("245", ["a", "T"]), campo("264", ["c", "o. J."]))?.year, "o. J.");
  assert.equal(registron(campo("245", ["a", "T"]))?.year, null);
});

test("la Sachgruppe «f» marca la obra como narrativa", () => {
  const marc = registron(
    campo("245", ["a", "Novela"]),
    campo("689", ["a", "Belletristik"], ["A", "f"]),
  );
  assert.ok(marc?.subjects?.includes("Belletristik"));
});

test("la autoría se deduplica, se recorta a tres y descarta otros roles", () => {
  const marc = registron(
    campo("245", ["a", "T"]),
    campo("100", ["a", "Emcke, Carolin"], ["e", "Verfasser"]),
    campo("700", ["a", "Emcke, Carolin"], ["e", "Verfasser"]),
    campo("700", ["a", "Rudnik, Katja"], ["e", "Übersetzer"]),
    campo("700", ["a", "Uno, Ana"], ["e", "Verfasser"]),
    campo("700", ["a", "Dos, Luis"], ["e", "Verfasser"]),
    campo("700", ["a", "Tres, Eva"], ["e", "Verfasser"]),
  );
  assert.deepEqual(marc?.authors, ["Carolin Emcke", "Ana Uno", "Luis Dos"]);
});

test("los idiomas de 041 llegan como lista (y no se inventan si faltan)", () => {
  assert.deepEqual(
    registron(campo("245", ["a", "T"]), campo("041", ["a", "ger"], ["a", "eng"]))?.languages,
    ["ger", "eng"],
  );
  assert.deepEqual(registron(campo("245", ["a", "T"]))?.languages, []);
});

test("las entidades XML del registro se descodifican en el título y el sello", () => {
  const marc = registron(
    campo("245", ["a", "Tom &amp; Jerry &lt;nº 1&gt;"]),
    campo("264", ["b", "&#152;Acme&#156; &amp; Cía."]),
  );
  assert.equal(marc?.title, 'Tom & Jerry <nº 1>');
  assert.equal(marc?.publisher, "Acme & Cía.", "las comillas bibliográficas se van del sello");
});

test("una cita dentro del título no se corta a la mitad", () => {
  // Regresión: antes se borraba la última comilla recta aunque cerrara una
  // palabra citada, y la ficha quedaba «El "Quijote».
  const marc = registron(campo("245", ["a", "El &quot;Quijote&quot;"]));
  assert.equal(marc?.title, 'El "Quijote"');

  const envuelto = registron(campo("245", ["a", '&quot;Gegen den Hass&quot;']));
  assert.equal(envuelto?.title, "Gegen den Hass", "si envuelven todo el valor, sí se quitan");
});

test("sin 245 no hay ficha; los campos vacíos tampoco fabrican datos", () => {
  assert.equal(registron(campo("264", ["b", "Editorial"])), null);
  assert.equal(registron(campo("245", ["a", "   "])), null);

  const vacio = registron(campo("245", ["a", "Solo título"]));
  assert.deepEqual(vacio?.authors, []);
  assert.equal(vacio?.publisher, null);
  assert.equal(vacio?.series, null);
  assert.deepEqual(vacio?.subjects, []);
});

test("comillas y roles sueltos de la DNB", () => {
  assert.equal(stripQuotes("«Sin comillas»"), "Sin comillas");
  assert.equal(stripQuotes("„Ya limpio“"), "Ya limpio");
  // Un único nombre sin coma no se rompe.
  assert.equal(parseDnbCreator("Aristóteles"), "Aristóteles");
  assert.equal(parseDnbCreator(" [Verfasser] "), null);
  assert.equal(parseDnbCreator("Pérez, José [Herausgeber]"), null, "editar no es escribir");
  assert.equal(parseDnbCreator("Pérez, José [Herausgeber] [Verfasser]"), "José Pérez");
});
