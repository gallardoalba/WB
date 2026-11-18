/**
 * La foto de métricas y su formato de exposición.
 *
 * `/api/metrics` sigue respondiendo JSON por defecto; el texto existe para que
 * un recolector lo lea sin un traductor. Lo que se fija aquí:
 *
 * - el formato es válido (HELP y TYPE una vez por familia, etiquetas escapadas),
 * - las métricas llevan unidad en el nombre y ninguna lleva contenido,
 * - un valor no finito se omite en vez de romper la respuesta entera.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import { metricsSnapshot, prometheusText, type Metric } from "../src/lib/prometheus.ts";

test("el texto declara cada familia una vez y escapa las etiquetas", () => {
  const metrics: Metric[] = [
    {
      name: "wanderbibliothek_prueba",
      help: "Una prueba con comillas y saltos.",
      type: "gauge",
      samples: [
        { labels: { motivo: 'dijo "hola"', ruta: "C:\\tmp\nlinea" }, value: 3 },
      ],
    },
  ];

  const texto = prometheusText(metrics);
  assert.equal(
    texto,
    [
      "# HELP wanderbibliothek_prueba Una prueba con comillas y saltos.",
      "# TYPE wanderbibliothek_prueba gauge",
      'wanderbibliothek_prueba{motivo="dijo \\"hola\\"",ruta="C:\\\\tmp\\nlinea"} 3',
      "",
    ].join("\n"),
  );
});

test("un valor no finito se omite, no se escribe como texto", () => {
  const texto = prometheusText([
    {
      name: "wanderbibliothek_rota",
      help: "Nunca debería salir.",
      type: "gauge",
      samples: [{ value: Number.NaN }, { value: Number.POSITIVE_INFINITY }, { value: 7 }],
    },
  ]);
  assert.equal(texto.includes("NaN"), false);
  assert.equal(texto.includes("Infinity"), false);
  assert.match(texto, /^wanderbibliothek_rota 7$/m);
});

test("una línea de la misma familia puede llevar su propio sufijo", () => {
  // `_count` pertenece al resumen: declararlo como familia aparte sería un
  // choque de nombres en Prometheus.
  const texto = prometheusText([
    {
      name: "wanderbibliothek_latencia_milliseconds",
      help: "Resumen.",
      type: "summary",
      samples: [
        { labels: { quantile: "0.5" }, value: 2 },
        { name: "wanderbibliothek_latencia_milliseconds_count", value: 10 },
      ],
    },
  ]);
  assert.equal(texto.match(/# TYPE/g)?.length, 1);
  assert.match(texto, /^wanderbibliothek_latencia_milliseconds\{quantile="0.5"\} 2$/m);
  assert.match(texto, /^wanderbibliothek_latencia_milliseconds_count 10$/m);
});

test("la foto trae la versión, la cola y el WAL, y ningún contenido", () => {
  const snapshot = metricsSnapshot({ commit: "0123456789abcdef" });
  const porNombre = new Map(snapshot.map((metric) => [metric.name, metric]));

  const info = porNombre.get("wanderbibliothek_info")!;
  assert.equal(info.samples[0]!.labels?.schema, "58");
  assert.equal(info.samples[0]!.labels?.commit, "0123456789abcdef");

  const jobs = porNombre.get("wanderbibliothek_jobs")!;
  assert.deepEqual(
    jobs.samples.map((sample) => sample.labels?.status),
    ["pending", "running", "failed"],
  );

  assert.ok(porNombre.has("wanderbibliothek_database_wal_bytes"));
  assert.ok(porNombre.has("wanderbibliothek_jobs_failed_24h"));
  assert.ok(porNombre.has("wanderbibliothek_jobs_overdue_minutes"));

  // Sin commit conocido no se inventa uno.
  const sinCommit = metricsSnapshot({ commit: null });
  assert.equal(sinCommit[1]!.samples[0]!.labels?.commit, "unknown");
});

test("sin latencia medida no se publica el resumen", () => {
  const nombres = metricsSnapshot({ commit: null }).map((metric) => metric.name);
  assert.equal(nombres.includes("wanderbibliothek_http_request_duration_milliseconds"), false);
});

test("con latencia medida se publica el resumen con sus cuantiles y su cuenta", async () => {
  const { recordRequest } = await import("../src/lib/observability.ts");
  for (let ms = 1; ms <= 20; ms += 1) {
    recordRequest({ id: `req_${ms}`, method: "GET", path: "/api/prueba", status: 200, ms });
  }

  const texto = prometheusText(metricsSnapshot({ commit: null }));
  assert.match(texto, /# TYPE wanderbibliothek_http_request_duration_milliseconds summary/);
  assert.match(texto, /wanderbibliothek_http_request_duration_milliseconds\{quantile="0\.5"\} \d+/);
  assert.match(texto, /wanderbibliothek_http_request_duration_milliseconds\{quantile="0\.95"\} \d+/);
  assert.match(texto, /wanderbibliothek_http_request_duration_milliseconds\{quantile="0\.99"\} \d+/);
  // `_count` pertenece a la familia del resumen, no a una declaración aparte.
  assert.match(texto, /wanderbibliothek_http_request_duration_milliseconds_count 20/);
});
