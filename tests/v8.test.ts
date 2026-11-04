import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const visitante = null;

const fails = (pattern: string) => (error: unknown) =>
  error instanceof Error && error.message.includes(pattern);

test("el hilo cuelga de la obra y admite una respuesta", () => {
  const root = repo.createBookComment({
    bookId: "bok_3",
    authorId: "usr_ana",
    body: "Me costó entrar, pero el último tercio me atrapó del todo.",
    spoiler: false,
  });
  assert.equal(root.replies.length, 0);
  assert.equal(root.likes, 0);

  const reply = repo.createBookComment({
    bookId: "bok_3",
    authorId: "usr_diego",
    body: "A mí me pasó lo mismo: la primera parte es la más lenta.",
    spoiler: false,
    parentId: root.id,
  });
  assert.equal(reply.body.length > 0, true);

  const thread = repo.listBookComments("bok_3", visitante);
  // El total cuenta mensajes: la raíz y su respuesta.
  assert.equal(thread.total, 2);
  assert.equal(thread.comments.length, 1);
  assert.equal(thread.comments[0]!.replies.length, 1);
  assert.equal(thread.comments[0]!.replies[0]!.id, reply.id);
  // El hilo es de la obra: se ve igual desde cualquier ejemplar del mismo título.
  assert.equal(repo.countBookComments("bok_3"), 2);
});

test("no se puede responder a una respuesta ni comentar un libro inexistente", () => {
  const root = repo.createBookComment({
    bookId: "bok_4",
    authorId: "usr_ana",
    body: "Un comentario raíz para probar el límite de un nivel.",
    spoiler: false,
  });
  const reply = repo.createBookComment({
    bookId: "bok_4",
    authorId: "usr_clara",
    body: "Una respuesta correcta al comentario principal.",
    spoiler: false,
    parentId: root.id,
  });

  assert.throws(
    () =>
      repo.createBookComment({
        bookId: "bok_4",
        authorId: "usr_diego",
        body: "Respuesta a una respuesta, que no está permitida.",
        spoiler: false,
        parentId: reply.id,
      }),
    fails("comentario principal"),
  );

  assert.throws(
    () =>
      repo.createBookComment({
        bookId: "bok_inexistente",
        authorId: "usr_ana",
        body: "Este libro no existe en el catálogo.",
        spoiler: false,
      }),
    fails("no existe"),
  );

  assert.throws(() => repo.listBookComments("bok_inexistente", visitante), fails("no existe"));
});

test("el hilo se pagina por cursor sin perder comentarios", () => {
  for (let index = 0; index < 12; index += 1) {
    repo.createBookComment({
      bookId: "bok_5",
      authorId: "usr_clara",
      body: `Comentario número ${index} sobre el mismo libro.`,
      spoiler: false,
    });
  }

  const first = repo.listBookComments("bok_5", visitante, { limit: 5 });
  assert.equal(first.comments.length, 5);
  assert.equal(first.hasMore, true);
  assert.equal(first.total, 12);
  const seen = new Set(first.comments.map((comment) => comment.id));
  let cursor = first.comments[first.comments.length - 1]!.id;
  let guard = 0;
  while (guard < 10) {
    const page = repo.listBookComments("bok_5", visitante, { limit: 5, beforeId: cursor });
    for (const comment of page.comments) seen.add(comment.id);
    if (!page.hasMore) break;
    cursor = page.comments[page.comments.length - 1]!.id;
    guard += 1;
  }
  assert.equal(seen.size, 12);
});

test("me gusta: no vale el propio y el conteo es idempotente", () => {
  const comment = repo.createBookComment({
    bookId: "bok_6",
    authorId: "usr_ana",
    body: "Comentario para probar los me gusta ajenos.",
    spoiler: false,
  });

  assert.throws(() => repo.setCommentLike("usr_ana", comment.id, true), fails("tu propio"));

  const liked = repo.setCommentLike("usr_diego", comment.id, true);
  assert.deepEqual(liked, { likes: 1, likedByMe: true });
  const again = repo.setCommentLike("usr_diego", comment.id, true);
  assert.equal(again.likes, 1);
  const removed = repo.setCommentLike("usr_diego", comment.id, false);
  assert.deepEqual(removed, { likes: 0, likedByMe: false });
});

test("borrar sin respuestas elimina el comentario y con respuestas deja un hueco", () => {
  const solo = repo.createBookComment({
    bookId: "bok_1",
    authorId: "usr_lucia",
    body: "Este comentario se va a borrar sin dejar rastro.",
    spoiler: false,
  });
  const before = repo.listBookComments("bok_1", visitante).total;
  repo.deleteBookComment(solo.id, { id: "usr_lucia", isAdmin: false });
  assert.equal(repo.listBookComments("bok_1", visitante).total, before - 1);

  const root = repo.createBookComment({
    bookId: "bok_1",
    authorId: "usr_lucia",
    body: "Este comentario tiene respuestas y debe conservar el hueco.",
    spoiler: false,
  });
  repo.createBookComment({
    bookId: "bok_1",
    authorId: "usr_clara",
    body: "Respondo antes de que se borre el comentario principal.",
    spoiler: false,
    parentId: root.id,
  });
  repo.deleteBookComment(root.id, { id: "usr_lucia", isAdmin: false });

  const thread = repo.listBookComments("bok_1", visitante);
  const tombstone = thread.comments.find((comment) => comment.id === root.id);
  assert.ok(tombstone, "el comentario eliminado sigue en el hilo");
  assert.equal(tombstone!.deleted, true);
  assert.equal(tombstone!.body, "");
  assert.equal(tombstone!.replies.length, 1);
  assert.equal(tombstone!.canDelete, false);

  // Y nadie más puede borrarlo.
  assert.throws(
    () => repo.deleteBookComment(root.id, { id: "usr_clara", isAdmin: false }),
    fails("propios"),
  );
});

