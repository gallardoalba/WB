/**
 * Métricas del host y del proceso para el panel de estadísticas.
 *
 * No hace falta Node Exporter para una instancia única: lo que el panel
 * necesita cabe en `node:os` y en `fs.statfs`. La CPU del proceso se calcula
 * entre dos llamadas; la primera devuelve `null` porque no hay intervalo.
 */
import { readdirSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { databasePath } from "./db";

export type HostMetrics = {
  /** Carga media de 1 minuto del host (en Docker es la del host, no la del cgroup). */
  load1: number | null;
  /** Memoria libre del host. */
  freeMemBytes: number;
  /** Memoria total del host. */
  totalMemBytes: number;
  cpuCount: number;
  /** CPU del proceso entre las dos últimas llamadas, de 0 a 1. */
  processCpuRatio: number | null;
  /** Espacio libre en el sistema de ficheros de la base de datos. */
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  /** Descriptores abiertos del proceso (Linux; `null` en otros sistemas). */
  openFds: number | null;
};

let previousUsage: { usage: NodeJS.CpuUsage; at: number } | null = null;

function openFileDescriptors(): number | null {
  try {
    return readdirSync("/proc/self/fd").length;
  } catch {
    return null;
  }
}

function diskUsage(): Pick<HostMetrics, "diskFreeBytes" | "diskTotalBytes"> {
  try {
    const stats = statfsSync(path.dirname(databasePath()));
    return {
      diskFreeBytes: stats.bavail * stats.bsize,
      diskTotalBytes: stats.blocks * stats.bsize,
    };
  } catch {
    return { diskFreeBytes: null, diskTotalBytes: null };
  }
}

export function hostMetrics(now = Date.now()): HostMetrics {
  const usage = process.cpuUsage();
  let processCpuRatio: number | null = null;
  if (previousUsage) {
    const elapsedMs = now - previousUsage.at;
    const cpuMs =
      (usage.user + usage.system - previousUsage.usage.user - previousUsage.usage.system) / 1000;
    const cores = Math.max(1, os.cpus().length);
    if (elapsedMs > 0 && Number.isFinite(cpuMs)) {
      processCpuRatio = Math.min(1, Math.max(0, cpuMs / (elapsedMs * cores)));
    }
  }
  previousUsage = { usage, at: now };

  const disk = diskUsage();
  return {
    load1: os.loadavg()[0] ?? null,
    freeMemBytes: os.freemem(),
    totalMemBytes: os.totalmem(),
    cpuCount: os.cpus().length,
    processCpuRatio,
    ...disk,
    openFds: openFileDescriptors(),
  };
}
