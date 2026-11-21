/**
 * Dos conexiones al **mismo fichero**: lo que en producción son dos procesos
 * —la aplicación y el cron, o un script de administración— sobre la misma base.
 *
 * `better-sqlite3` es síncrono, así que dentro de un proceso no hay dos
 * transacciones que puedan intercalarse: «dos pestañas» recorren el mismo
 * camino serializado y una prueba con dos peticiones HTTP no demuestra nada
 * nuevo. Lo que sí puede pasar en producción es que **otra conexión** haya
 * movido el estado entre el `SELECT` y el `UPDATE`; ahí son las condiciones en
 * el propio SQL y el índice único los que tienen que aguantar.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import Database from "better-sqlite3";

import { getDb } from "../src/lib/db/index.ts";

const raiz = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-concurrencia-"));
const fichero = path.join(raiz, "datos", "wanderbibliothek.db");
process.env.WANDERBIBLIOTHEK_DB = fichero;

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;
/** La «otra» conexión: otro proceso escribiendo en la misma base. */
let otra: Database.Database;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  // La primera consulta abre y migra el fichero; la segunda conexión entra
  // después, como entraría un script lanzado a mano.
  repo.getRequest("req_seed_1", "usr_ana");
  otra = new Database(fichero);
  otra.pragma("busy_timeout = 2000");
  otra.pragma("foreign_keys = ON");
});

after(() => {
  otra?.close();
  rmSync(raiz, { recursive: true, force: true });
});

let contador = 0;

function ejemplar(ownerId = "usr_clara") {
  contador += 1;
  return repo.createListing(ownerId, {
    title: `Concurrencia ${contador}`,
    author: "Autora de prueba",
    category: "Ficción",
    language: "Español",
    condition: "Buen estado",
    city: "Stuttgart",
    isbn: null,
    tags: [],
  });
}

test("si otra conexión reserva antes, la aceptación no pisa el ejemplar", () => {
  const listing = ejemplar("usr_clara");
  const request = repo.createRequest("usr_diego", listing.id);

  // Otro proceso aceptó otra solicitud del mismo ejemplar en el mismo instante.
  const reserva = otra
    .prepare("UPDATE listings SET status = 'reserved' WHERE id = ? AND status = 'available'")
    .run(listing.id);
  assert.equal(reserva.changes, 1, "la otra conexión reservó");

  // La condición va en el UPDATE: este proceso no puede repetir la reserva.
  assert.throws(
    () => repo.updateRequestStatus(request.id, "usr_clara", "accepted"),
    (error: unknown) => (error as { status?: number }).status === 409,
    "aceptar sobre un ejemplar ya reservado responde 409",
  );

  const estado = otra.prepare("SELECT status FROM listings WHERE id = ?").get(listing.id) as {
    status: string;
  };
  assert.equal(estado.status, "reserved", "el ejemplar sigue reservado una sola vez");
  assert.equal(repo.getRequest(request.id, "usr_clara")?.status, "pending", "la solicitud no avanza");
});

test("el índice único impide una segunda copia del mismo intercambio", () => {
  const listing = ejemplar("usr_clara");
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");
  repo.updateRequestStatus(request.id, "usr_diego", "completed");

  const copias = otra
    .prepare(
      `SELECT id, book_id, owner_id, condition, city, search_key, created_at, from_listing_id
         FROM listings WHERE from_request_id = ?`,
    )
    .all(request.id) as {
    id: string;
    book_id: string;
    owner_id: string;
    condition: string;
    city: string;
    search_key: string;
    created_at: string;
    from_listing_id: string;
  }[];
  assert.equal(copias.length, 1, "el cierre deja una copia y solo una");
  const copia = copias[0]!;

  // Otro proceso intenta repetir el cierre (reintento, copia restaurada…).
  const repetida = otra
    .prepare(
      `INSERT OR IGNORE INTO listings
         (id, book_id, owner_id, condition, city, distance_km, status, search_key,
          notes, created_at, from_listing_id, from_request_id)
       VALUES (?, ?, ?, ?, ?, NULL, 'paused', ?, '', ?, ?, ?)`,
    )
    .run(
      "lst_duplicada",
      copia.book_id,
      copia.owner_id,
      copia.condition,
      copia.city,
      copia.search_key,
      copia.created_at,
      copia.from_listing_id,
      request.id,
    );
  assert.equal(repetida.changes, 0, "la clave única de from_request_id lo impide");

  const total = otra
    .prepare("SELECT COUNT(*) AS count FROM listings WHERE from_request_id = ?")
    .get(request.id) as { count: number };
  assert.equal(total.count, 1);
});

test("las transacciones piden el cerrojo de escritura al empezar", () => {
  // Con `BEGIN` diferido la transacción nace como lectura y el cerrojo se pide
  // en la primera escritura, donde SQLite ya no puede esperar: devuelve BUSY.
  // Con `BEGIN IMMEDIATE` la espera ocurre al abrir, que es lo que convierte
  // la carrera con el cron en una espera corta.
  const db = getDb();
  const anterior = db.pragma("busy_timeout", { simple: true }) as number;
  otra.exec("BEGIN IMMEDIATE");
  db.pragma("busy_timeout = 120");
  try {
    assert.throws(
      () => db.transaction(() => 1)(),
      (error: unknown) => (error as { code?: string }).code === "SQLITE_BUSY",
      "una transacción que solo lee también pide el cerrojo: es IMMEDIATE",
    );
  } finally {
    otra.exec("ROLLBACK");
    db.pragma(`busy_timeout = ${anterior}`);
  }
  // Sin cerrojo ajeno, la misma transacción pasa.
  assert.equal(db.transaction(() => 42)(), 42);
});

test("una cancelación desde otra conexión no deshace una entrega confirmada", () => {
  const listing = ejemplar("usr_clara");
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");

  // El otro proceso no pasa por la comprobación de la aplicación: intenta el
  // cambio directamente. La condición del UPDATE es la que tiene que negarlo.
  const cancelada = otra
    .prepare(
      `UPDATE requests SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status = 'accepted'
          AND owner_confirmed_at IS NULL AND requester_confirmed_at IS NULL`,
    )
    .run(new Date().toISOString(), request.id);
  assert.equal(cancelada.changes, 0, "la entrega confirmada congela el estado");

  const estado = otra.prepare("SELECT status FROM requests WHERE id = ?").get(request.id) as {
    status: string;
  };
  assert.equal(estado.status, "accepted", "el intercambio sigue esperando la otra firma");
});

test("reintentar el cierre no crea copias ni cambia el estado", () => {
  const listing = ejemplar("usr_clara");
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");
  repo.updateRequestStatus(request.id, "usr_diego", "completed");

  for (let intento = 0; intento < 5; intento += 1) {
    // Un reintento después de un timeout vuelve a pedir el cierre: la
    // transición ya no es válida y no debe duplicar la copia.
    assert.throws(() => repo.updateRequestStatus(request.id, "usr_diego", "completed"));
  }

  const copias = otra
    .prepare("SELECT COUNT(*) AS count FROM listings WHERE from_request_id = ?")
    .get(request.id) as { count: number };
  assert.equal(copias.count, 1, "una sola copia pese a los reintentos");

  const estado = otra.prepare("SELECT status FROM requests WHERE id = ?").get(request.id) as {
    status: string;
  };
  assert.equal(estado.status, "completed");
});