test("un comentario oculto por moderación solo lo ve su autor y se puede restablecer", () => {
  const comment = repo.createBookComment({
    bookId: "bok_3",
    authorId: "usr_marcos",
    body: "Comentario que la moderación va a ocultar por su contenido.",
    spoiler: false,
  });

  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "comment",
    targetId: comment.id,
    reason: "Contenido inapropiado",
    details: "",
  });
  const reports = repo.listReports();
  assert.ok(
    reports.some(
      (report) => report.targetType === "comment" && report.targetLabel.includes("moderación"),
    ),
  );

  repo.moderateTarget("usr_admin", {
    action: "hide_comment",
    targetType: "comment",
    targetId: comment.id,
  });

  const forOthers = repo.listBookComments("bok_3", visitante);
  assert.equal(
    forOthers.comments.some((item) => item.id === comment.id),
    false,
  );
  const forAuthor = repo.listBookComments("bok_3", { id: "usr_marcos", isAdmin: false });
  const own = forAuthor.comments.find((item) => item.id === comment.id);
  assert.ok(own);
  assert.equal(own!.hidden, true);

  // El autor recibe el aviso de moderación.
  assert.ok(
    repo
      .listNotifications("usr_marcos")
      .some((notification) => notification.type === "moderation" && notification.bookId === "bok_3"),
  );

  assert.ok(repo.listHiddenComments().some((item) => item.id === comment.id));

  repo.moderateTarget("usr_admin", {
    action: "restore_comment",
    targetType: "comment",
    targetId: comment.id,
  });
  assert.equal(
    repo.listBookComments("bok_3", visitante).comments.some((item) => item.id === comment.id),
    true,
  );
  assert.equal(repo.listHiddenComments().some((item) => item.id === comment.id), false);
});

test("los bloqueos y las cuentas suspendidas se aplican en la consulta", () => {
  const blocked = repo.createBookComment({
    bookId: "bok_2",
    authorId: "usr_diego",
    body: "Comentario de alguien a quien Ana va a bloquear.",
    spoiler: false,
  });
  repo.blockUser("usr_ana", "usr_diego");
  const anaView = repo.listBookComments("bok_2", { id: "usr_ana", isAdmin: false });
  assert.equal(
    anaView.comments.some((item) => item.id === blocked.id),
    false,
  );
  const othersView = repo.listBookComments("bok_2", { id: "usr_clara", isAdmin: false });
  assert.equal(
    othersView.comments.some((item) => item.id === blocked.id),
    true,
  );

  const suspendedAuthor = repo.createBookComment({
    bookId: "bok_2",
    authorId: "usr_lucia",
    body: "Comentario de una cuenta que se va a suspender después.",
    spoiler: false,
  });
  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Comportamiento abusivo",
    details: "",
  });
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
  });
  assert.equal(
    repo
      .listBookComments("bok_2", null)
      .comments.some((item) => item.id === suspendedAuthor.id),
    false,
  );
  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_lucia",
  });
});

test("responder avisa a quien escribió el comentario, no a todo el mundo", () => {
  const root = repo.createBookComment({
    bookId: "bok_4",
    authorId: "usr_clara",
    body: "Comentario que va a recibir una respuesta y un aviso.",
    spoiler: false,
  });
  const before = repo.listNotifications("usr_clara").length;
  repo.createBookComment({
    bookId: "bok_4",
    authorId: "usr_ana",
    body: "Respuesta que debe generar un aviso para Clara.",
    spoiler: false,
    parentId: root.id,
  });
  const notifications = repo.listNotifications("usr_clara");
  assert.equal(notifications.length, before + 1);
  const notice = notifications[0]!;
  assert.equal(notice.type, "comment");
  assert.equal(notice.bookId, "bok_4");
  assert.ok(notice.title.includes("respondió"));
});

test("no se puede denunciar el propio comentario ni uno ya eliminado", () => {
  const own = repo.createBookComment({
    bookId: "bok_5",
    authorId: "usr_ana",
    body: "Comentario propio que no se puede denunciar a uno mismo.",
    spoiler: false,
  });
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_ana",
        targetType: "comment",
        targetId: own.id,
        reason: "Otro",
        details: "",
      }),
    fails("no existe"),
  );
});

test("la ficha de la obra reúne el título y sus copias", () => {
  const book = repo.getBook("bok_1");
  assert.ok(book);
  assert.equal(book!.title.length > 0, true);
  const copies = repo.listingsForBook("bok_1", "usr_ana");
  assert.ok(copies.length > 0);
  assert.ok(copies.every((copy) => copy.bookId === "bok_1"));
  assert.equal(repo.getBook("bok_inexistente"), null);
});
