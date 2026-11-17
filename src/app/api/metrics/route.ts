import { json } from "@/lib/api";
import { dbMetrics } from "@/lib/db";
import { SCHEMA_VERSION } from "@/lib/db/schema";
import { openStreamCount } from "@/lib/live";
import {
  latencySnapshot,
  loggedRequestCount,
  reportedErrorCount,
} from "@/lib/observability";
import { route } from "@/lib/route";

/**
 * Salud operativa de la instancia, solo para administración.
 *
 * No es Prometheus a propósito: una instancia pequeña no necesita un servicio
 * de métricas, y un endpoint JSON se lee con `curl` desde el mismo host. La
 * latencia cubre **solo** las rutas envueltas por `route()`; el resto de
 * peticiones queda en el log de nginx, que ahora lleva el mismo `x-request-id`.
 */
export const GET = route({ auth: "admin" }, () => {
  const memory = process.memoryUsage();
  return json(
    {
      scope: "route()",
      schemaVersion: SCHEMA_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
      },
      requests: {
        logged: loggedRequestCount(),
        errors: reportedErrorCount(),
      },
      latency: latencySnapshot(),
      streams: openStreamCount(),
      db: dbMetrics(),
    },
    200,
    { "cache-control": "no-store" },
  );
});
