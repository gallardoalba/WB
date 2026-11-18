/**
 * Lecturas del correo encolado, para las pruebas.
 *
 * Desde la v58 la cola es la tabla `jobs` y el correo vive en su `payload` como
 * JSON. Varias pruebas comprobaban «qué correo le ha llegado a esta persona»;
 * dejarlas con el `json_extract` repetido en cada una hacía que el detalle del
 * esquema se colara en veinte aserciones. Aquí está una vez.
 */
import type { Db } from "../src/lib/db/index.ts";

type MailRow = { subject: string; body: string; status: string };

const SELECT = `
  SELECT json_extract(payload, '$.subject') AS subject,
         json_extract(payload, '$.text') AS body,
         status
    FROM jobs
   WHERE kind = 'mail'`;

/** El último correo encolado para una dirección (o para cualquiera). */
export function lastMail(db: Db, email?: string): MailRow | undefined {
  const sql = email ? `${SELECT} AND target = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    : `${SELECT} ORDER BY created_at DESC, rowid DESC LIMIT 1`;
  return (email ? db.prepare(sql).get(email) : db.prepare(sql).get()) as MailRow | undefined;
}

/** Todos los correos encolados para una dirección, del más antiguo al más nuevo. */
export function allMailTo(db: Db, email: string): MailRow[] {
  return db.prepare(`${SELECT} AND target = ? ORDER BY created_at ASC, rowid ASC`).all(email) as MailRow[];
}

/** Cuántos correos hay encolados para una dirección. */
export function countMailTo(db: Db, email: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind = 'mail' AND target = ?")
    .get(email) as { count: number };
  return row.count;
}

/** Vacía la cola, toda o solo la de una dirección. */
export function clearMail(db: Db, email?: string): void {
  if (email) db.prepare("DELETE FROM jobs WHERE kind = 'mail' AND target = ?").run(email);
  else db.prepare("DELETE FROM jobs WHERE kind = 'mail'").run();
}
