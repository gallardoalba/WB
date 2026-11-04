import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db.ts");

let repo: RepoModule;
let db: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  db = await import("../src/lib/db.ts");
});

const rejects = (pattern: RegExp) => (error: unknown) =>
  error instanceof Error && pattern.test(error.message);

/* ----------------------------- límites de clubes --------------------------- */

test("el nombre del club solo tiene que ser único dentro de su ciudad", () => {
  repo.createClub("usr_ana", {
    name: "Lecturas de martes",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
  });

  assert.throws(
    () =>
      repo.createClub("usr_diego", {
        name: "  lecturas de MARTES ",
        city: "Stuttgart",
        description: "",
        meetsOn: "",
      }),
    rejects(/Ya existe un club/),
  );

  // Misma idea, otra ciudad: se permite.
  const otro = repo.createClub("usr_diego", {
    name: "Lecturas de martes",
    city: "Mannheim",
    description: "",
    meetsOn: "",
  });
  assert.equal(otro.city, "Mannheim");
});

test("renombrar un club tampoco puede duplicar el nombre de su ciudad", () => {
  const club = repo.createClub("usr_clara", {
    name: "Poesía en voz alta",
    city: "Karlsruhe",
    description: "",
    meetsOn: "",
  });
  repo.createClub("usr_lucia", {
    name: "Narrativa corta",
    city: "Karlsruhe",
    description: "",
    meetsOn: "",
  });

  assert.throws(
    () =>
      repo.updateClub("usr_clara", club.id, {
        name: "narrativa corta",
        description: "",
        meetsOn: "",
        bookId: null,
      }),
    rejects(/Ya existe un club/),
  );

  // Su propio nombre no choca consigo mismo.
  repo.updateClub("usr_clara", club.id, {
    name: "Poesía en voz alta",
    description: "Ahora con descripción.",
    meetsOn: "",
    bookId: null,
  });
  assert.equal(repo.getClub(club.id, "usr_clara")?.description, "Ahora con descripción.");
});

test("una cuenta no puede acumular más de diez clubes", () => {
  const creados: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const club = repo.createClub("usr_marcos", {
      name: `Club de prueba ${i}`,
      city: "Freiburg",
      description: "",
      meetsOn: "",
    });
    creados.push(club.id);
  }
  assert.equal(creados.length, 10);
  assert.throws(
    () =>
      repo.createClub("usr_marcos", {
        name: "Club de prueba 11",
        city: "Freiburg",
        description: "",
        meetsOn: "",
      }),
    rejects(/máximo de 10 clubes/),
  );

  // Al cerrar uno vuelve a haber sitio.
  repo.deleteClub("usr_marcos", creados[0]);
  const nuevo = repo.createClub("usr_marcos", {
    name: "Club de prueba 11",
    city: "Freiburg",
    description: "",
    meetsOn: "",
  });
  assert.ok(nuevo.id.startsWith("clb_"));
});

test("un club no admite más de doscientos miembros", () => {
  const club = repo.createClub("usr_ana", {
    name: "Club enorme",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
  });
  // Se rellena la tabla directamente: crear 198 cuentas reales es ruido. La
  // clave foránea se desactiva solo para este relleno.
  const sql = db.getDb();
  const insert = sql.prepare(
    "INSERT INTO club_members (club_id, user_id, joined_at) VALUES (?, ?, ?)",
  );
  sql.pragma("foreign_keys = OFF");
  for (let i = 0; i < 198; i += 1) {
    insert.run(club.id, `usr_relleno_${i}`, new Date().toISOString());
  }
  sql.pragma("foreign_keys = ON");
  assert.equal(repo.listClubMembers(club.id).members.length, 1, "las cuentas de relleno no existen");

  // 199 con la dueña: Clara entra y llega justo al tope.
  assert.equal(repo.setClubMembership("usr_clara", club.id, true).members, 200);
  // Ya dentro, repetir la acción es idempotente (no es un alta nueva).
  assert.equal(repo.setClubMembership("usr_clara", club.id, true).members, 200);
  // La siguiente persona se queda fuera.
  assert.throws(
    () => repo.setClubMembership("usr_diego", club.id, true),
    rejects(/200 miembros/),
  );

  const salida = repo.setClubMembership("usr_clara", club.id, false);
  assert.equal(salida.member, false);
  assert.equal(salida.members, 199);
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
