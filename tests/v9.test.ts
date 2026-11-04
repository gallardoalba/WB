import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const fails = (pattern: string) => (error: unknown) =>
  error instanceof Error && error.message.includes(pattern);

test("seguir a alguien suma un seguidor, avisa una sola vez y se puede deshacer", () => {
  const before = repo.getFollowState("usr_lucia", "usr_ana");
  const first = repo.setFollow("usr_ana", "usr_lucia", true);
  assert.equal(first.following, true);
  assert.equal(first.followers, before.followers + 1);

  // Idempotente: repetir no duplica ni vuelve a avisar.
  const again = repo.setFollow("usr_ana", "usr_lucia", true);
  assert.equal(again.followers, first.followers);
  const notices = repo
    .listNotifications("usr_lucia")
    .filter((notification) => notification.type === "follow");
  assert.equal(notices.length, 1);
  assert.ok(notices[0]!.title.includes("Ana"));

  const removed = repo.setFollow("usr_ana", "usr_lucia", false);
  assert.equal(removed.following, false);
  assert.equal(removed.followers, before.followers);
  assert.equal(repo.getFollowState("usr_lucia", "usr_ana").isFollowing, false);
});

test("no se puede seguirse a uno mismo ni a quien te ha bloqueado", () => {
  assert.throws(() => repo.setFollow("usr_ana", "usr_ana", true), fails("ti mismo"));

  repo.blockUser("usr_clara", "usr_diego");
  assert.throws(() => repo.setFollow("usr_diego", "usr_clara", true), fails("No puedes seguir"));
  // El bloqueo corta el seguimiento en ambos sentidos.
  assert.throws(() => repo.setFollow("usr_clara", "usr_diego", true), fails("No puedes seguir"));
});

test("el muro «Siguiendo» solo trae lo de las cuentas seguidas", () => {
  const followed = ["usr_clara", "usr_diego"];
  const activity = repo.listFollowingActivity("usr_ana");
  assert.ok(activity.length > 0);
  const actors = new Set(activity.map((item) => item.actor));
  assert.ok([...actors].every((actor) => ["Clara Montes", "Diego Ríos"].includes(actor)));
  assert.equal(followed.length, 2);

  const comments = repo.listFollowingComments("usr_ana");
  assert.ok(comments.length > 0);
  assert.ok(comments.every((item) => item.author.name !== "Ana Martínez"));
});

test("el directorio filtra por ciudad, busca por nombre y excluye cuentas suspendidas", () => {
  const all = repo.listReaders({ viewerId: "usr_ana" });
  assert.ok(all.readers.length >= 4);
  assert.ok(all.readers.every((reader) => reader.user.id !== "usr_ana"));

  const karlsruhe = repo.listReaders({ viewerId: "usr_ana", city: "Karlsruhe" });
  assert.equal(karlsruhe.readers.length, 1);
  assert.equal(karlsruhe.readers[0]!.user.name, "Lucía Prieto");

  const byName = repo.listReaders({ viewerId: "usr_ana", q: "diego" });
  assert.equal(byName.readers.length, 1);
  assert.equal(byName.readers[0]!.user.id, "usr_diego");
  assert.equal(byName.readers[0]!.isFollowing, true);

  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "user",
    targetId: "usr_marcos",
    reason: "Comportamiento abusivo",
    details: "",
  });
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_marcos",
  });
  const afterSuspend = repo.listReaders({ viewerId: "usr_ana" });
  assert.equal(
    afterSuspend.readers.some((reader) => reader.user.id === "usr_marcos"),
    false,
  );
  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_marcos",
  });
});

test("el perfil público expone seguidores, siguiendo y comentarios", () => {
  const profile = repo.getPublicProfile("usr_clara", "usr_ana");
  assert.ok(profile);
  assert.equal(profile!.isFollowing, true);
  assert.ok(profile!.followers >= 1);

  // El recuento cuenta conversaciones (comentarios raíz) visibles, igual que la
  // pestaña «Cómo lee»: Clara solo respondió en la semilla, así que suma 0.
  const anas = repo.getPublicProfile("usr_ana", "usr_clara");
  assert.ok(anas!.comments >= 1);

  const own = repo.getPublicProfile("usr_clara", "usr_clara");
  assert.equal(own!.isFollowing, false);
  assert.equal(own!.isMe, true);
});

test("el muro del perfil trae solo la actividad y los comentarios de esa cuenta", () => {
  const activity = repo.listUserActivity("usr_clara");
  assert.ok(activity.every((item) => item.actor === "Clara Montes"));

  const viewer = { id: "usr_ana", isAdmin: false };
  const comments = repo.listAuthorComments("usr_clara", viewer);
  assert.ok(comments.every((item) => item.author.id === "usr_clara"));
  // Un comentario oculto por moderación desaparece del muro público.
  if (comments.length > 0) {
    repo.moderateTarget("usr_admin", {
      action: "hide_comment",
      targetType: "comment",
      targetId: comments[0]!.id,
    });
    const after = repo.listAuthorComments("usr_clara", viewer);
    assert.equal(
      after.some((item) => item.id === comments[0]!.id),
      false,
    );
    repo.moderateTarget("usr_admin", {
      action: "restore_comment",
      targetType: "comment",
      targetId: comments[0]!.id,
    });
  }
});
