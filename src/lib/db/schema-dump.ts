/**
 * Volcado normalizado del esquema que ve una instalación nueva.
 *
 * Lo usan la prueba que compara el esquema actual con la instantánea y el
 * script que la regenera (`npm run db:schema-snapshot`). Vive en `src/` y no en
 * `tests/` porque la imagen no copia las pruebas y `next build` tipa también
 * `scripts/`.
 */
import type { Db } from "./index";

export const SNAPSHOT = "tests/fixtures/schema.sql";

export function dumpSchema(db: Db): string {
  const rows = db
    .prepare(
      `SELECT type, name, sql
         FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
        ORDER BY type, name`,
    )
    .all() as { type: string; name: string; sql: string }[];

  return (
    rows
      .map((row) => `${row.type} ${row.name} :: ${row.sql.replace(/\s+/g, " ").trim()}`)
      .join("\n") + "\n"
  );
}
