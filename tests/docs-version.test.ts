/**
 * La versión del esquema se escribe una vez.
 *
 * `/techdoc` interpola `SCHEMA_VERSION` en los tres idiomas, pero
 * `DOCUMENTATION.md` es texto estático: sin esta prueba se queda atrás en
 * silencio: ya decía v53 con el código en v54. `contracts.test.ts` vigila el
 * rango del árbol y las cifras; aquí se comprueba la versión interpolada y el
 * número de escalones.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";
import { technicalDocument } from "../src/lib/technical.ts";

const ROOT = process.cwd();

/** La instalación nueva nace en la v2: los escalones son de la v3 a la actual. */
const STEPS = SCHEMA_VERSION - 2;

const VERSION_MARKER: Record<"es" | "de" | "en", string> = {
  es: `(actual: v${SCHEMA_VERSION})`,
  de: `(aktuell: v${SCHEMA_VERSION})`,
  en: `(current: v${SCHEMA_VERSION})`,
};

function countMigrationSteps(): number {
  const source = readFileSync(path.join(ROOT, "src/lib/db/migrations.ts"), "utf8");
  return (source.match(/^function migrateToV\d+\(/gm) ?? []).length;
}

test("la página técnica usa la versión vigente en los tres idiomas", () => {
  for (const locale of ["es", "de", "en"] as const) {
    const doc = JSON.stringify(technicalDocument(locale));
    assert.ok(doc.includes(VERSION_MARKER[locale]), `${locale}: falta «${VERSION_MARKER[locale]}»`);
    assert.ok(
      doc.includes(`${STEPS} escalones`) ||
        doc.includes(`${STEPS} Stufen`) ||
        doc.includes(`${STEPS} steps`),
      `${locale}: falta el recuento de ${STEPS} pasos`,
    );
  }
});

test("DOCUMENTATION.md coincide con el código", () => {
  const doc = readFileSync(path.join(ROOT, "DOCUMENTATION.md"), "utf8");

  const version = /currently v(\d+)/.exec(doc);
  assert.ok(version, "falta «currently vN» en DOCUMENTATION.md");
  assert.equal(Number(version[1]), SCHEMA_VERSION, "la versión del esquema y la del documento difieren");

  const steps = /runs the (\d+) steps up to v(\d+)/.exec(doc);
  assert.ok(steps, "falta «runs the N steps up to vM» en DOCUMENTATION.md");
  assert.equal(Number(steps[1]), STEPS);
  assert.equal(Number(steps[2]), SCHEMA_VERSION);

  assert.equal(countMigrationSteps(), STEPS, "hay escalones definidos que no cuadran con la versión");
});
