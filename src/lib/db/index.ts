/**
 * Conexión única a SQLite.
 *
 * Aquí solo vive lo que necesita el proceso: abrir el fichero, cachear
 * sentencias y garantizar permisos. El esquema está en `schema.ts`, la
 * escalera de actualizaciones en `migrations.ts` y los datos de ejemplo en
 * `seed.ts`.
 */
import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "./migrations";
import { ensureInitialAdmin, seed, shouldSeedDemo } from "./seed";
import { SCHEMA_VERSION } from "./schema";

export { SCHEMA_VERSION };
export { DEMO_PASSWORD_HASH } from "./seed";

export type Db = Database.Database;

/**
 * `unaccent(texto)`: quita las tildes para poder buscar «lucia» y encontrar
 * «Lucía».
 *
 * SQLite no trae una función así y `COLLATE NOCASE` solo pliega ASCII, de modo
 * que buscar sin tildes —lo que hace todo el mundo en un teclado rápido— no
 * encontraba ni a Lucía ni a Martínez. Se registra en la conexión para usarla
 * en los `LIKE` de las búsquedas (libros, clubes, lectores y listas).
 */
function registerUnaccent(db: Db): void {
  db.function("unaccent", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : value,
  );
}

/** Sentencia ya compilada, tal y como la devuelve la conexión. */
type PreparedStatement = ReturnType<Db["prepare"]>;

/**
 * Cuántas sentencias distintas se recuerdan. El código prepara unas 350 y las
 * listas `IN (…)` generan variantes por número de elementos, así que 400 cubre
 * el uso normal sin crecer sin freno.
 */
const STATEMENT_CACHE_LIMIT = 400;

/**
 * Caché de sentencias preparadas.
 *
 * `prepare()` compila la consulta en cada llamada (medido: ~13 µs frente a
 * ~1 µs de ejecución) y el acceso a datos prepara la misma SQL en cada
 * petición. Se intercepta `prepare` en la propia conexión: la primera vez
 * compila, las siguientes reutilizan la sentencia, y ningún sitio del proyecto
 * tiene que cambiar para aprovecharlo.
 */
function cacheStatements(db: Db): Db {
  const compiled = new Map<string, PreparedStatement>();
  const prepare = db.prepare.bind(db);
  Object.defineProperty(db, "prepare", {
    configurable: true,
    // Reemplazable a propósito: las pruebas envuelven `prepare` para contar
    // cuántas consultas pide una vista.
    writable: true,
    value: (sql: string): PreparedStatement => {
      const cached = compiled.get(sql);
      if (cached) return cached;
      const statement = prepare(sql);
      if (compiled.size >= STATEMENT_CACHE_LIMIT) {
        // Fuera la primera que se guardó: el acceso es suficientemente estable
        // como para que un FIFO simple evite el crecimiento sin coste real.
        const oldest = compiled.keys().next().value;
        if (oldest !== undefined) compiled.delete(oldest);
      }
      compiled.set(sql, statement);
      return statement;
    },
  });
  return db;
}
const globalForDb = globalThis as unknown as { __wanderbibliothekDb?: Db };

function databaseFile(): string {
  return process.env.WANDERBIBLIOTHEK_DB ?? path.join(process.cwd(), ".data", "wanderbibliothek.db");
}

export function getDb(): Db {
  if (!globalForDb.__wanderbibliothekDb) {
    const file = databaseFile();
    if (file !== ":memory:") {
      const dir = path.dirname(file);
      mkdirSync(dir, { recursive: true });
      restrictPermissions(dir, 0o700);
    }
    const db = cacheStatements(new Database(file));
    registerUnaccent(db);
    if (file !== ":memory:") {
      // La base guarda hashes de contraseña y sesiones: solo el usuario del
      // proceso debe poder leerla.
      for (const suffix of ["", "-wal", "-shm"]) {
        restrictPermissions(`${file}${suffix}`, 0o600);
      }
    }
    migrate(db);
    if (shouldSeedDemo()) seed(db);
    ensureInitialAdmin(db);
    globalForDb.__wanderbibliothekDb = db;
  }
  return globalForDb.__wanderbibliothekDb;
}

function restrictPermissions(target: string, mode: number) {
  try {
    chmodSync(target, mode);
  } catch {
    // En sistemas de archivos sin permisos POSIX (o en Windows) se ignora.
  }
}

/** Solo para pruebas: permite reiniciar la conexión en memoria. */
export function resetDbForTests() {
  globalForDb.__wanderbibliothekDb?.close();
  globalForDb.__wanderbibliothekDb = undefined;
}
