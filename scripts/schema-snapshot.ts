/**
 * Regenera `tests/fixtures/schema.sql`, el esquema que ve una instalación nueva.
 *
 *   npm run db:schema-snapshot
 *
 * Solo se ejecuta cuando una migración cambia el esquema **a propósito**: el
 * diff de la instantánea es la revisión que pide el cambio. La prueba
 * `tests/schema-snapshot.test.ts` falla mientras no se regenere.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";
import { dumpSchema, SNAPSHOT } from "../src/lib/db/schema-dump.ts";

const db = new Database(":memory:");
migrate(db);

const destino = path.join(process.cwd(), SNAPSHOT);
mkdirSync(path.dirname(destino), { recursive: true });
writeFileSync(destino, dumpSchema(db));

console.log(`Instantánea del esquema v${SCHEMA_VERSION} escrita en ${SNAPSHOT}`);
db.close();
