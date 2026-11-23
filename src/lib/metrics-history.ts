/**
 * Histórico de métricas para el panel nativo de administración.
 *
 * Prometheus y Grafana no hacen falta para una instancia única: el cron de
 * mantenimiento guarda una foto cada 15 minutos en SQLite y el panel dibuja las
 * últimas 24 horas o 7 días. El payload es JSON porque las métricas cambian con
 * el tiempo y no merecen una columna por cada una.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { readBuildInfo } from "./build-info";
import { getDb } from "./db";
import { hostMetrics } from "./host-metrics";
import { metricsValues } from "./prometheus";

export type MetricsSample = {
  at: string;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  load1: number | null;
  processCpuRatio: number | null;
  freeMemBytes: number;
  totalMemBytes: number;
  cpuCount: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  openFds: number | null;
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  streams: number;
  dbBytes: number;
  walBytes: number;
  freePages: number;
  jobsPending: number;
  jobsRunning: number;
  jobsFailed: number;
  jobsOverdueMinutes: number;
  backupAt: string | null;
  schemaVersion: number;
  commit: string | null;
};

/** Retención por defecto: 30 días a 15 minutos son unas 2.880 filas. */
export const METRICS_RETENTION_DAYS = 30;

function backupDirectory(): string {
  return (
    process.env.WANDERBIBLIOTHEK_BACKUP_DIR?.trim() ||
    path.join(process.cwd(), ".data", "backups")
  );
}

/** Fecha de la copia de base de datos más reciente, o `null` si no hay. */
export function latestBackupAt(dir = backupDirectory()): string | null {
  try {
    const files = readdirSync(dir).filter((name) =>
      /^wanderbibliothek-.*\.db(\.enc)?$/.test(name),
    );
    const times = files
      .map((name) => statSync(path.join(dir, name)).mtimeMs)
      .filter((value) => Number.isFinite(value));
    return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
  } catch {
    return null;
  }
}

/** Toma una foto y la guarda. Es lo que llama el cron de mantenimiento. */
export function recordMetricsSample(now = new Date()): MetricsSample {
  const values = metricsValues({ commit: readBuildInfo().commit });
  const host = hostMetrics(now.getTime());
  const sample: MetricsSample = {
    at: now.toISOString(),
    uptimeSeconds: values.uptimeSeconds,
    rssBytes: values.rssBytes,
    heapUsedBytes: values.heapUsedBytes,
    load1: host.load1,
    processCpuRatio: host.processCpuRatio,
    freeMemBytes: host.freeMemBytes,
    totalMemBytes: host.totalMemBytes,
    cpuCount: host.cpuCount,
    diskFreeBytes: host.diskFreeBytes,
    diskTotalBytes: host.diskTotalBytes,
    openFds: host.openFds,
    requests: values.requests,
    errors: values.errors,
    p50Ms: values.latency.p50,
    p95Ms: values.latency.p95,
    p99Ms: values.latency.p99,
    streams: values.streams,
    dbBytes: values.dbBytes,
    walBytes: values.walBytes,
    freePages: values.freePages,
    jobsPending: values.jobsPending,
    jobsRunning: values.jobsRunning,
    jobsFailed: values.jobsFailed,
    jobsOverdueMinutes: values.jobsOverdueMinutes,
    backupAt: latestBackupAt(),
    schemaVersion: values.schemaVersion,
    commit: values.commit,
  };

  getDb()
    .prepare("INSERT INTO metrics_samples (id, created_at, payload) VALUES (?, ?, ?)")
    .run(`met_${randomUUID()}`, sample.at, JSON.stringify(sample));

  return sample;
}

/**
 * Las muestras más recientes de la ventana, en orden cronológico.
 *
 * Se pide `DESC` para quedarse con las últimas N y luego se invierte: al revés,
 * una ventana larga devolvería las N más antiguas y el gráfico se quedaría
 * clavado en el pasado.
 */
function decodeSamples(rows: { payload: string }[]): MetricsSample[] {
  const samples: MetricsSample[] = [];
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (parsed && typeof parsed === "object") samples.push(parsed as MetricsSample);
    } catch {
      // Una fila corrupta no debe tumbar el panel: se ignora.
    }
  }
  return samples.reverse();
}

export function listMetricsSamples(since: Date, limit = 500): MetricsSample[] {
  const rows = getDb()
    .prepare(
      `SELECT payload FROM metrics_samples
        WHERE created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(since.toISOString(), Math.max(1, limit)) as { payload: string }[];
  return decodeSamples(rows);
}

/**
 * Las últimas `hours` horas, calculadas en SQLite.
 *
 * El panel es un componente de servidor y no debe leer el reloj con
 * `Date.now()` durante el render; la hora la pone la base, como en el resto de
 * consultas con fecha.
 */
export function listRecentMetricsSamples(hours: number, limit = 500): MetricsSample[] {
  const rows = getDb()
    .prepare(
      `SELECT payload FROM metrics_samples
        WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(`-${Math.max(1, hours)} hours`, Math.max(1, limit)) as { payload: string }[];
  return decodeSamples(rows);
}

/** Borra las muestras anteriores al plazo. Los datos de la app no se tocan. */
export function purgeMetricsSamples(days = METRICS_RETENTION_DAYS, now = new Date()): number {
  const cutoff = new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  return getDb().prepare("DELETE FROM metrics_samples WHERE created_at < ?").run(cutoff).changes;
}
