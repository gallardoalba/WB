import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let db: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  db = await import("../src/lib/db/index.ts");
});

/* ------------------------------- mantenimiento ----------------------------- */

test("el mantenimiento limpia avisos que apuntan a libros desaparecidos", () => {
  const sql = db.getDb();
  sql
    .prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, book_id, link, read_at, created_at)
       VALUES (?, ?, 'comment', ?, '', ?, NULL, NULL, ?)`,
    )
    .run("ntf_huerfano", "usr_ana", "Aviso con libro fantasma", "bok_inexistente", new Date().toISOString());
  sql
    .prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, book_id, link, read_at, created_at)
       VALUES (?, ?, 'comment', ?, '', ?, NULL, NULL, ?)`,
    )
    .run("ntf_valido", "usr_ana", "Aviso con libro real", "bok_1", new Date().toISOString());

  repo.runMaintenance();

  const huerfano = sql
    .prepare("SELECT book_id FROM notifications WHERE id = ?")
    .get("ntf_huerfano") as { book_id: string | null } | undefined;
  const valido = sql
    .prepare("SELECT book_id FROM notifications WHERE id = ?")
    .get("ntf_valido") as { book_id: string | null } | undefined;

  assert.equal(huerfano?.book_id, null, "el puntero roto se limpia");
  assert.equal(valido?.book_id, "bok_1", "el aviso con libro real no se toca");
  // El aviso no se borra: sigue siendo legible aunque sin enlace.
  assert.ok(repo.listNotifications("usr_ana").some((item) => item.id === "ntf_huerfano"));
});
