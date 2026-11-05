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

/** Club abierto con Clara dentro y, si se pide, con más gente. */
function makeClub(members: string[] = []): string {
  // Cada prueba parte de cero: el tope de 10 clubes y una suspensión previa
  // son estado real de la base, no ruido que se pueda ignorar.
  const db = dbModule.getDb();
  db.prepare("DELETE FROM clubs").run();
  db.prepare("UPDATE users SET is_suspended = 0").run();
  const club = repo.createClub("usr_clara", {
    name: `Club ${Math.random().toString(36).slice(2, 8)}`,
    city: "Stuttgart",
    description: "Leemos y hablamos",
    meetsOn: "Último martes, 19:00",
    meetsAt: "2030-06-04T19:00:00.000Z",
    joinPolicy: "open",
  });
  for (const member of members) repo.setClubMembership(member, club.id, true);
  return club.id;
}

const viewer = (id: string) => ({ id, isAdmin: false });

test("el foro es de los miembros: fuera del club no se lee ni se escribe", () => {
  const clubId = makeClub(["usr_ana"]);
  const post = repo.createClubPost({ clubId, authorId: "usr_clara", body: "Empezamos el martes." });
  assert.equal(post.body, "Empezamos el martes.");
  assert.equal(post.isMine, true);

  // Quien no está en el club no ve nada ni puede escribir.
  assert.throws(() => repo.listClubPosts(clubId, viewer("usr_diego")), isStatus(403));
  assert.throws(
    () => repo.createClubPost({ clubId, authorId: "usr_diego", body: "Hola" }),
    isStatus(403),
  );
  assert.throws(() => repo.setClubPostLike("usr_diego", clubId, post.id, true), isStatus(403));
  // Sin sesión tampoco.
  assert.throws(() => repo.listClubPosts(clubId, null), isStatus(401));

  const desdeAna = repo.listClubPosts(clubId, viewer("usr_ana"));
  assert.equal(desdeAna.total, 1);
  assert.equal(desdeAna.posts[0].id, post.id);
});

test("se responde una vez: las respuestas no se anidan", () => {
  const clubId = makeClub(["usr_ana"]);
  const root = repo.createClubPost({
    clubId,
    authorId: "usr_clara",
    body: "Propongo empezar por el capítulo 3.",
  });
  const reply = repo.createClubPost({
    clubId,
    authorId: "usr_ana",
    body: "Me parece bien.",
    parentId: root.id,
  });
  assert.equal(reply.body, "Me parece bien.");

  assert.throws(
    () => repo.createClubPost({ clubId, authorId: "usr_clara", body: "Y más.", parentId: reply.id }),
    isStatus(409),
  );

  const page = repo.listClubPosts(clubId, viewer("usr_clara"));
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].replies.length, 1);
  // El total cuenta raíces y respuestas: es lo que enseña el contador.
  assert.equal(page.total, 2);
});

test("responder avisa a quien escribió, no al club entero", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  const root = repo.createClubPost({ clubId, authorId: "usr_clara", body: "¿Qué os parece el final?" });
  const antes = repo.listNotifications("usr_lucia").length;

  repo.createClubPost({
    clubId,
    authorId: "usr_ana",
    body: "A mí me sorprendió.",
    parentId: root.id,
  });

  assert.ok(
    repo
      .listNotifications("usr_clara")
      .some((item) => item.title === "Ana Martínez respondió a tu mensaje"),
  );
  // Lucía ya recibió el aviso del mensaje inicial: la respuesta no le llega.
  assert.equal(repo.listNotifications("usr_lucia").length, antes);
});

test("el primer mensaje del día avisa al club una sola vez", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  const cuenta = () =>
    repo.listNotifications("usr_lucia").filter((item) => item.link?.includes(clubId)).length;
  const antes = cuenta();

  repo.createClubPost({ clubId, authorId: "usr_clara", body: "Primera idea." });
  repo.createClubPost({ clubId, authorId: "usr_clara", body: "Segunda idea." });

  assert.equal(cuenta(), antes + 1, "dos mensajes seguidos no son dos avisos");
  // Quien escribe no se avisa a sí mismo.
  assert.equal(
    repo
      .listNotifications("usr_clara")
      .filter((item) => item.title === "Nueva conversación en tu club").length,
    0,
  );
});

