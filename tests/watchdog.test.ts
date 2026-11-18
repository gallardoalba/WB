/**
 * El vigilante, ejecutado de verdad.
 *
 * `deploy/watchdog.sh` es lo único que avisa cuando algo se rompe de noche, así
 * que sus comprobaciones no pueden quedarse en «el fichero menciona la métrica».
 * Aquí se ejecuta con `curl`, `df` y `free` sustituidos por respuestas fijas:
 * se comprueba qué considera un problema, qué manda al webhook y con qué código
 * de salida termina.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

const SCRIPT = new URL("../deploy/watchdog.sh", import.meta.url).pathname;

type Métricas = {
  failed24h?: number;
  failed?: number;
  oldestPendingMinutes?: number;
  walBytes?: number;
  requests?: number;
  errors?: number;
};

/** El texto que publicaría `/api/metrics?format=prometheus`. */
function metricas(datos: Métricas): string {
  return [
    "# HELP wanderbibliothek_up 1 si responde.",
    "# TYPE wanderbibliothek_up gauge",
    "wanderbibliothek_up 1",
    `wanderbibliothek_http_requests_total ${datos.requests ?? 10}`,
    `wanderbibliothek_http_errors_total ${datos.errors ?? 0}`,
    `wanderbibliothek_database_wal_bytes ${datos.walBytes ?? 1024}`,
    '# TYPE wanderbibliothek_jobs gauge',
    `wanderbibliothek_jobs{kind="mail",status="pending"} 0`,
    `wanderbibliothek_jobs{kind="mail",status="running"} 0`,
    `wanderbibliothek_jobs{kind="mail",status="failed"} ${datos.failed ?? 0}`,
    `wanderbibliothek_jobs_failed_24h{kind="mail"} ${datos.failed24h ?? 0}`,
    `wanderbibliothek_jobs_oldest_pending_minutes{kind="mail"} ${datos.oldestPendingMinutes ?? 0}`,
    "",
  ].join("\n");
}

const temporales: string[] = [];

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Ejecuta el vigilante con el host simulado.
 *
 * `curl` responde a la sonda de salud, a las métricas y al webhook según la URL;
 * `df` y `free` dan valores sanos para que solo salga lo que se está probando.
 */
async function vigilante(
  datos: Métricas,
  opciones: { token?: string | null; health?: string } = {},
): Promise<{ codigo: number; salida: string; avisos: string; csv: string }> {
  const raiz = mkdtempSync(path.join(tmpdir(), "wb-watchdog-"));
  temporales.push(raiz);
  const bin = path.join(raiz, "bin");
  mkdirSync(bin);
  const copias = path.join(raiz, "copias");
  mkdirSync(copias);
  writeFileSync(path.join(copias, "wanderbibliothek.db.enc"), "x");
  const listaMetricas = path.join(raiz, "metricas.txt");
  writeFileSync(listaMetricas, metricas(datos));
  const avisos = path.join(raiz, "avisos.txt");
  const csv = path.join(raiz, "watchdog.csv");

  writeFileSync(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
url=""
for arg in "$@"; do case "$arg" in http*) url=$arg ;; esac; done
case "$url" in
  *api/health*) printf '%s\\nHTTP 200 0.003\\n' '${opciones.health ?? '{"status":"ok","database":"ok","proxy":"trusted"}'}' ;;
  *api/metrics*) cat "${listaMetricas}" ;;
  *) printf '%s\\n' "$@" >> "${avisos}" ;;
esac
`,
  );
  writeFileSync(path.join(bin, "df"), '#!/usr/bin/env bash\nprintf "Use%%\\n42%%\\n"\n');
  writeFileSync(
    path.join(bin, "free"),
    '#!/usr/bin/env bash\nprintf "              total        used\\nMem:           2000         512\\n"\n',
  );
  for (const nombre of ["curl", "df", "free"]) chmodSync(path.join(bin, nombre), 0o755);

  const entorno: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HEALTH_URL: "http://127.0.0.1:3000/api/health",
    BACKUP_DIR: copias,
    METRICS_CSV: csv,
    CERT: path.join(raiz, "no-existe.pem"),
    METRICS_URL: "http://127.0.0.1:3000/api/metrics?format=prometheus",
    ERROR_WEBHOOK_URL: "https://hooks.example/avisos",
  };
  if (opciones.token !== null) entorno.MAINTENANCE_TOKEN = opciones.token ?? "token";

  const resultado = await run("bash", [SCRIPT], {
    // `execFile` tipa el entorno con `ProcessEnv` (Next marca `NODE_ENV` como
    // obligatoria); el script no la usa.
    env: entorno as NodeJS.ProcessEnv,
    encoding: "utf8",
  }).then(
    (ok) => ({ codigo: 0, salida: `${ok.stdout}${ok.stderr}` }),
    (error: { code?: number; stdout: string; stderr: string }) => ({
      codigo: error.code ?? 1,
      salida: `${error.stdout}${error.stderr}`,
    }),
  );

  return {
    ...resultado,
    // Sin aviso no se crea el fichero: el webhook es lo único que lo escribe.
    avisos: existsSync(avisos) ? readFileSync(avisos, "utf8") : "",
    csv: readFileSync(csv, "utf8"),
  };
}

test("un host sano termina bien, sin avisar y dejando su línea en la serie", async () => {
  const { codigo, salida, avisos, csv } = await vigilante({});
  assert.equal(codigo, 0, salida);
  assert.match(salida, /todo en orden/);
  assert.equal(avisos, "", "un host sano no manda nada al webhook");
  assert.match(csv, /^fecha,http,ttfb_ms,disco_pct,ram_mb,copia_h,cert_dias,estado/);
  assert.match(csv, /,ok$/m);
});

test("un correo perdido en 24 h avisa aunque la aplicación esté sana", async () => {
  const { codigo, avisos } = await vigilante({ failed24h: 2 });
  assert.equal(codigo, 1);
  assert.match(avisos, /2 correo\(s\) dados por perdidos en 24 h/);
});

test("una cola que no avanza se anuncia como tal", async () => {
  const { codigo, avisos } = await vigilante({ oldestPendingMinutes: 600 });
  assert.equal(codigo, 1);
  assert.match(avisos, /espera 600 min/);
});

test("un WAL desbordado señala el checkpoint", async () => {
  const { codigo, avisos } = await vigilante({ walBytes: 900 * 1024 * 1024 });
  assert.equal(codigo, 1);
  assert.match(avisos, /WAL ocupa 900 MB/);
  assert.match(avisos, /checkpoint/);
});

test("una tasa de errores alta avisa y una muestra pequeña no", async () => {
  const poco = await vigilante({ requests: 10, errors: 5 });
  assert.equal(poco.codigo, 0, "diez peticiones no son una muestra");

  const mucho = await vigilante({ requests: 200, errors: 20 });
  assert.equal(mucho.codigo, 1);
  assert.match(mucho.avisos, /10% de errores sobre 200 peticiones/);
});

test("sin token de mantenimiento no se inventan avisos de cola", async () => {
  const { codigo, salida } = await vigilante({ failed24h: 5 }, { token: null });
  assert.equal(codigo, 0, "sin token solo se comprueba el host");
  assert.match(salida, /sin MAINTENANCE_TOKEN no se revisan cola/);
});

test("si la aplicación no se declara sana, el aviso lo dice", async () => {
  const { codigo, avisos } = await vigilante({}, { health: '{"status":"error"}' });
  assert.equal(codigo, 1);
  assert.match(avisos, /no se declara sana/);
});
