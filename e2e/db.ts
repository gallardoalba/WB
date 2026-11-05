import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Base de datos del servidor de pruebas, o `null` si las pruebas apuntan a un
 * servidor ajeno (`PLAYWRIGHT_BASE_URL` no local) o la base aún no existe.
 */
export function localDatabase(): Database.Database | null {
  const externo = process.env.PLAYWRIGHT_BASE_URL;
  const esLocal = !externo || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(externo);
  if (!esLocal) return null;
  const file =
    process.env.WANDERBIBLIOTHEK_DB?.trim() ||
    path.join(process.cwd(), ".data", "wanderbibliothek.db");
  if (!existsSync(file)) return null;
  try {
    return new Database(file);
  } catch {
    // Base bloqueada o sin migrar: la creará el servidor al arrancar.
    return null;
  }
}
