/**
 * La obra como entidad (v57).
 *
 * Tres niveles, y cada uno con su identidad: la **obra** (`works`) es el libro
 * que la gente busca —Don Quijote—, la **edición** (`books`) es el ISBN que se
 * publicó y el **ejemplar** (`listings`) es la copia que tiene alguien.
 *
 * Antes de la v57 la obra era `books.work_key`: una cadena derivada del título
 * o de Open Library, sin sitio para identificadores externos y reescribible en
 * caliente. Ahora la obra tiene `id` estable (no cambia nunca), `key` (la
 * antigua clave, que sí puede mejorar) y su propia ficha.
 *
 * `work_id` manda; `work_key` se conserva porque es la clave con la que se
 * busca y se agrupa hoy, y sirve de puente para las filas antiguas.
 */
import type { Db } from "../db";

export type Work = {
  id: string;
  key: string;
  title: string;
  author: string;
};

/**
 * Devuelve el id de la obra con esa clave, creándola si hace falta.
 *
 * La ficha canónica se toma del primer libro que llega: cuando la obra ya
 * existe no se toca, para que la corrección de una edición no renombre la obra
 * entera.
 */
export function ensureWork(
  db: Db,
  key: string,
  title: string,
  author: string,
  createdAt: string,
): string {
  const clean = key.trim();
  const existing = db.prepare("SELECT id FROM works WHERE key = ?").get(clean) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  const id = `wrk_${clean}`;
  db.prepare(
    "INSERT OR IGNORE INTO works (id, key, title, author, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, clean, title, author, createdAt);

  const created = db.prepare("SELECT id FROM works WHERE key = ?").get(clean) as
    | { id: string }
    | undefined;
  return created?.id ?? id;
}

/**
 * Pasa las ediciones de una obra a otra y retira la que queda vacía.
 *
 * Es lo que ocurre cuando el catálogo externo por fin conoce la obra: las
 * ediciones que estaban agrupadas por la clave derivada del título pasan a la
 * obra de Open Library, que agrupa también las traducciones. Si la obra de
 * destino no existía, se renombra la de origen (no se crea otra) para no mover
 * ids que ya estén en uso.
 */
export function moveWorkEditions(db: Db, fromKey: string, toKey: string, createdAt: string): string {
  const from = db.prepare("SELECT id, title, author FROM works WHERE key = ?").get(fromKey) as
    | { id: string; title: string; author: string }
    | undefined;
  if (!from) {
    // Nunca se creó la obra de origen: basta con asegurar la de destino.
    const unknown = db.prepare("SELECT title, author FROM books WHERE work_key = ? LIMIT 1").get(fromKey) as
      | { title: string; author: string }
      | undefined;
    return ensureWork(db, toKey, unknown?.title ?? fromKey, unknown?.author ?? "", createdAt);
  }

  const target = db.prepare("SELECT id FROM works WHERE key = ?").get(toKey) as
    | { id: string }
    | undefined;

  if (!target) {
    // La obra de origen pasa a ser la de destino: mismo id, mejor clave. Las
    // ediciones siguen apuntando a ese id; solo se pone al día su `work_key`,
    // que es la clave con la que el formulario busca obras ya existentes.
    db.prepare("UPDATE works SET key = ? WHERE id = ?").run(toKey, from.id);
    db.prepare("UPDATE books SET work_key = ? WHERE work_id = ?").run(toKey, from.id);
    return from.id;
  }

  // El movimiento va por `work_id` (la identidad) y no por la clave: una fila
  // pudo entrar con `work_key` nula y aun así estar ligada a la obra.
  db.prepare("UPDATE books SET work_id = ?, work_key = ? WHERE work_id = ?").run(
    target.id,
    toKey,
    from.id,
  );
  db.prepare("UPDATE books SET work_id = ?, work_key = ? WHERE work_key = ? AND work_id IS NULL").run(
    target.id,
    toKey,
    fromKey,
  );
  // Solo se retira si no le queda ninguna edición.
  const left = db.prepare("SELECT COUNT(*) AS count FROM books WHERE work_id = ?").get(from.id) as {
    count: number;
  };
  if (left.count === 0) db.prepare("DELETE FROM works WHERE id = ?").run(from.id);
  return target.id;
}

/** Obra de un libro, o `null` si es una fila anterior a la v57 sin clave. */
export function workIdForBook(db: Db, bookId: string): string | null {
  const row = db.prepare("SELECT work_id FROM books WHERE id = ?").get(bookId) as
    | { work_id: string | null }
    | undefined;
  return row?.work_id ?? null;
}

/** Ficha de la obra: título y autoría canónicos, compartidos por sus ediciones. */
export function getWork(db: Db, workId: string): Work | null {
  const row = db
    .prepare("SELECT id, key, title, author FROM works WHERE id = ?")
    .get(workId) as Work | undefined;
  return row ?? null;
}
