/**
 * Techo medido de SQLite para esta aplicación.
 *
 *   npm run bench:sqlite
 *
 * No es una prueba (`npm test`): es un termómetro. Sirve para tener números
 * propios antes de decidir si el despliegue aguanta o si toca PostgreSQL, en
 * lugar de repetir la frase «SQLite aguanta mucho».
 *
 * Mide sobre una base temporal con la MISMA configuración que la aplicación
 * (WAL, `synchronous=NORMAL`, `secure_delete=ON`) y la misma conexión de
 * `getDb()` (con su caché de sentencias):
 *  1. escrituras sueltas (una transacción por escritura, como una petición real),
 *  2. escrituras en lote dentro de una transacción,
 *  3. lecturas con filtro y orden sobre 5 000 filas, sin índice (el peor caso:
 *     un catálogo grande se parece más a esto que a una búsqueda por clave),
 *  4. lecturas por clave primaria,
 *  5. lectores de verdad (hilos con su propia conexión) mientras se escribe.
 */
process.env.WANDERBIBLIOTHEK_DB = process.env.BENCH_DB ?? "/tmp/wb-bench/app.db";
process.env.SEED_DEMO = process.env.SEED_DEMO ?? "0";

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { getDb } from "../src/lib/db/index.ts";

const directory = path.dirname(process.env.WANDERBIBLIOTHEK_DB);
rmSync(process.env.WANDERBIBLIOTHEK_DB, { force: true });
rmSync(`${process.env.WANDERBIBLIOTHEK_DB}-wal`, { force: true });
rmSync(`${process.env.WANDERBIBLIOTHEK_DB}-shm`, { force: true });
mkdirSync(directory, { recursive: true });

const db = getDb();

function time(label: string, run: () => void, units: number, unitName: string) {
  const started = performance.now();
  run();
  const ms = performance.now() - started;
  const perSecond = Math.round((units / ms) * 1000);
  console.log(
    `${label.padEnd(46)} ${perSecond.toString().padStart(7)} ${unitName}/s  (${ms.toFixed(0)} ms)`,
  );
  return perSecond;
}

db.exec(`
  DROP TABLE IF EXISTS bench_rows;
  CREATE TABLE bench_rows (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    city TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const insert = db.prepare(
  "INSERT INTO bench_rows (id, listing_id, city, title, created_at) VALUES (?, ?, ?, ?, ?)",
);
const CITIES = ["Stuttgart", "Karlsruhe", "Freiburg", "Mannheim", "Ulm"];
const N = 5_000;

console.log(`\nSQLite · ${process.env.WANDERBIBLIOTHEK_DB}`);

time(
  "escrituras sueltas (1 transacción cada una)",
  () => {
    for (let i = 0; i < N; i += 1) {
      insert.run(`b${i}`, `l${i % 400}`, CITIES[i % CITIES.length]!, `Título ${i}`, new Date().toISOString());
    }
  },
  N,
  "filas",
);

time(
  "escrituras en lote (1 transacción por 200)",
  () => {
    for (let block = 0; block < 5; block += 1) {
      db.transaction(() => {
        for (let i = 0; i < 200; i += 1) {
          const n = N + block * 200 + i;
          insert.run(`b${n}`, `l${n % 400}`, CITIES[n % CITIES.length]!, `Título ${n}`, new Date().toISOString());
        }
      })();
    }
  },
  1_000,
  "filas",
);

const byCity = db.prepare(
  `SELECT listing_id, title FROM bench_rows WHERE city = ? ORDER BY created_at DESC LIMIT 24`,
);
time("lecturas con filtro y orden, sin índice", () => {
  for (let i = 0; i < N; i += 1) byCity.all(CITIES[i % CITIES.length]!);
}, N, "consultas");

const oneRow = db.prepare("SELECT * FROM bench_rows WHERE id = ?");
time("lecturas por clave primaria", () => {
  for (let i = 0; i < N; i += 1) oneRow.get(`b${i % 1_000}`);
}, N, "consultas");

// El bloque de concurrencia usa `await`: se ejecuta en una función aparte
// porque el proyecto compila a CommonJS, donde el await de nivel superior no vale.
void (async () => {
  // Lectores de verdad, en hilos aparte: WAL deja leer mientras se escribe, pero
  // es una propiedad del MODO de diario, no del proceso, así que hay que medirla
  // con conexiones separadas.
  const READER_WORKERS = 4;
  const SEGUNDOS = 1.5;

  const readerCode = `
  const { parentPort, workerData } = require("node:worker_threads");
  const Database = require("better-sqlite3");
  const db = new Database(workerData.file, { readonly: true, timeout: 5_000 });
  const stmt = db.prepare("SELECT COUNT(*) AS n FROM bench_rows WHERE city = ?");
  const end = Date.now() + workerData.ms;
  let ops = 0;
  while (Date.now() < end) {
    stmt.get("Stuttgart");
    ops += 1;
  }
  parentPort.postMessage(ops);
  `;

  const readCounts: Promise<number>[] = [];
  for (let i = 0; i < READER_WORKERS; i += 1) {
    const worker = new Worker(readerCode, {
      eval: true,
      workerData: { file: process.env.WANDERBIBLIOTHEK_DB, ms: SEGUNDOS * 1_000 },
    });
    readCounts.push(
      new Promise<number>((resolve, reject) => {
        worker.on("message", (value: number) => resolve(value));
        worker.on("error", reject);
      }),
    );
  }

  let commitments = 0;
  const writeDeadline = performance.now() + SEGUNDOS * 1_000;
  while (performance.now() < writeDeadline) {
    insert.run(`w${commitments}`, "lw", "Stuttgart", `Escritura ${commitments}`, new Date().toISOString());
    commitments += 1;
  }
  const reads = (await Promise.all(readCounts)).reduce((total, value) => total + value, 0);

  console.log(
    `\ncon ${READER_WORKERS} lectores + 1 escritor (${SEGUNDOS}s): ` +
      `${Math.round(commitments / SEGUNDOS)} escrituras/s y ` +
      `${Math.round(reads / SEGUNDOS)} lecturas/s a la vez`,
  );
  console.log(
    "WAL no bloquea a quien lee; los escritores se ponen en cola (uno solo).",
  );

  db.exec("DROP TABLE bench_rows;");
  db.close();
  console.log("\nListo. Estas cifras son de este equipo, no del servidor: repite allí.\n");
})();
