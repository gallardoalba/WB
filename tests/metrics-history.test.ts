/**
 * Histórico del panel de estadísticas.
 *
 * Lo que se fija: una foto se guarda y se recupera, la purga respeta lo
 * reciente, la sparkline no se rompe con huecos y las métricas de host no
 * lanzan. No se prueba el HTML del panel: eso lo cubre el build y el e2e.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type History = typeof import("../src/lib/metrics-history.ts");
type DbModule = typeof import("../src/lib/db/index.ts");
type Spark = typeof import("../src/lib/sparkline.ts");
type Host = typeof import("../src/lib/host-metrics.ts");

let history: History;
let dbModule: DbModule;
let spark: Spark;
let host: Host;

before(async () => {
  history = await import("../src/lib/metrics-history.ts");
  dbModule = await import("../src/lib/db/index.ts");
  spark = await import("../src/lib/sparkline.ts");
  host = await import("../src/lib/host-metrics.ts");
});

function clearSamples(): void {
  dbModule.getDb().prepare("DELETE FROM metrics_samples").run();
}

test("guarda una muestra y la recupera", () => {
  clearSamples();
  const at = new Date("2026-11-23T10:00:00.000Z");
  const sample = history.recordMetricsSample(at);

  assert.equal(sample.at, at.toISOString());
  assert.equal(sample.schemaVersion, dbModule.SCHEMA_VERSION);
  assert.ok(sample.rssBytes > 0);
  assert.ok(sample.dbBytes >= 0);

  const list = history.listMetricsSamples(new Date("2026-11-23T00:00:00.000Z"));
  assert.equal(list.length, 1);
  assert.equal(list[0]!.at, sample.at);
});

test("la ventana reciente encuentra las muestras de las últimas horas", () => {
  clearSamples();
  history.recordMetricsSample(new Date());
  assert.equal(history.listRecentMetricsSamples(24).length, 1);
  assert.equal(history.listRecentMetricsSamples(1).length, 1);
});

test("la purga borra solo las muestras antiguas", () => {
  clearSamples();
  const db = dbModule.getDb();
  db.prepare("INSERT INTO metrics_samples (id, created_at, payload) VALUES (?, ?, ?)").run(
    "met_old",
    "2020-01-01T00:00:00.000Z",
    "{}",
  );
  history.recordMetricsSample(new Date("2026-11-23T10:00:00.000Z"));

  assert.equal(history.purgeMetricsSamples(30, new Date("2026-11-23T12:00:00.000Z")), 1);
  assert.equal(history.listMetricsSamples(new Date("2019-01-01T00:00:00.000Z")).length, 1);
});

test("encuentra la copia de seguridad más reciente", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-backups-"));
  writeFileSync(path.join(dir, "wanderbibliothek-2026-11-23.db.enc"), "x");
  const previous = process.env.WANDERBIBLIOTHEK_BACKUP_DIR;
  process.env.WANDERBIBLIOTHEK_BACKUP_DIR = dir;
  try {
    const at = history.latestBackupAt();
    assert.ok(at, "tiene que encontrar la copia");
    assert.ok(Number.isFinite(Date.parse(at!)));
  } finally {
    if (previous === undefined) delete process.env.WANDERBIBLIOTHEK_BACKUP_DIR;
    else process.env.WANDERBIBLIOTHEK_BACKUP_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("la sparkline normaliza los puntos y respeta los huecos", () => {
  assert.equal(spark.sparklinePoints([]), "");
  assert.equal(spark.sparklinePoints([1]), "");

  const points = spark.sparklinePoints([1, null, 3]).split(" ");
  assert.equal(points.length, 2);
  assert.match(points[0]!, /^0\.00,/);
  assert.match(points[1]!, /^100\.00,/);

  const flat = spark.sparklinePoints([2, 2, 2]).split(" ");
  assert.equal(flat.length, 3);
  assert.ok(flat.every((point) => point.endsWith(",20.00")));
});

test("las métricas de host son utilizables y no lanzan", () => {
  const first = host.hostMetrics();
  assert.ok(first.totalMemBytes > 0);
  assert.ok(first.freeMemBytes >= 0);
  assert.ok(first.cpuCount > 0);
  assert.ok(first.load1 === null || Number.isFinite(first.load1));
  assert.ok(first.diskFreeBytes === null || first.diskFreeBytes >= 0);

  const second = host.hostMetrics(Date.now() + 1_000);
  assert.ok(
    second.processCpuRatio === null ||
      (second.processCpuRatio >= 0 && second.processCpuRatio <= 1),
  );
});
