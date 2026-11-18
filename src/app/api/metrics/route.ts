import { json } from "@/lib/api";
import { readBuildInfo } from "@/lib/build-info";
import { dbMetrics } from "@/lib/db";
import { SCHEMA_VERSION } from "@/lib/db/schema";
import { ApiError } from "@/lib/errors";
import { openStreamCount } from "@/lib/live";
import { latencySnapshot, loggedRequestCount, reportedErrorCount } from "@/lib/observability";
import { hasOpsToken } from "@/lib/ops-auth";
import { outboxStats } from "@/lib/outbox";
import { metricsSnapshot, prometheusText } from "@/lib/prometheus";
import { route } from "@/lib/route";

/**
 * Salud operativa de la instancia.
 *
 * No es Prometheus a propósito: una instancia pequeña no necesita un servicio
 * de métricas, y un endpoint JSON se lee con `curl` desde el mismo host. La
 * latencia cubre **solo** las rutas envueltas por `route()`; el resto de
 * peticiones queda en el log de nginx, que ahora lleva el mismo `x-request-id`.
 *
 * Encima de eso, y sin quitar el JSON, la misma foto se puede pedir en formato
 * de exposición (`?format=prometheus` o `Accept: text/plain`), que es lo que
 * entiende un recolector. Así quien quiera serie histórica no tiene que escribir
 * un traductor, y quien solo quiera mirar sigue con `curl`.
 *
 * Se entra con sesión de administración **o** con el `MAINTENANCE_TOKEN`: el
 * vigilante y un recolector local no tienen cookie de sesión, y este endpoint
 * no lleva contenido de nadie.
 */
export const GET = route({ auth: "optional" }, ({ request, user }) => {
  if (!hasOpsToken(request)) {
    if (!user) throw new ApiError(401, "Inicia sesión para ver las métricas.");
    if (!user.isAdmin) throw new ApiError(403, "Solo administración.");
  }

  const format = new URL(request.url).searchParams.get("format");
  if (
    format === "prometheus" ||
    (format === null && (request.headers.get("accept") ?? "").includes("text/plain"))
  ) {
    return new Response(prometheusText(metricsSnapshot({ commit: readBuildInfo().commit })), {
      status: 200,
      headers: {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

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
      jobs: { mail: outboxStats() },
      db: dbMetrics(),
    },
    200,
    { "cache-control": "no-store" },
  );
});
