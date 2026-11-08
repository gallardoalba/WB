/**
 * Base de datos en **fichero**: permisos, caché de sentencias y reinicio.
 *
 * Todas las pruebas del proyecto abren `:memory:` y por eso no se ejecutaba
 * nunca el camino de un despliegue real: crear carpetas, cerrar el fichero al
 * dueño del proceso y reutilizar sentencias compiladas. Un cambio que dejara la
 * base legible por cualquiera (lleva hashes de contraseña y sesiones) pasaba la
 * suite sin que nadie se enterara.
 *
 * Se abre un directorio temporal propio: no se toca la base de desarrollo.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const raiz = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-db-"));
const fichero = path.join(raiz, "datos", "profundo", "wanderbibliothek.db");
process.env.WANDERBIBLIOTHEK_DB = fichero;
delete process.env.SEED_DEMO;

type DbModule = typeof import("../src/lib/db/index.ts");

let dbModule: DbModule;

before(async () => {
  // `ensureInitialAdmin` crea la cuenta de administración si no hay ninguna:
  // fuera del directorio de trabajo, sin credenciales que reutilizar.
  dbModule = await import("../src/lib/db/index.ts");
});

after(() => {
  dbModule?.resetDbForTests();
  rmSync(raiz, { recursive: true, force: true });
});

/** Modo octal de un fichero (o `null` si no existe). */
function permisos(ruta: string): number | null {
  try {
    return statSync(ruta).mode & 0o777;
  } catch {
    return null;
  }
}

test("la base se crea con carpetas y fichero solo para el usuario del proceso", () => {
  const db = dbModule.getDb();
  assert.ok(db, "la conexión se abre");

  assert.equal(permisos(path.dirname(fichero)), 0o700, "la carpeta es privada");
  assert.equal(permisos(fichero), 0o600, "el fichero es privado");

  // Los acompañantes de WAL heredan el mismo criterio si llegan a existir.
  for (const sufijo of ["-wal", "-shm"]) {
    const modo = permisos(`${fichero}${sufijo}`);
    if (modo !== null) assert.equal(modo, 0o600, `el fichero ${sufijo} es privado`);
  }
});

test("el esquema queda aplicado y con su versión anotada", () => {
  const db = dbModule.getDb();
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  assert.equal(version, dbModule.SCHEMA_VERSION);

  const tablas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  const nombres = tablas.map((tabla) => tabla.name);
  for (const esperada of ["users", "listings", "books", "requests", "throttle"]) {
    assert.ok(nombres.includes(esperada), `falta la tabla ${esperada}`);
  }
});

test("la extensión unaccent quita las tildes también en esta conexión", () => {
  const db = dbModule.getDb();
  const { limpio } = db.prepare("SELECT unaccent('Günther Martínez') AS limpio").get() as {
    limpio: string;
  };
  assert.equal(limpio, "Gunther Martinez");
});

test("una sentencia repetida se compila una vez y sigue valiendo al desbordar la caché", () => {
  const db = dbModule.getDb();
  const sql = "SELECT COUNT(*) AS total FROM users";

  const primera = db.prepare(sql);
  assert.equal(db.prepare(sql), primera, "la segunda preparación reutiliza la compilada");

  // La caché recuerda 400 sentencias distintas y descarta la más antigua.
  for (let indice = 0; indice < 420; indice += 1) {
    db.prepare(`SELECT ${indice} AS relleno`).get();
  }

  const despues = db.prepare(sql);
  assert.notEqual(despues, primera, "la primera sentencia salió de la caché");
  assert.deepEqual(despues.get(), primera.get(), "y se vuelve a compilar bien");
  // Las recién usadas sí están cacheadas.
  assert.equal(db.prepare(sql), despues);
});

test("reiniciar la conexión de prueba conserva lo escrito en el fichero", () => {
  const db = dbModule.getDb();
  db.prepare(
    `INSERT INTO users (id, name, email, city, password_hash, created_at)
     VALUES ('usr_persistente', 'Persistente', 'persistente@example.test', 'Leipzig', 'scrypt$00$00', '2026-01-01T00:00:00.000Z')`,
  ).run();

  dbModule.resetDbForTests();

  const otra = dbModule.getDb();
  const fila = otra
    .prepare("SELECT name FROM users WHERE id = 'usr_persistente'")
    .get() as { name: string } | undefined;
  assert.equal(fila?.name, "Persistente");
});
