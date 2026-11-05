import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let dbModule: DbModule;

const isStatus = (status: number) => (error: unknown) =>
  error instanceof Error && "status" in error && (error as { status: number }).status === status;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

/** Club de Clara con Ana y Lucía dentro; devuelve el id. */
function makeClub(members: string[] = ["usr_ana", "usr_lucia"]): string {
  // Cada prueba parte de cero: el tope de clubes por persona es estado real.
  const db = dbModule.getDb();
  db.prepare("DELETE FROM clubs").run();
  db.prepare("UPDATE users SET is_suspended = 0").run();
  const club = repo.createClub("usr_clara", {
    name: `Club ${Math.random().toString(36).slice(2, 8)}`,
    city: "Stuttgart",
    description: "Leemos y hablamos",
    meetsOn: "Último martes, 19:00",
    joinPolicy: "open",
  });
  for (const member of members) repo.setClubMembership(member, club.id, true);
  return club.id;
}

const viewer = (id: string) => ({ id, isAdmin: false });

/**
 * Moderadores del club (esquema v34).
 *
 * Llevar un club de lectura no debería depender de una sola persona: quien lo
 * creó puede nombrar gente de confianza para aprobar entradas y retirar
 * mensajes del foro. Lo que **no** se delega es el club en sí: editarlo,
 * cerrarlo, cederlo o retirar a alguien siguen siendo de su dueño.
 */
test("la v34 da rol a los miembros y todo el mundo empieza como miembro", () => {
  const db = dbModule.getDb();
  assert.equal(db.pragma("user_version", { simple: true }), dbModule.SCHEMA_VERSION);
  const columnas = (db.pragma("table_info(club_members)") as { name: string }[]).map(
    (column) => column.name,
  );
  assert.ok(columnas.includes("role"));

  const clubId = makeClub();
  const ana = db
    .prepare("SELECT role FROM club_members WHERE club_id = ? AND user_id = 'usr_ana'")
    .get(clubId) as { role: string } | undefined;
  assert.equal(ana?.role, "member");
});

test("solo quien creó el club nombra moderadores, y solo entre sus miembros", () => {
  const clubId = makeClub();

  // Un miembro corriente no puede nombrar a nadie.
  assert.throws(
    () => repo.setClubModerator("usr_ana", clubId, "usr_lucia", true),
    isStatus(403),
  );
  // Ni el dueño nombrarse a sí mismo: ya lleva el club.
  assert.throws(
    () => repo.setClubModerator("usr_clara", clubId, "usr_clara", true),
    isStatus(409),
  );
  // Ni nombrar a quien no está dentro.
  assert.throws(
    () => repo.setClubModerator("usr_clara", clubId, "usr_marcos", true),
    isStatus(409),
  );

  assert.deepEqual(repo.setClubModerator("usr_clara", clubId, "usr_ana", true), { moderators: 1 });
  assert.equal(repo.getClub(clubId, "usr_ana")?.isModerator, true);
  assert.equal(repo.getClub(clubId, "usr_lucia")?.isModerator, false);
  // El dueño nunca se marca como moderador de su propio club.
  assert.equal(repo.getClub(clubId, "usr_clara")?.isModerator, false);
  assert.ok(
    repo
      .listNotifications("usr_ana")
      .some((notification) => notification.title === "Ahora moderas un club"),
  );

  assert.deepEqual(repo.setClubModerator("usr_clara", clubId, "usr_ana", false), {
    moderators: 0,
  });
  assert.equal(repo.getClub(clubId, "usr_ana")?.isModerator, false);
  assert.ok(
    repo
      .listNotifications("usr_ana")
      .some((notification) => notification.title === "Ya no moderas el club"),
  );
});

test("un moderador resuelve solicitudes y el dueño se entera", () => {
  const clubId = makeClub(["usr_ana"]);
  repo.updateClub("usr_clara", clubId, {
    name: repo.getClub(clubId, "usr_clara")!.name,
    description: "Leemos y hablamos",
    meetsOn: "Último martes, 19:00",
    bookId: null,
    joinPolicy: "approval",
  });
  repo.setClubModerator("usr_clara", clubId, "usr_ana", true);
  repo.setClubMembership("usr_diego", clubId, true);

  // El moderador ve la solicitud; quien no lleva el club, no.
  assert.deepEqual(
    repo.listClubRequests(clubId, "usr_ana").map((entry) => entry.user.id),
    ["usr_diego"],
  );
  assert.throws(() => repo.listClubRequests(clubId, "usr_lucia"), isStatus(403));

  const after = repo.decideClubMembership("usr_ana", clubId, "usr_diego", true);
  assert.equal(after.members, 3);
  assert.ok(
    repo
      .listNotifications("usr_clara")
      .some((notification) => notification.title === "Una solicitud aceptada"),
  );
});

test("un miembro corriente sigue sin poder decidir quién entra", () => {
  const clubId = makeClub(["usr_ana"]);
  repo.updateClub("usr_clara", clubId, {
    name: repo.getClub(clubId, "usr_clara")!.name,
    description: "Leemos y hablamos",
    meetsOn: "",
    bookId: null,
    joinPolicy: "approval",
  });
  repo.setClubMembership("usr_diego", clubId, true);
  assert.throws(
    () => repo.decideClubMembership("usr_ana", clubId, "usr_diego", true),
    isStatus(403),
  );
});

