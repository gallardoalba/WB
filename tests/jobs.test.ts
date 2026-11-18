/**
 * Registro de trabajos (`jobs`).
 *
 * Lo que se fija aquí es lo que hace que una cola sirva para algo: dos workers
 * no se reparten la misma fila, una reclamación abandonada vuelve sola, el
 * fallo cuenta y espera cada vez más, y al quinto intento se deja de reintentar.
 */
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type JobsModule = typeof import("../src/lib/jobs.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let jobs: JobsModule;
let dbModule: DbModule;

function db() {
  return dbModule.getDb();
}

function row(id: string) {
  return db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | {
        status: string;
        attempts: number;
        next_attempt_at: string;
        last_error: string | null;
        finished_at: string | null;
      }
    | undefined;
}

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  jobs = await import("../src/lib/jobs.ts");
});

beforeEach(() => {
  db().prepare("DELETE FROM jobs").run();
});

test("lo encolado nace pendiente, sin intentos y con su contenido", () => {
  const id = jobs.enqueueJob({ kind: "prueba", target: "x", payload: { hola: 1 } });

  const guardado = row(id)!;
  assert.equal(guardado.status, "pending");
  assert.equal(guardado.attempts, 0);
  assert.equal(guardado.last_error, null);
  const fila = db().prepare("SELECT kind, target, payload FROM jobs WHERE id = ?").get(id) as {
    kind: string;
    target: string;
    payload: string;
  };
  assert.equal(fila.kind, "prueba");
  assert.equal(fila.target, "x");
  assert.deepEqual(JSON.parse(fila.payload), { hola: 1 });
});

test("reclamar dos veces el mismo trabajo no lo reparte", () => {
  jobs.enqueueJob({ kind: "prueba", payload: {} });

  const primera = jobs.claimJobs("prueba", 10);
  assert.equal(primera.length, 1, "el primero se lo lleva");
  const segunda = jobs.claimJobs("prueba", 10);
  assert.equal(segunda.length, 0, "el segundo no encuentra nada reclamable");
  assert.equal(row(primera[0]!.id)!.status, "running");
});

test("una reclamación abandonada vuelve a la cola pasados cinco minutos", () => {
  const id = jobs.enqueueJob({ kind: "prueba", payload: {} });
  jobs.claimJobs("prueba", 10);
  assert.equal(row(id)!.status, "running");

  // Se simula que el proceso murió a mitad: la reclamación ya venció.
  db()
    .prepare("UPDATE jobs SET next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE id = ?")
    .run(id);

  const otra = jobs.claimJobs("prueba", 10);
  assert.equal(otra.length, 1, "vuelve a estar disponible");
  assert.equal(otra[0]!.id, id);
});

test("terminar deja el trabajo hecho, con fecha y sin error", () => {
  const id = jobs.enqueueJob({ kind: "prueba", payload: {} });
  const [job] = jobs.claimJobs("prueba", 1);
  jobs.failJob(job!.id, "algo falló", job!.attempts);
  jobs.finishJob(id);

  const guardado = row(id)!;
  assert.equal(guardado.status, "done");
  assert.ok(guardado.finished_at);
  assert.equal(guardado.last_error, null, "un error viejo no sobrevive al éxito");
});

test("el fallo espera cada vez más y al quinto se da por perdido", () => {
  const id = jobs.enqueueJob({ kind: "prueba", payload: {} });

  const esperas: number[] = [];
  let attempts = 0;
  for (let vuelta = 1; vuelta <= jobs.MAX_ATTEMPTS; vuelta += 1) {
    const resultado = jobs.failJob(id, "el proveedor no contesta", attempts);
    attempts = resultado.attempts;
    assert.equal(resultado.final, vuelta === jobs.MAX_ATTEMPTS);
    if (resultado.retryAt) {
      esperas.push(Date.parse(resultado.retryAt) - Date.now());
    }
  }

  assert.equal(row(id)!.status, "failed");
  assert.equal(row(id)!.attempts, jobs.MAX_ATTEMPTS);
  assert.match(row(id)!.last_error ?? "", /no contesta/);
  // Dos minutos, cuatro, ocho y dieciséis: creciente y con una hora como tope.
  assert.equal(esperas.length, jobs.MAX_ATTEMPTS - 1);
  for (let i = 1; i < esperas.length; i += 1) {
    assert.ok(esperas[i]! > esperas[i - 1]!, "cada espera es mayor que la anterior");
  }
  assert.ok(Math.max(...esperas) <= 3600_000);
});

test("las estadísticas cuentan sin decir de qué van los trabajos", () => {
  jobs.finishJob(jobs.enqueueJob({ kind: "prueba", payload: {} }));

  const fallido = jobs.enqueueJob({ kind: "prueba", payload: { secreto: "no debe salir" } });
  let intentos = 0;
  for (let vuelta = 0; vuelta < jobs.MAX_ATTEMPTS; vuelta += 1) {
    intentos = jobs.failJob(fallido, "error de prueba", intentos).attempts;
  }
  jobs.enqueueJob({ kind: "prueba", payload: {} });

  const stats = jobs.jobStats("prueba");
  assert.equal(stats.pending, 1);
  assert.equal(stats.running, 0);
  assert.equal(stats.failed, 1);
  assert.equal(stats.failed24h, 1);
  assert.equal(stats.lastError, "error de prueba");
  // El trabajo hecho no cuenta como pendiente ni como fallo.
  assert.equal(stats.pending + stats.failed, 2);
  // Nada del contenido del trabajo se cuela en la foto.
  assert.equal(JSON.stringify(stats).includes("secreto"), false);
});

test("la poda respeta el trabajo reciente y el pendiente que aún puede correr", () => {
  const viejo = jobs.enqueueJob({ kind: "prueba", payload: {} });
  jobs.finishJob(viejo);
  const reciente = jobs.enqueueJob({ kind: "prueba", payload: {} });
  jobs.finishJob(reciente);
  db()
    .prepare("UPDATE jobs SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') WHERE id = ?")
    .run(viejo);

  assert.equal(jobs.purgeJobs("prueba"), 1);
  assert.equal(row(viejo), undefined);
  assert.ok(row(reciente), "lo reciente se conserva para poder investigar");
});

test("un trabajo perdido también queda con fecha de fin", () => {
  const id = jobs.enqueueJob({ kind: "prueba", payload: {} });
  let intentos = 0;
  for (let vuelta = 0; vuelta < jobs.MAX_ATTEMPTS; vuelta += 1) {
    intentos = jobs.failJob(id, "sin respuesta", intentos).attempts;
  }
  const guardado = row(id)!;
  assert.equal(guardado.status, "failed");
  assert.ok(
    guardado.finished_at,
    "sin fecha de fin no se sabe cuándo se dejó de intentar",
  );
});

test("el retraso se mide desde el próximo intento, no desde la creación", () => {
  // Un reintento programado para dentro de media hora no es una cola parada:
  // es la espera creciente haciendo su trabajo.
  const id = jobs.enqueueJob({
    kind: "prueba",
    payload: {},
    runAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  assert.equal(jobs.jobStats("prueba").overdueMinutes, 0);

  // Ya tocaba ejecutarlo y sigue ahí: eso sí es un retraso.
  db()
    .prepare("UPDATE jobs SET next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-45 minutes') WHERE id = ?")
    .run(id);
  assert.equal(jobs.jobStats("prueba").overdueMinutes, 45);
});
