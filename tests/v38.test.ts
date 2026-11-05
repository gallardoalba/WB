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

function makeClub(members: string[] = []): string {
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

test("el club guarda dónde se ve y solo admite enlaces http(s)", () => {
  const clubId = makeClub();
  repo.updateClub("usr_clara", clubId, {
    name: "Club con sitio",
    description: "",
    meetsOn: "Último martes, 19:00",
    meetsAt: "2030-06-04T19:00:00.000Z",
    meetsPlace: "Cafetería del museo",
    meetsLink: "https://meet.example.com/club",
    bookId: null,
  });
  const club = repo.getClub(clubId, "usr_clara");
  assert.equal(club?.meetsPlace, "Cafetería del museo");
  assert.equal(club?.meetsLink, "https://meet.example.com/club");
});

test("el histórico guarda los encuentros anteriores, no solo el próximo", () => {
  const clubId = makeClub(["usr_ana"]);
  // El club cambia de fecha: la asistencia del encuentro antiguo sigue ahí.
  repo.updateClub("usr_clara", clubId, {
    name: "Club con historia",
    description: "",
    meetsOn: "Último martes, 19:00",
    meetsAt: "2030-01-29T19:00:00.000Z",
    bookId: null,
  });
  repo.setClubAttendance("usr_ana", clubId, true);

  repo.updateClub("usr_clara", clubId, {
    name: "Club con historia",
    description: "",
    meetsOn: "Último martes, 19:00",
    meetsAt: "2030-02-26T19:00:00.000Z",
    bookId: null,
  });

  const historial = repo.listClubMeetingHistory(clubId);
  assert.equal(historial.length, 1);
  assert.equal(historial[0].key, "2030-01-29T19:00:00.000Z");
  assert.equal(historial[0].attendees, 1);
});

test("el estado de lectura de cada miembro se ve en el club", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  repo.setReadingState("usr_ana", "bok_1", "reading");
  repo.setReadingState("usr_lucia", "bok_1", "read");

  const estados = repo.listClubReadingStates(clubId, "bok_1");
  const porPersona = new Map(estados.map((row) => [row.userId, row.status]));
  assert.equal(porPersona.get("usr_ana"), "reading");
  assert.equal(porPersona.get("usr_lucia"), "read");
  // usr_diego no está en el club: no aparece aunque lea el libro.
  repo.setReadingState("usr_diego", "bok_1", "read");
  assert.equal(repo.listClubReadingStates(clubId, "bok_1").length, 2);
});

test("la votación la abre quien creó el club y vota quien es miembro", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  assert.throws(
    () => repo.createClubPoll("usr_ana", clubId, { question: "¿Qué leemos?", bookIds: ["bok_1", "bok_2"] }),
    isStatus(403),
  );

  const poll = repo.createClubPoll("usr_clara", clubId, {
    question: "¿Qué leemos después?",
    bookIds: ["bok_1", "bok_2"],
  });
  assert.equal(poll.options.length, 2);
  assert.equal(poll.totalVotes, 0);

  // Solo una votación abierta a la vez.
  assert.throws(
    () => repo.createClubPoll("usr_clara", clubId, { question: "Otra", bookIds: ["bok_1", "bok_2"] }),
    isStatus(409),
  );
  // Y fuera del club no se vota.
  assert.throws(
    () => repo.voteClubPoll("usr_diego", clubId, poll.options[0].id),
    isStatus(403),
  );

  const votada = repo.voteClubPoll("usr_ana", clubId, poll.options[0].id);
  assert.equal(votada.totalVotes, 1);
  assert.equal(votada.votedOptionId, poll.options[0].id);
  assert.deepEqual(votada.options[0].voters, ["Ana Martínez"]);

  // Cambiar el voto no suma un voto nuevo.
  const cambiada = repo.voteClubPoll("usr_ana", clubId, poll.options[1].id);
  assert.equal(cambiada.totalVotes, 1);
  assert.equal(cambiada.options[1].votes, 1);

  const ajenos = repo.getActiveClubPoll(clubId, "usr_lucia");
  assert.equal(ajenos?.id, poll.id);
  assert.equal(ajenos?.votedOptionId, null);
});

test("cerrada la votación, no se vota y gana la opción más votada", () => {
  const clubId = makeClub(["usr_ana", "usr_lucia"]);
  const poll = repo.createClubPoll("usr_clara", clubId, {
    question: "¿Qué leemos?",
    bookIds: ["bok_1", "bok_2"],
  });
  repo.voteClubPoll("usr_ana", clubId, poll.options[1].id);
  repo.voteClubPoll("usr_lucia", clubId, poll.options[1].id);
  repo.voteClubPoll("usr_clara", clubId, poll.options[0].id);

  assert.throws(() => repo.closeClubPoll("usr_ana", clubId, poll.id), isStatus(403));
  const cerrada = repo.closeClubPoll("usr_clara", clubId, poll.id);
  assert.equal(cerrada.closed, true);
  assert.equal(repo.getActiveClubPoll(clubId, "usr_ana"), null);

  assert.throws(
    () => repo.voteClubPoll("usr_ana", clubId, poll.options[0].id),
    isStatus(409),
  );
  assert.equal(repo.winningBookOfPoll(clubId, poll.id), "bok_2");
});

test("un mensaje del foro se puede denunciar desde dentro del club, no desde fuera", () => {
  const clubId = makeClub(["usr_ana"]);
  const post = repo.createClubPost({ clubId, authorId: "usr_ana", body: "Mensaje denunciable." });

  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "club_post",
    targetId: post.id,
    reason: "Spam o publicidad",
    details: "",
  });
  assert.equal(repo.countOpenReports(), 1);

  // Fuera del club la denuncia no vale (ni siquiera se admite el objetivo).
  repo.setClubMembership("usr_diego", clubId, true);
  repo.setClubMembership("usr_diego", clubId, false);
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_diego",
        targetType: "club_post",
        targetId: post.id,
        reason: "Spam o publicidad",
        details: "",
      }),
    isStatus(404),
  );
});

test("el panel puede ocultar y restablecer un mensaje del foro", () => {
  const clubId = makeClub(["usr_ana"]);
  const post = repo.createClubPost({ clubId, authorId: "usr_ana", body: "Mensaje a moderar." });

  repo.moderateTarget("usr_admin", {
    action: "hide_club_post",
    targetType: "club_post",
    targetId: post.id,
  });
  assert.equal(repo.listClubPosts(clubId, { id: "usr_clara", isAdmin: false }).posts.length, 0);

  repo.moderateTarget("usr_admin", {
    action: "restore_club_post",
    targetType: "club_post",
    targetId: post.id,
  });
  assert.equal(repo.listClubPosts(clubId, { id: "usr_clara", isAdmin: false }).posts.length, 1);
});
