import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db.ts");
type OfficesModule = typeof import("../src/lib/post-offices.ts");
type E2eModule = typeof import("../src/lib/e2e.ts");

let repo: RepoModule;
let dbModule: DbModule;
let offices: OfficesModule;
let e2e: E2eModule;
let encryptedMessageId = "";

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db.ts");
  offices = await import("../src/lib/post-offices.ts");
  e2e = await import("../src/lib/e2e.ts");
});

test("la base incluye punto de entrega y sobre cifrado", () => {
  const db = dbModule.getDb();
  assert.equal(db.pragma("user_version", { simple: true }), dbModule.SCHEMA_VERSION);
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
  assert.ok(columns("requests").includes("handover_office_id"));
  for (const column of ["ciphertext", "iv", "encrypted"]) {
    assert.ok(columns("messages").includes(column), `falta ${column}`);
  }
});

test("las ciudades de Baden-Württemberg tienen una oficina de Deutsche Post cerca", () => {
  const badenWuerttemberg = ["Stuttgart", "Freiburg im Breisgau", "Tübingen", "Mannheim", "Ulm"];
  for (const name of badenWuerttemberg) {
    const office = offices.nearestPostOffice(name);
    assert.ok(office, `sin oficina para ${name}`);
    assert.ok(office!.street, `sin dirección para ${name}`);
    assert.ok(office!.distanceKm <= 20, `${name} queda a ${office!.distanceKm} km`);
  }
  // Fuera del conjunto cubierto no se propone una oficina lejana.
  assert.equal(offices.nearestPostOffice("Berlin"), null);
  assert.deepEqual(offices.officesForCity("München"), []);
  assert.ok(offices.officesForCity("Stuttgart").every((office) => office.distanceKm <= 25));
  // El identificador de una oficina desconocida no se resuelve.
  assert.equal(offices.findPostOffice("dp_inventada"), null);
});

test("aceptar fija la oficina más cercana a quien entrega el libro", () => {
  const updated = repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
  assert.equal(updated.status, "accepted");
  assert.equal(updated.delivery.method, "pickup");
  const expected = offices.nearestPostOffice("Stuttgart")!;
  assert.equal(updated.delivery.pickupPoint?.id, expected.id);
  assert.equal(updated.delivery.pickupPoint?.street, expected.street);

  // El aviso lleva el local público, nunca una dirección privada.
  const notification = repo
    .listNotifications("usr_diego")
    .find((item) => item.requestId === "req_seed_2");
  assert.ok(notification);
  assert.match(notification!.body, /Punto de entrega/);
});

test("cualquiera de las dos partes puede cambiar el punto de entrega", () => {
  const alternative = offices.officesForCity("Mannheim", 2)[1]!;
  const updated = repo.setHandoverOffice("req_seed_2", "usr_diego", alternative.id);
  assert.equal(updated.delivery.pickupPoint?.id, alternative.id);

  assert.throws(
    () => repo.setHandoverOffice("req_seed_2", "usr_diego", "dp_inventada"),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );
  assert.throws(
    () => repo.setHandoverOffice("req_seed_2", "usr_lucia", alternative.id),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );
});

test("los mensajes cifrados no dejan texto plano en el servidor", async () => {
  const pairA = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const pairB = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicA = await crypto.subtle.exportKey("jwk", pairA.publicKey);
  const publicB = await crypto.subtle.exportKey("jwk", pairB.publicKey);
  const keyIdA = await e2e.keyIdFromJwk(publicA);
  const keyIdB = await e2e.keyIdFromJwk(publicB);
  repo.setPublicKey("usr_diego", publicA);
  repo.setPublicKey("usr_clara", publicB);
  assert.equal(repo.getPublicKey("usr_diego")?.x, publicA.x);
  assert.equal(repo.getPublicKeyRecord("usr_diego")?.keyId, keyIdA);

  const keyA = await e2e.deriveConversationKey(pairA.privateKey, publicB, "req_seed_2");
  const aad = e2e.messageAad("req_seed_2", "usr_diego", keyIdA);
  const envelope = await e2e.encryptMessage(keyA, "Quedamos el sábado a las 11", aad);
  const message = repo.addEncryptedMessage(
    "req_seed_2",
    "usr_diego",
    envelope.ciphertext,
    envelope.iv,
    keyIdA,
  );
  encryptedMessageId = message.id;
  assert.equal(message.encrypted, true);
  assert.equal(message.body, "");

  const thread = repo.listMessages("req_seed_2", "usr_clara");
  const stored = thread.messages.find((item) => item.id === message.id)!;
  assert.equal(stored.body, "");
  assert.equal(stored.encrypted, true);
  assert.equal(stored.ciphertext, envelope.ciphertext);
  assert.equal(stored.keyId, keyIdA);

  const keyB = await e2e.deriveConversationKey(pairB.privateKey, publicA, "req_seed_2");
  const plaintext = await e2e.decryptMessage(
    keyB,
    {
      ciphertext: stored.ciphertext!,
      iv: stored.iv!,
    },
    aad,
  );
  assert.equal(plaintext, "Quedamos el sábado a las 11");
  // La huella de la clave forma parte del sobre: sin ella no descifra.
  assert.equal(
    await e2e.decryptMessage(keyB, { ciphertext: stored.ciphertext!, iv: stored.iv! }),
    null,
  );
  assert.equal(keyIdB.length, 43);
  assert.throws(
    () => repo.addEncryptedMessage("req_seed_2", "usr_diego", envelope.ciphertext, envelope.iv, keyIdB),
    (error: unknown) => error instanceof Error && error.message.includes("clave"),
  );

  // Con las dos claves publicadas, el texto plano ya no se acepta.
  assert.throws(
    () => repo.addMessage("req_seed_2", "usr_clara", "Hola en claro"),
    (error: unknown) => error instanceof Error && error.message.includes("cifrado"),
  );

  // El aviso no filtra el contenido.
  assert.ok(
    repo
      .listNotifications("usr_clara")
      .every((notification) => !notification.body.includes("Quedamos")),
  );
});

