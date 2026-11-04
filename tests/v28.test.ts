import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type DbModule = typeof import("../src/lib/db.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db.ts");
  repo = await import("../src/lib/repo.ts");
});

const isConflict = (error: unknown) =>
  error instanceof Error && "status" in error && (error as { status: number }).status === 409;

test("el esquema v26 crea los índices que faltaban", () => {
  const listings = (dbModule.getDb().pragma("index_list(listings)") as { name: string }[]).map(
    (row) => row.name,
  );
  assert.ok(listings.includes("listings_book"), "falta listings(book_id)");
  const outbox = (dbModule.getDb().pragma("index_list(mail_outbox)") as { name: string }[]).map(
    (row) => row.name,
  );
  assert.ok(outbox.includes("mail_outbox_to"), "falta mail_outbox(to_email)");
});

test("borrar la cuenta del solicitante devuelve el ejemplar a disponible", () => {
  // req_seed_2: usr_diego pide lst_1 (de usr_clara) y ella acepta.
  const accepted = repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
  assert.equal(accepted.status, "accepted");
  assert.equal(repo.getListing("lst_1", "usr_clara")?.status, "reserved");

  repo.deleteAccount("usr_diego");

  const request = dbModule
    .getDb()
    .prepare("SELECT status FROM requests WHERE id = 'req_seed_2'")
    .get() as { status: string };
  assert.equal(request.status, "cancelled");
  // Sin liberar el ejemplar, ni siquiera la dueña podría desbloquearlo a mano.
  assert.equal(repo.getListing("lst_1", "usr_clara")?.status, "available");
  repo.setListingStatus("usr_clara", "lst_1", "paused");
  repo.setListingStatus("usr_clara", "lst_1", "available");
});

test("borrar la cuenta de la dueña retira su ejemplar y cancela el intercambio", () => {
  const request = repo.createRequest("usr_marcos", "lst_3", "");
  repo.updateRequestStatus(request.id, "usr_lucia", "accepted");
  assert.equal(repo.getListing("lst_3", "usr_lucia")?.status, "reserved");

  repo.deleteAccount("usr_lucia");

  const listing = dbModule
    .getDb()
    .prepare("SELECT status FROM listings WHERE id = 'lst_3'")
    .get() as { status: string };
  // El ejemplar de la cuenta borrada sale del catálogo, no vuelve a `available`.
  assert.equal(listing.status, "removed");
});

test("una solicitud cancelada ya no se puede aceptar", () => {
  const request = repo.createRequest("usr_marcos", "lst_5", "");
  repo.updateRequestStatus(request.id, "usr_marcos", "cancelled");
  assert.throws(() => repo.updateRequestStatus(request.id, "usr_clara", "accepted"), isConflict);
  assert.equal(
    (
      dbModule
        .getDb()
        .prepare("SELECT status FROM requests WHERE id = ?")
        .get(request.id) as { status: string }
    ).status,
    "cancelled",
  );
});

test("el cierre bilateral no completa dos veces ni revierte", () => {
  const request = repo.createRequest("usr_ana", "lst_4", "");
  repo.updateRequestStatus(request.id, "usr_marcos", "accepted");
  const first = repo.updateRequestStatus(request.id, "usr_marcos", "completed");
  assert.equal(first.status, "accepted");
  assert.equal(first.confirmedByMe, true);

  // Quien recibe introduce el código que muestra quien entrega.
  const { handover_code: code } = dbModule
    .getDb()
    .prepare("SELECT handover_code FROM requests WHERE id = ?")
    .get(request.id) as { handover_code: string };
  const second = repo.updateRequestStatus(request.id, "usr_ana", "completed", {
    handoverCode: code,
  });
  assert.equal(second.status, "completed");

  assert.throws(() => repo.updateRequestStatus(request.id, "usr_ana", "completed"), isConflict);
});

test("en producción un correo fallido no se da por entregado", async () => {  const { sendMail } = await import("../src/lib/mailer.ts");
  const env = process.env as Record<string, string | undefined>;
  const previousEnv = env.NODE_ENV;
  const previousWebhook = env.MAIL_WEBHOOK_URL;
  env.NODE_ENV = "production";
  delete env.MAIL_WEBHOOK_URL;
  try {
    const result = await sendMail({
      to: "persona@example.test",
      subject: "Restablece tu contraseña",
      text: "https://example.test/restablecer?token=secreto-de-un-solo-uso",
    });
    // Sin proveedor no hay entrega: la cola debe reintentar y el token no se
    // escribe en `.data/outbox/`.
    assert.equal(result.delivered, false);
  } finally {
    env.NODE_ENV = previousEnv;
    if (previousWebhook === undefined) delete env.MAIL_WEBHOOK_URL;
    else env.MAIL_WEBHOOK_URL = previousWebhook;
  }
});

test("los préstamos del club solo los ve quien es miembro", () => {
  const club = repo.createClub("usr_clara", {
    name: "Club de préstamos privados",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
    joinPolicy: "open",
  });
  repo.setClubMembership("usr_marcos", club.id, true);
  repo.createClubLoan({
    clubId: club.id,
    listingId: "lst_1",
    lenderId: "usr_clara",
    borrowerId: "usr_marcos",
  });

  assert.equal(repo.listClubLoans(club.id, "usr_clara").length, 1);
  assert.equal(repo.listClubLoans(club.id, "usr_marcos").length, 1);
  // usr_ana no pertenece al club: no debe ver quién presta qué.
  assert.deepEqual(repo.listClubLoans(club.id, "usr_ana"), []);
});

test("marcar como leída una conversación ajena se rechaza", () => {
  assert.throws(
    () => repo.markRequestRead("usr_ana", "req_seed_2"),
    (error: unknown) =>
      error instanceof Error && "status" in error && (error as { status: number }).status === 404,
  );
  repo.markRequestRead("usr_clara", "req_seed_2");
});
