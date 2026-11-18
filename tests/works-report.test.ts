/**
 * El informe de agrupación (`npm run db:works`) es lo que decide si la
 * heurística de obra sirve: cuenta ediciones por obra, avisa de claves que
 * unen títulos distintos (colisión) y de títulos repartidos en varias claves
 * (obra sin agrupar). Si el informe se equivoca, las decisiones se toman con
 * datos falsos.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeWorks, formatReport, type WorkRow } from "../scripts/works-report.ts";

function row(id: string, title: string, author: string, workKey: string | null): WorkRow {
  return { id, title, author, work_key: workKey };
}

test("cuenta ediciones por obra y separa las claves externas de las derivadas", () => {
  const report = analyzeWorks([
    row("bok_a", "Don Quijote de la Mancha", "Miguel de Cervantes", "t:dq"),
    row("bok_b", "Don Quijote de la Mancha", "Miguel de Cervantes", "t:dq"),
    row("bok_c", "Ulises", "James Joyce", "ol:OL123W"),
  ]);

  assert.equal(report.books, 3);
  assert.equal(report.works, 2);
  assert.deepEqual(report.bySource, { ol: 1, title: 1, ninguna: 0 });
  assert.equal(report.grouped.length, 1);
  assert.equal(report.grouped[0].editions.length, 2);
});

test("un subtítulo no parte la obra, pero dos títulos distintos sí se denuncian", () => {
  const report = analyzeWorks([
    row("bok_a", "Don Quijote de la Mancha", "Cervantes", "t:dq"),
    row("bok_b", "Don Quijote de la Mancha: edición conmemorativa", "Cervantes", "t:dq"),
    row("bok_c", "El Quijote apócrifo", "Avellaneda", "t:dq"),
  ]);

  // Los dos primeros son el mismo título principal; el tercero no.
  assert.deepEqual(report.suspicious[0].titles.sort(), [
    "don quijote de la mancha",
    "el quijote apocrifo",
  ]);
});

test("el mismo título en claves distintas se señala como obra sin agrupar", () => {
  const report = analyzeWorks([
    row("bok_a", "Rayuela", "Julio Cortázar", "t:rayuela-1"),
    row("bok_b", "Rayuela", "Cortázar, Julio", "t:rayuela-2"),
  ]);

  assert.equal(report.split.length, 1);
  assert.equal(report.split[0].title, "rayuela");
  assert.deepEqual(report.split[0].keys.sort(), ["t:rayuela-1", "t:rayuela-2"]);
});

test("una edición sin clave es su propia obra, no se mezcla con las demás", () => {
  const report = analyzeWorks([
    row("bok_a", "Sin clave uno", "Autora", null),
    row("bok_b", "Sin clave dos", "Autor", null),
  ]);

  assert.equal(report.works, 2);
  assert.equal(report.grouped.length, 0);
  assert.equal(report.withoutKey, 2);
});

test("el informe escrito dice lo que hay, sin inventar agrupaciones", () => {
  const report = analyzeWorks([
    row("bok_a", "Rayuela", "Julio Cortázar", "t:rayuela-1"),
    row("bok_b", "Rayuela", "Cortázar, Julio", "t:rayuela-2"),
  ]);
  const text = formatReport(report);

  assert.match(text, /2 ediciones en 2 obras/);
  assert.match(text, /Posibles obras sin agrupar/);
  assert.doesNotMatch(text, /colisión/i);
});