test("la moderación no puede leer el mensaje y pide contexto", () => {
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_clara",
        targetType: "message",
        targetId: encryptedMessageId,
        reason: "Comportamiento abusivo",
        details: "",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("Describe"),
  );
  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "message",
    targetId: encryptedMessageId,
    reason: "Comportamiento abusivo",
    details: "Me está acosando en los mensajes del intercambio.",
  });
  const report = repo.listReports().find((item) => item.targetId === encryptedMessageId);
  assert.ok(report);
  assert.match(report!.targetLabel, /cifrado/i);
});

test("los avisos de ciudad llegan al publicar y se pueden desactivar", () => {
  repo.setAvailabilityAlert("usr_ana", "Stuttgart", true);
  assert.deepEqual(repo.listAvailabilityAlerts("usr_ana"), ["Stuttgart"]);

  const listing = repo.createListing("usr_clara", {
    title: "Novedad de prueba",
    author: "Autora de prueba",
    category: "Ficción",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: [],
  });
  const alert = repo
    .listNotifications("usr_ana")
    .find((item) => item.type === "availability" && item.listingId === listing.id);
  assert.ok(alert, "falta el aviso de disponibilidad");
  assert.match(alert!.body, /Novedad de prueba/);
  assert.ok(alert!.link?.startsWith("/libro/"));

  // Quien publica no se avisa a sí mismo.
  assert.ok(
    repo
      .listNotifications("usr_clara")
      .every((item) => item.type !== "availability" || item.listingId !== listing.id),
  );

  repo.setAvailabilityAlert("usr_ana", "Stuttgart", false);
  assert.deepEqual(repo.listAvailabilityAlerts("usr_ana"), []);
  const again = repo.createListing("usr_clara", {
    title: "Otra novedad",
    author: "Autora de prueba",
    category: "Ficción",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: [],
  });
  assert.ok(
    repo.listNotifications("usr_ana").every((item) => item.listingId !== again.id),
  );
});

test("el secreto TOTP se guarda cifrado y sigue funcionando", async () => {
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  const totp = await import("../src/lib/totp.ts");
  const setup = repo.startTotpSetup("usr_marcos");
  const stored = dbModule
    .getDb()
    .prepare("SELECT totp_secret FROM users WHERE id = ?")
    .get("usr_marcos") as { totp_secret: string };
  assert.match(stored.totp_secret, /^enc:v1:/);
  assert.equal(stored.totp_secret.includes(setup.secret), false);

  const code = totp.totpCode(setup.secret, totp.totpStep());
  repo.enableTotp("usr_marcos", code);
  assert.equal(repo.getTotpState("usr_marcos").enabled, true);
  repo.disableTotp("usr_marcos");
  delete process.env.APP_ENCRYPTION_KEY;
});

test("borrar la cuenta limpia clave, TOTP, alertas y correo pendiente", () => {
  const user = repo.createUser({
    name: "Cuenta temporal",
    email: "temporal@wanderbibliothek.test",
    passwordHash: "scrypt$00$00",
    city: "Stuttgart",
  });
  repo.setAvailabilityAlert(user.id, "Stuttgart", true);
  repo.setPublicKey(user.id, { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) });
  repo.notify({ userId: user.id, type: "message", title: "Aviso", body: "Texto" });
  assert.equal(
    (dbModule.getDb().prepare("SELECT COUNT(*) AS count FROM mail_outbox WHERE to_email = ?").get(
      "temporal@wanderbibliothek.test",
    ) as { count: number }).count,
    1,
  );

  repo.deleteAccount(user.id);
  const row = dbModule
    .getDb()
    .prepare("SELECT email, public_key, public_key_id, totp_secret FROM users WHERE id = ?")
    .get(user.id) as {
    email: string;
    public_key: string | null;
    public_key_id: string | null;
    totp_secret: string | null;
  };
  assert.match(row.email, /^deleted-/);
  assert.equal(row.public_key, null);
  assert.equal(row.public_key_id, null);
  assert.equal(row.totp_secret, null);
  assert.equal(
    (dbModule
      .getDb()
      .prepare("SELECT COUNT(*) AS count FROM availability_alerts WHERE user_id = ?")
      .get(user.id) as { count: number }).count,
    0,
  );
});

test("la solicitud no guarda el texto inicial en claro", () => {
  const created = repo.createRequest("usr_ana", "lst_3", "mi dirección privada");
  assert.equal("message" in created, false);
  const row = dbModule
    .getDb()
    .prepare("SELECT message FROM requests WHERE id = ?")
    .get(created.id) as { message: string };
  assert.equal(row.message, "");
});