test("el moderador retira mensajes del foro, pero no manda en el club", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  repo.setClubModerator("usr_clara", clubId, "usr_ana", true);
  repo.createClubPost({ clubId, authorId: "usr_lucia", body: "Una idea." });
  const deLucia = repo.createClubPost({ clubId, authorId: "usr_lucia", body: "Otra idea." });

  repo.deleteClubPost(deLucia.id, { id: "usr_ana", isAdmin: false });
  const page = repo.listClubPosts(clubId, viewer("usr_ana"));
  assert.equal(page.total, 1);
  // El botón de borrar aparece en el mensaje de otra persona.
  assert.equal(page.posts[0]?.canDelete, true);

  // Lo que no puede: editar, cerrar ni ceder el club, ni retirar a nadie.
  assert.throws(
    () =>
      repo.updateClub("usr_ana", clubId, {
        name: "Nombre ajeno",
        description: "",
        meetsOn: "",
        bookId: null,
      }),
    isStatus(403),
  );
  assert.throws(() => repo.deleteClub("usr_ana", clubId), isStatus(403));
  assert.throws(() => repo.transferClub("usr_ana", clubId, "usr_lucia"), isStatus(403));
  assert.throws(() => repo.removeClubMember("usr_ana", clubId, "usr_lucia"), isStatus(403));
});

test("las solicitudes pendientes se cuentan para el moderador", () => {
  const clubId = makeClub(["usr_ana"]);
  repo.updateClub("usr_clara", clubId, {
    name: repo.getClub(clubId, "usr_clara")!.name,
    description: "",
    meetsOn: "",
    bookId: null,
    joinPolicy: "approval",
  });
  repo.setClubMembership("usr_diego", clubId, true);

  assert.equal(repo.getClub(clubId, "usr_clara")?.pendingRequests, 1);
  assert.equal(repo.getClub(clubId, "usr_ana")?.pendingRequests, 0);

  repo.setClubModerator("usr_clara", clubId, "usr_ana", true);
  assert.equal(repo.getClub(clubId, "usr_ana")?.pendingRequests, 1);

  // Al retirarle el papel vuelve a no verlas.
  repo.setClubModerator("usr_clara", clubId, "usr_ana", false);
  assert.equal(repo.getClub(clubId, "usr_ana")?.pendingRequests, 0);
});

/**
 * Ordenar por cercanía (regresión).
 *
 * El JOIN de `city_distances` se colaba *antes* del `FROM`: la sentencia quedaba
 * «LEFT JOIN … FROM clubs» y `/clubes?sort=near` devolvía un 500 en cuanto la
 * cuenta tenía ciudad. Aquí se fija que la consulta se prepara y ordena.
 */
test("el listado se puede ordenar por cercanía si la cuenta tiene ciudad", () => {
  const raw = dbModule.getDb();
  raw.prepare("UPDATE users SET city = 'Stuttgart' WHERE id = 'usr_clara'").run();
  const clubId = makeClub(["usr_ana"]);

  const cerca = repo.listClubs({ viewerId: "usr_clara", sort: "near" });
  assert.ok(cerca.clubs.some((entry) => entry.id === clubId));
  // Sin ciudad conocida no se inventa ninguna distancia: cae al orden normal.
  const sinCiudad = repo.listClubs({ viewerId: null, sort: "near" });
  assert.ok(sinCiudad.clubs.some((entry) => entry.id === clubId));
});

test("quien lleva el club ve los mensajes denunciados y la denuncia se cierra al borrar", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  const post = repo.createClubPost({ clubId, authorId: "usr_lucia", body: "Mensaje que se denuncia." });
  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "club_post",
    targetId: post.id,
    reason: "Acoso",
    details: "",
  });

  // Un miembro corriente no ve la moderación del club.
  assert.throws(() => repo.listClubPostReports(clubId, "usr_lucia"), isStatus(403));

  // El dueño sí, y también un moderador.
  assert.equal(repo.listClubPostReports(clubId, "usr_clara").length, 1);
  repo.setClubModerator("usr_clara", clubId, "usr_ana", true);
  const paraModerar = repo.listClubPostReports(clubId, "usr_ana");
  assert.equal(paraModerar.length, 1);
  assert.equal(paraModerar[0]?.post.id, post.id);
  assert.equal(paraModerar[0]?.reporter.name, "Ana Martínez");
  // Quien denunció figura como tal, y el autor del mensaje también.
  assert.equal(paraModerar[0]?.post.author, "Lucía Prieto");

  // Al borrar el mensaje la denuncia deja de estar abierta.
  repo.deleteClubPost(post.id, { id: "usr_ana", isAdmin: false });
  assert.equal(repo.listClubPostReports(clubId, "usr_clara").length, 0);
  const status = dbModule
    .getDb()
    .prepare("SELECT status FROM reports WHERE target_id = ?")
    .get(post.id) as { status: string } | undefined;
  assert.equal(status?.status, "resolved");
});