test("me gusta: solo miembros, nunca al propio mensaje y se puede retirar", () => {
  const clubId = makeClub(["usr_ana"]);
  const post = repo.createClubPost({ clubId, authorId: "usr_clara", body: "Me encanta este libro." });

  assert.throws(() => repo.setClubPostLike("usr_clara", clubId, post.id, true), isStatus(409));
  assert.deepEqual(repo.setClubPostLike("usr_ana", clubId, post.id, true), {
    likes: 1,
    likedByMe: true,
  });
  const visto = repo.listClubPosts(clubId, viewer("usr_ana")).posts[0];
  assert.equal(visto.likes, 1);
  assert.equal(visto.likedByMe, true);
  assert.deepEqual(repo.setClubPostLike("usr_ana", clubId, post.id, false), {
    likes: 0,
    likedByMe: false,
  });
});

test("borra quien lo escribió, quien creó el club y la administración", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  const deAna = repo.createClubPost({ clubId, authorId: "usr_ana", body: "Mensaje de Ana." });

  // Otra persona del club no puede borrarlo.
  assert.throws(
    () => repo.deleteClubPost(deAna.id, { id: "usr_lucia", isAdmin: false }),
    isStatus(403),
  );

  // La administración sí, y queda en la auditoría.
  repo.deleteClubPost(deAna.id, { id: "usr_admin", isAdmin: true });
  const audit = dbModule
    .getDb()
    .prepare("SELECT action, target_type FROM admin_audit WHERE target_id = ?")
    .get(deAna.id) as { action: string; target_type: string } | undefined;
  assert.equal(audit?.action, "delete_club_post");
  assert.equal(audit?.target_type, "club_post");

  // Quien creó el club puede retirar lo que se escribe en su tablón.
  const deLucia = repo.createClubPost({ clubId, authorId: "usr_lucia", body: "Mensaje de Lucía." });
  repo.deleteClubPost(deLucia.id, { id: "usr_clara", isAdmin: false });
  assert.equal(repo.listClubPosts(clubId, viewer("usr_clara")).total, 0);
});

test("un mensaje con respuestas deja el hueco del hilo, no el texto", () => {
  const clubId = makeClub(["usr_ana"]);
  const root = repo.createClubPost({ clubId, authorId: "usr_clara", body: "Hilo con respuesta." });
  repo.createClubPost({ clubId, authorId: "usr_ana", body: "Respondo.", parentId: root.id });

  repo.deleteClubPost(root.id, { id: "usr_clara", isAdmin: false });

  const page = repo.listClubPosts(clubId, viewer("usr_clara"));
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].deleted, true);
  assert.equal(page.posts[0].body, "");
  assert.equal(page.posts[0].replies.length, 1);
});

test("los mensajes ocultos por moderación solo los ve su autor", () => {
  const clubId = makeClub(["usr_ana"]);
  const post = repo.createClubPost({ clubId, authorId: "usr_ana", body: "Texto retirado." });
  dbModule.getDb().prepare("UPDATE club_posts SET status = 'hidden' WHERE id = ?").run(post.id);

  const comoAna = repo.listClubPosts(clubId, viewer("usr_ana"));
  assert.equal(comoAna.posts.length, 1);
  assert.equal(comoAna.posts[0].hidden, true);

  const comoClara = repo.listClubPosts(clubId, viewer("usr_clara"));
  assert.equal(comoClara.posts.length, 0);
  assert.equal(comoClara.total, 0);
});

test("una cuenta suspendida no escribe y sus mensajes desaparecen", () => {
  const clubId = makeClub(["usr_ana"]);
  repo.createClubPost({ clubId, authorId: "usr_ana", body: "Mensaje de Ana." });
  dbModule.getDb().prepare("UPDATE users SET is_suspended = 1 WHERE id = ?").run("usr_ana");

  assert.throws(
    () => repo.createClubPost({ clubId, authorId: "usr_ana", body: "Otra vez" }),
    isStatus(403),
  );
  assert.equal(repo.listClubPosts(clubId, viewer("usr_clara")).total, 0);
});

test("salir del club limpia la asistencia fantasma", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  repo.setClubAttendance("usr_ana", clubId, true);
  assert.equal(repo.setClubAttendance("usr_clara", clubId, true).attendees, 2);

  repo.setClubMembership("usr_ana", clubId, false);

  // Ana ya no cuenta entre los confirmados del encuentro.
  assert.equal(repo.setClubAttendance("usr_clara", clubId, true).attendees, 1);
});

test("el foro no filtra mensajes entre personas bloqueadas", () => {
  const clubId = makeClub(["usr_ana"]);
  repo.createClubPost({ clubId, authorId: "usr_ana", body: "Mensaje que Clara no debe ver." });
  repo.blockUser("usr_clara", "usr_ana");

  const page = repo.listClubPosts(clubId, viewer("usr_clara"));
  assert.equal(page.posts.length, 0);
  assert.equal(page.total, 0);
});
