import { dbMetrics } from "./db";
import { SCHEMA_VERSION } from "./db/schema";
import { openStreamCount } from "./live";
import { latencySnapshot, loggedRequestCount, reportedErrorCount } from "./observability";
import { outboxStats } from "./outbox";

/**
 * Las métricas de la instancia, en formato de texto de Prometheus.
 *
 * `/api/metrics` nació en JSON a propósito: una instancia pequeña no necesita
 * un servicio de métricas y un `curl` lo lee cualquiera. Esto no lo cambia —el
 * JSON sigue siendo la respuesta por defecto—: añade la misma foto en el
 * formato de exposición que entienden Prometheus, VictoriaMetrics o un
 * `textfile` collector, para que quien quiera serie histórica no tenga que
 * escribir un traductor a mano.
 *
 * Ninguna métrica lleva contenido: ni direcciones, ni asuntos, ni mensajes. Los
 * nombres van con la unidad en el nombre (`_bytes`, `_seconds`) porque
 * Prometheus no tiene dimensiones y «milisegundos» no se adivina.
 */

type Sample = {
  labels?: Record<string, string>;
  value: number;
  /**
   * Nombre completo alternativo, para las líneas que pertenecen a la misma
   * familia pero llevan sufijo propio (`_count` de un resumen). Declararlas
   * como familia aparte sería un choque de nombres: Prometheus reserva esos
   * sufijos para el tipo `summary`.
   */
  name?: string;
};

export type Metric = {
  name: string;
  help: string;
  type: "counter" | "gauge" | "summary";
  samples: Sample[];
};

/** Escapa el valor de una etiqueta: comillas, barras y saltos rompen el formato. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: Record<string, string> | undefined): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

/**
 * Texto de exposición (`text/plain; version=0.0.4`).
 *
 * Un valor no finito se omite: Prometheus acepta `NaN`, pero un `undefined`
 * serializado como `undefined` rompe el análisis de toda la respuesta.
 */
export function prometheusText(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    for (const sample of metric.samples) {
      if (!Number.isFinite(sample.value)) continue;
      const name = sample.name ?? metric.name;
      lines.push(`${name}${renderLabels(sample.labels)} ${sample.value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** La foto que se publica, en JSON o en texto. */
export function metricsSnapshot(extra: { commit: string | null }): Metric[] {
  const { rss, heapUsed } = process.memoryUsage();
  const db = dbMetrics();
  const latency = latencySnapshot();
  const mail = outboxStats();

  const metrics: Metric[] = [
    {
      name: "wanderbibliothek_up",
      help: "1 si este proceso responde a la petición de métricas.",
      type: "gauge",
      samples: [{ value: 1 }],
    },
    {
      name: "wanderbibliothek_info",
      help: "Versión del esquema y del binario, como etiquetas.",
      type: "gauge",
      samples: [
        {
          labels: { commit: extra.commit ?? "unknown", schema: String(SCHEMA_VERSION) },
          value: 1,
        },
      ],
    },
    {
      name: "wanderbibliothek_uptime_seconds",
      help: "Segundos desde que arrancó el proceso.",
      type: "gauge",
      samples: [{ value: Math.round(process.uptime()) }],
    },
    {
      name: "wanderbibliothek_memory_resident_bytes",
      help: "Memoria residente del proceso.",
      type: "gauge",
      samples: [{ value: rss }],
    },
    {
      name: "wanderbibliothek_memory_heap_used_bytes",
      help: "Heap de JavaScript en uso.",
      type: "gauge",
      samples: [{ value: heapUsed }],
    },
    {
      name: "wanderbibliothek_http_requests_total",
      help: "Peticiones atendidas por manejadores envueltos con route().",
      type: "counter",
      samples: [{ value: loggedRequestCount() }],
    },
    {
      name: "wanderbibliothek_http_errors_total",
      help: "Errores de servidor registrados por reportError().",
      type: "counter",
      samples: [{ value: reportedErrorCount() }],
    },
    {
      name: "wanderbibliothek_live_streams",
      help: "Conexiones SSE abiertas ahora mismo.",
      type: "gauge",
      samples: [{ value: openStreamCount() }],
    },
    {
      name: "wanderbibliothek_database_size_bytes",
      help: "Tamaño del fichero de la base de datos.",
      type: "gauge",
      samples: [{ value: db.bytes }],
    },
    {
      name: "wanderbibliothek_database_wal_bytes",
      help: "Tamaño del WAL. Un WAL que no baja indica que el checkpoint no completa.",
      type: "gauge",
      samples: [{ value: db.walBytes }],
    },
    {
      name: "wanderbibliothek_database_free_pages",
      help: "Páginas libres que un VACUUM podría devolver al disco.",
      type: "gauge",
      samples: [{ value: db.freePages }],
    },
    {
      name: "wanderbibliothek_jobs",
      help: "Trabajos diferidos por estado.",
      type: "gauge",
      samples: [
        { labels: { kind: "mail", status: "pending" }, value: mail.pending },
        { labels: { kind: "mail", status: "running" }, value: mail.running },
        { labels: { kind: "mail", status: "failed" }, value: mail.failed },
      ],
    },
    {
      name: "wanderbibliothek_jobs_failed_24h",
      help: "Trabajos dados por perdidos en las últimas 24 horas.",
      type: "gauge",
      samples: [{ labels: { kind: "mail" }, value: mail.failed24h }],
    },
    {
      name: "wanderbibliothek_jobs_overdue_minutes",
      help: "Minutos de retraso del trabajo más atrasado (0 si todos están programados para el futuro).",
      type: "gauge",
      samples: [{ labels: { kind: "mail" }, value: mail.overdueMinutes }],
    },
  ];

  if (latency.samples > 0) {
    const quantiles = [
      { quantile: "0.5", value: latency.p50 },
      { quantile: "0.95", value: latency.p95 },
      { quantile: "0.99", value: latency.p99 },
    ].filter((entry): entry is { quantile: string; value: number } => entry.value !== null);
    metrics.push({
      name: "wanderbibliothek_http_request_duration_milliseconds",
      help: "Duración de las peticiones envueltas con route() (ventana en memoria).",
      type: "summary",
      samples: [
        ...quantiles.map((entry) => ({
          labels: { quantile: entry.quantile },
          value: entry.value,
        })),
        { labels: { quantile: "1" }, value: latency.max ?? 0 },
        // Las dos líneas obligatorias de un `summary`, en la misma familia.
        {
          name: "wanderbibliothek_http_request_duration_milliseconds_count",
          value: latency.samples,
        },
      ],
    });
  }

  return metrics;
}
