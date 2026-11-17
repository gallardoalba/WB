/**
 * Cuánto cuesta crear una base desde cero.
 *
 *   npm run bench:migrate
 *
 * No es una prueba: es la medida que decide si la escalera de migraciones es
 * solo deuda de mantenimiento o también un problema operativo en cada
 * instalación nueva. Antes de plantear un squash, este número dice cuánto se
 * gana y a partir de qué versión merece la pena.
 */
import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

const RUNS = Number(process.env.RUNS ?? 20);

const times: number[] = [];
for (let run = 0; run < RUNS; run += 1) {
  const db = new Database(":memory:");
  const started = performance.now();
  migrate(db);
  times.push(performance.now() - started);
  db.close();
}

times.sort((a, b) => a - b);
const percentile = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];

console.log(
  `migrate() sobre base vacía · ${RUNS} pasadas · v${SCHEMA_VERSION} (${SCHEMA_VERSION - 2} escalones)`,
);
console.log(
  `  p50 ${percentile(0.5).toFixed(1)} ms · p95 ${percentile(0.95).toFixed(1)} ms · máx ${times[times.length - 1].toFixed(1)} ms`,
);
