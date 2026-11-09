/**
 * Conexión única a SQLite.
 *
 * Aquí solo vive lo que necesita el proceso: abrir el fichero, cachear
 * sentencias y garantizar permisos. El esquema está en `schema.ts`, la
 * escalera de actualizaciones en `migrations.ts` y los datos de ejemplo en
 * `seed.ts`.
 */
import Database from "better-sqlite3";
import { chmodSync, mkdirSync, statSync } from "node:fs";
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
 * A partir de aquí una consulta se anuncia como lenta.
 *
 * `better-sqlite3` es síncrono: mientras una consulta corre, el proceso entero
 * —incluidas las respuestas de las demás personas— está parado. 50 ms es el
 * umbral a partir del cual un barrido de tabla empieza a notarse.
 */
export const SLOW_QUERY_MS = 50;
/** Lo que se recorta la SQL en el aviso (con los valores fuera, es casi fija). */
const MAX_SQL_LOG = 140;

/**
 * Envuelve una sentencia para medir cuánto tarda cada ejecución.
 *
 * Se envuelven `run`, `get`, `all` e `iterate`, que son las cuatro formas de
 * ejecutar algo; el resto de métodos (`.pluck()`, `.expand()`…) se reenvían a la
 * sentencia original, así que encadenar sigue funcionando igual.
 */
function cronometrada(statement: PreparedStatement, sql: string): PreparedStatement {
  const metodos = ["run", "get", "all", "iterate"] as const;
  const envoltorios: Record<string, (...args: unknown[]) => unknown> = {};
  for (const metodo of metodos) {
    envoltorios[metodo] = (...args: unknown[]) => {
      const inicio = performance.now();
      try {
        return (statement[metodo] as (...paso: unknown[]) => unknown).apply(statement, args);
      } finally {
        const ms = performance.now() - inicio;
        if (ms >= SLOW_QUERY_MS) {
          console.warn("[db] consulta lenta", {
            ms: Math.round(ms * 10) / 10,
            sql: sql.replace(/\s+/g, " ").trim().slice(0, MAX_SQL_LOG),
          });
        }
      }
    };
  }
  return new Proxy(statement, {
    get(target, prop) {
      if (typeof prop === "string" && prop in envoltorios) return envoltorios[prop];
      const valor = Reflect.get(target, prop, target) as unknown;
      return typeof valor === "function" ? valor.bind(target) : valor;
    },
  }) as PreparedStatement;
}

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
      const statement = cronometrada(prepare(sql), sql);
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

export type DbMetrics = {
  /** Tamaño del fichero principal; 0 si la base vive en memoria. */
  bytes: number;
  walBytes: number;
  shmBytes: number;
  pageCount: number;
  /** Páginas libres: si crece sin parar, toca un `VACUUM` medido, no a ciegas. */
  freePages: number;
  journalMode: string;
};

/**
 * Tamaño de la base y de sus acompañantes.
 *
 * SQLite no devuelve el espacio de las filas borradas al sistema: el fichero y
 * el WAL crecen aunque la aplicación vea menos datos. Estas cifras van en el
 * informe del cron para poder verlo venir (el watchdog avisa del disco, pero no
 * distingue «la base ocupa más» de «hay menos sitio»).
 */
export function dbMetrics(): DbMetrics {
  const db = getDb();
  const file = databaseFile();
  const tamano = (ruta: string) => {
    try {
      return statSync(ruta).size;
    } catch {
      return 0;
    }
  };
  const enMemoria = file === ":memory:";
  return {
    bytes: enMemoria ? 0 : tamano(file),
    walBytes: enMemoria ? 0 : tamano(`${file}-wal`),
    shmBytes: enMemoria ? 0 : tamano(`${file}-shm`),
    pageCount: Number(db.pragma("page_count", { simple: true })),
    freePages: Number(db.pragma("freelist_count", { simple: true })),
    journalMode: String(db.pragma("journal_mode", { simple: true })),
  };
}
