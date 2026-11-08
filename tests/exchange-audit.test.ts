/**
 * Auditoría del intercambio: del «quiero este libro» al «lo he recibido».
 *
 * `repo.test.ts` ya cubre el camino feliz (aceptar reserva y expira rivales, el
 * cierre bilateral, la valoración única). Lo que faltaba era lo que ocurre
 * cuando algo se tuerce o cuando alguien intenta saltarse las reglas: es donde
 * un intercambio deja ejemplares bloqueados, conversaciones abiertas a terceros
 * o un libro «entregado» que nunca se entregó. Eso es lo que se fija aquí.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
});

let counter = 0;

/** Ejemplar nuevo de cada prueba: así ninguna depende del estado de la anterior. */
function nuevoEjemplar(ownerId = "usr_clara") {
  counter += 1;
  return repo.createListing(ownerId, {
    title: `Libro de prueba ${counter}`,
    author: "Autora de prueba",
    category: "Ficción",
    language: "Español",
    condition: "Buen estado",
    city: "Stuttgart",
    isbn: null,
    tags: [],
  });
}

const estado = (requestId: string, viewerId: string) =>
  repo.listRequests(viewerId).find((request) => request.id === requestId)?.status;

const estadoDelEjemplar = (listingId: string, viewerId = "usr_clara") =>
  repo.getListing(listingId, viewerId)?.status;

/** Avisos que ha recibido alguien, por título. */
const avisos = (userId: string) => repo.listNotifications(userId, { limit: 50 });

function avisoConTitulo(userId: string, title: string) {
  return avisos(userId).find((aviso) => aviso.title === title);
}

const errorDe = (action: () => unknown): Error & { status?: number } => {
  try {
    action();
  } catch (error) {
    return error as Error & { status?: number };
  }
  assert.fail("se esperaba un error y no lo hubo");
};

/* ------------------------- pedir un ejemplar ---------------------------- */

test("no se puede solicitar el ejemplar propio", () => {
  const listing = nuevoEjemplar("usr_clara");
  const error = errorDe(() => repo.createRequest("usr_clara", listing.id));
  assert.equal(error.status, 409);
  assert.match(error.message, /tu propio ejemplar/);
});

test("una segunda solicitud pendiente al mismo ejemplar se rechaza", () => {
  const listing = nuevoEjemplar();
  repo.createRequest("usr_diego", listing.id);
  const error = errorDe(() => repo.createRequest("usr_diego", listing.id));
  assert.equal(error.status, 409);
  assert.match(error.message, /Ya has enviado una solicitud/);
});

test("un ejemplar retirado no admite solicitudes", () => {
  const listing = nuevoEjemplar();
  repo.removeListing("usr_clara", listing.id);
  const error = errorDe(() => repo.createRequest("usr_diego", listing.id));
  assert.equal(error.status, 404);
});

test("el mensaje que viaje con la solicitud no se guarda: la conversación empieza al aceptar", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id, "Hola, ¿me lo guardas?");
  // La firma lo acepta por compatibilidad, pero el texto se descarta: guardarlo
  // sería una conversación abierta antes de que el dueño diga nada.
  assert.deepEqual(repo.listMessages(request.id, "usr_diego").messages, []);
});

/* --------------------- aceptar, rechazar, cancelar ---------------------- */

test("aceptar reserva el ejemplar y deja rastro del evento", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");

  assert.equal(estadoDelEjemplar(listing.id), "reserved");
  const eventos = dbModule
    .getDb()
    .prepare("SELECT type, actor_id FROM events WHERE request_id = ? ORDER BY rowid")
    .all(request.id) as { type: string; actor_id: string }[];
  assert.deepEqual(
    eventos.map((evento) => evento.type),
    ["requested", "accepted"],
  );
  assert.equal(eventos[1]!.actor_id, "usr_clara");
});

test("rechazar devuelve el ejemplar al catálogo", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "declined");

  assert.equal(estado(request.id, "usr_diego"), "declined");
  assert.equal(estadoDelEjemplar(listing.id), "available");
});

test("cancelar por quien solicitó devuelve el ejemplar al catálogo", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  assert.equal(estadoDelEjemplar(listing.id), "reserved");

  repo.updateRequestStatus(request.id, "usr_diego", "cancelled");
  assert.equal(estadoDelEjemplar(listing.id), "available");
});

test("rechazar no libera el ejemplar si otro intercambio sigue aceptado", () => {
  // Dos solicitudes aceptadas a la vez no se alcanzan por la interfaz (aceptar
  // exige el ejemplar disponible), pero la comprobación existe para que una
  // carrera no devuelva al catálogo un libro que otro ya tiene reservado.
  const listing = nuevoEjemplar();
  const primero = repo.createRequest("usr_diego", listing.id);
  const segundo = repo.createRequest("usr_marcos", listing.id);
  const db = dbModule.getDb();
  db.prepare("UPDATE requests SET status = 'accepted' WHERE id IN (?, ?)").run(
    primero.id,
    segundo.id,
  );
  db.prepare("UPDATE listings SET status = 'reserved' WHERE id = ?").run(listing.id);

  repo.updateRequestStatus(segundo.id, "usr_marcos", "cancelled");
  assert.equal(estadoDelEjemplar(listing.id), "reserved", "el otro cierre manda");
});

test("quien solicita no puede aceptar su propia solicitud", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  const error = errorDe(() => repo.updateRequestStatus(request.id, "usr_diego", "accepted"));
  assert.equal(error.status, 409);
});

test("un tercero no puede mover la solicitud de otros", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  const error = errorDe(() => repo.updateRequestStatus(request.id, "usr_ana", "accepted"));
  assert.equal(error.status, 404, "ni siquiera se confirma que exista");
});

/* ------------------- confirmación de la recepción ----------------------- */

test("la primera confirmación avisa a la otra parte y no cierra el intercambio", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");

  repo.updateRequestStatus(request.id, "usr_clara", "completed");
  assert.equal(estado(request.id, "usr_diego"), "accepted", "una sola firma no basta");
  assert.equal(estadoDelEjemplar(listing.id), "reserved", "el libro sigue reservado");

  const aviso = avisoConTitulo("usr_diego", "Confirma la entrega");
  assert.ok(aviso, "la otra parte tiene que enterarse de que falta su confirmación");
  assert.match(aviso!.body, /ya ha confirmado/);
});

test("con las dos confirmaciones el intercambio se cierra y el libro queda entregado", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");

  repo.updateRequestStatus(request.id, "usr_diego", "completed");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");

  assert.equal(estado(request.id, "usr_diego"), "completed");
  assert.equal(estadoDelEjemplar(listing.id), "given");
  assert.ok(avisoConTitulo("usr_diego", "Intercambio completado"));
  const eventos = dbModule
    .getDb()
    .prepare("SELECT type FROM events WHERE request_id = ? AND type = 'completed'")
    .all(request.id) as { type: string }[];
  assert.equal(eventos.length, 1);
});

test("confirmar dos veces la misma parte no cierra el intercambio", () => {
  // Un doble clic no puede dar un libro por entregado sin la otra firma.
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");

  repo.updateRequestStatus(request.id, "usr_diego", "completed");
  repo.updateRequestStatus(request.id, "usr_diego", "completed");
  assert.equal(estado(request.id, "usr_diego"), "accepted");

  repo.updateRequestStatus(request.id, "usr_clara", "completed");
  assert.equal(estado(request.id, "usr_diego"), "completed");
});

test("un ejemplar retirado por moderación no resucita al cerrar el intercambio", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");

  dbModule
    .getDb()
    .prepare("UPDATE listings SET status = 'removed' WHERE id = ?")
    .run(listing.id);

  repo.updateRequestStatus(request.id, "usr_diego", "completed");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");

  const fila = dbModule
    .getDb()
    .prepare("SELECT status FROM listings WHERE id = ?")
    .get(listing.id) as { status: string };
  assert.equal(fila.status, "removed", "la retirada de moderación es definitiva");
});

test("un intercambio cerrado no admite más cambios", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  repo.updateRequestStatus(request.id, "usr_diego", "completed");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");

  for (const target of ["cancelled", "accepted", "declined"] as const) {
    const error = errorDe(() =>
      repo.updateRequestStatus(request.id, "usr_clara", target),
    );
    assert.equal(error.status, 409, `«${target}» no debería estar permitido`);
  }
});

/* ------------------------- conversación del intercambio ------------------ */

/** Intercambio aceptado listo para conversar. */
function intercambioAceptado(owner = "usr_clara", requester = "usr_diego") {
  const listing = nuevoEjemplar(owner);
  const request = repo.createRequest(requester, listing.id);
  repo.updateRequestStatus(request.id, owner, "accepted");
  return { listing, request };
}

test("no hay conversación mientras la solicitud está pendiente", () => {
  const listing = nuevoEjemplar();
  const request = repo.createRequest("usr_diego", listing.id);
  const error = errorDe(() => repo.addMessage(request.id, "usr_diego", "Hola"));
  assert.equal(error.status, 409);
  assert.match(error.message, /se abren cuando se acepta/);
});

test("al aceptar se abre la conversación y los dos pueden escribir", () => {
  const { request } = intercambioAceptado();
  const delSolicitante = repo.addMessage(request.id, "usr_diego", "¿Quedamos el sábado?");
  const delDueno = repo.addMessage(request.id, "usr_clara", "El sábado me viene bien");

  const hilo = repo.listMessages(request.id, "usr_clara");
  assert.deepEqual(
    hilo.messages.map((mensaje) => mensaje.body),
    ["¿Quedamos el sábado?", "El sábado me viene bien"],
  );
  // El orden es de conversación, no de consulta: el más antiguo primero.
  assert.equal(hilo.messages[0]!.isMine, false, "para Clara, el primero es de Diego");
  assert.equal(delSolicitante.sender.id, "usr_diego");
  assert.equal(delDueno.sender.id, "usr_clara");
});

test("un tercero no puede leer ni escribir la conversación", () => {
  const { request } = intercambioAceptado();
  assert.equal(errorDe(() => repo.listMessages(request.id, "usr_ana")).status, 404);
  assert.equal(errorDe(() => repo.addMessage(request.id, "usr_ana", "Hola")).status, 404);
});

test("cuando el intercambio se cierra no se escribe más, pero el hilo se puede releer", () => {
  const { request } = intercambioAceptado();
  repo.addMessage(request.id, "usr_diego", "Ya lo tengo en casa");
  repo.updateRequestStatus(request.id, "usr_diego", "completed");
  repo.updateRequestStatus(request.id, "usr_clara", "completed");

  const error = errorDe(() => repo.addMessage(request.id, "usr_clara", "Gracias"));
  assert.equal(error.status, 409);
  assert.match(error.message, /ya no se pueden enviar mensajes/);
  // El historial no se borra: sirve para saber qué se acordó.
  assert.equal(repo.listMessages(request.id, "usr_clara").messages.length, 1);
});

test("el aviso de un mensaje nuevo no lleva el texto", () => {
  const { request } = intercambioAceptado();
  repo.addMessage(request.id, "usr_diego", "Un secreto entre nosotros");
  const aviso = avisoConTitulo("usr_clara", "Nuevo mensaje en tu intercambio");
  assert.ok(aviso);
  assert.doesNotMatch(aviso!.body, /secreto/);
});

test("los mensajes no leídos se cuentan y se marcan como leídos", () => {
  const { request } = intercambioAceptado();
  const antes = repo.countUnreadMessages("usr_clara");
  const delOtroAntes = repo.countUnreadMessages("usr_diego");
  repo.addMessage(request.id, "usr_diego", "Uno");
  repo.addMessage(request.id, "usr_diego", "Dos");
  assert.equal(repo.countUnreadMessages("usr_clara"), antes + 2);

  repo.markRequestRead("usr_clara", request.id);
  assert.equal(repo.countUnreadMessages("usr_clara"), antes);
  // Que Clara lea el hilo no marca como leídos los mensajes que tiene Diego.
  assert.equal(repo.countUnreadMessages("usr_diego"), delOtroAntes);
});

test("la conversación se pagina hacia atrás sin perder mensajes", () => {
  const { request } = intercambioAceptado();
  for (let index = 0; index < 5; index += 1) {
    repo.addMessage(request.id, index % 2 === 0 ? "usr_diego" : "usr_clara", `Mensaje ${index}`);
  }
  const primera = repo.listMessages(request.id, "usr_clara", { limit: 2 });
  assert.equal(primera.messages.length, 2);
  assert.equal(primera.hasMore, true);
  const ultimoDeLaPrimera = primera.messages[0]!.id;

  const segunda = repo.listMessages(request.id, "usr_clara", {
    limit: 2,
    beforeId: ultimoDeLaPrimera,
  });
  assert.equal(segunda.messages.length, 2);
  assert.ok(
    !segunda.messages.some((mensaje) => mensaje.id === ultimoDeLaPrimera),
    "el cursor no repite el mensaje de la página anterior",
  );
  const cuerpos = [...segunda.messages, ...primera.messages].map((mensaje) => mensaje.body);
  assert.deepEqual(cuerpos, ["Mensaje 1", "Mensaje 2", "Mensaje 3", "Mensaje 4"]);
});

/* --------------------- cifrado obligatorio cuando toca ------------------ */

/** Par ECDH P-256 como el que genera el navegador. */
async function nuevoDispositivo() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { jwk, keyId: "" };
}

test("si alguien publicó su clave, el servidor rechaza el texto plano", async () => {
  const { request } = intercambioAceptado("usr_lucia", "usr_marcos");
  // Basta con que una de las dos partes tenga clave: si no, cualquiera podría
  // «degradar» la conversación enviando texto legible a la base de datos.
  const dispositivo = await nuevoDispositivo();
  repo.setPublicKey("usr_lucia", dispositivo.jwk);

  const error = errorDe(() => repo.addMessage(request.id, "usr_marcos", "Sin cifrar"));
  assert.equal(error.status, 409);
  assert.match(error.message, /debe enviarse cifrado/);
});

test("cifrar exige clave propia y sobre dirigido a la otra parte", async () => {
  const { request } = intercambioAceptado("usr_ana", "usr_diego");
  const dispositivo = await nuevoDispositivo();
  const clave = repo.setPublicKey("usr_ana", dispositivo.jwk);

  // La otra persona aún no ha publicado la suya: no hay a quién dirigir el sobre.
  const sinPar = errorDe(() =>
    repo.addEncryptedMessage(request.id, "usr_ana", {
      keyId: clave.keyId,
      envelopes: [],
    }),
  );
  assert.equal(sinPar.status, 409);
  assert.match(sinPar.message, /todavía no ha activado el cifrado/);

  const delOtro = await nuevoDispositivo();
  const claveOtro = repo.setPublicKey("usr_diego", delOtro.jwk);
  const mensaje = repo.addEncryptedMessage(request.id, "usr_ana", {
    keyId: clave.keyId,
    envelopes: [{ keyId: claveOtro.keyId, ciphertext: "sobre", iv: "iv" }],
  });
  assert.equal(mensaje.encrypted, true);
  assert.equal(mensaje.body, "", "el servidor no guarda texto legible");
  assert.deepEqual(
    repo.listMessages(request.id, "usr_diego").messages.at(-1)!.envelopes.map((sobre) => sobre.keyId),
    [claveOtro.keyId],
  );

  // Un sobre para una clave que no es de la otra persona se rechaza.
  const ajeno = await nuevoDispositivo();
  const error = errorDe(() =>
    repo.addEncryptedMessage(request.id, "usr_ana", {
      keyId: clave.keyId,
      envelopes: [{ keyId: "clave-que-no-es", ciphertext: "x", iv: "y" }],
    }),
  );
  assert.equal(error.status, 400);
  void ajeno;
});

/* ---------------------------- mensajería directa ------------------------ */

test("no se puede escribir por privado a quien no te sigue de vuelta", () => {
  const error = errorDe(() =>
    repo.sendDirectMessage("usr_marcos", "usr_ana", {
      keyId: "x",
      ciphertext: "y",
      iv: "z",
    }),
  );
  assert.equal(error.status, 403);
  assert.match(error.message, /también te sigue/);
});

test("el hilo directo exige seguimiento mutuo, claves y sobres bien dirigidos", async () => {
  // Ana y Clara se siguen de las dos partes en los datos de ejemplo.
  assert.ok(
    repo.directThread("usr_ana", "usr_clara").reason,
    "sin claves aún no se puede escribir, y el hilo dice por qué",
  );

  const deAna = await nuevoDispositivo();
  const deClara = await nuevoDispositivo();
  const claveAna = repo.setPublicKey("usr_ana", deAna.jwk);
  const claveClara = repo.setPublicKey("usr_clara", deClara.jwk);

  // Con clave propia pero una que ya no es la publicada.
  const caduca = errorDe(() =>
    repo.sendDirectMessage("usr_ana", "usr_clara", { keyId: "clave-vieja", envelopes: [] }),
  );
  assert.equal(caduca.status, 409);
  assert.match(caduca.message, /ha cambiado/);

  const enviado = repo.sendDirectMessage("usr_ana", "usr_clara", {
    keyId: claveAna.keyId,
    envelopes: [{ keyId: claveClara.keyId, ciphertext: "sobre", iv: "iv" }],
  });
  assert.equal(enviado.encrypted, true);

  // Dos sobres para la misma clave no son un mensaje: son una ambigüedad.
  const duplicado = errorDe(() =>
    repo.sendDirectMessage("usr_ana", "usr_clara", {
      keyId: claveAna.keyId,
      envelopes: [
        { keyId: claveClara.keyId, ciphertext: "a", iv: "1" },
        { keyId: claveClara.keyId, ciphertext: "b", iv: "2" },
      ],
    }),
  );
  assert.equal(duplicado.status, 400);
  assert.match(duplicado.message, /dos sobres/);

  const sinLeer = repo.countUnreadDirectMessages("usr_clara");
  assert.ok(sinLeer >= 1);
  repo.markDirectThreadRead("usr_clara", "usr_ana");
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 0);
});

test("los sobres de una conversación solo los ve quien participa", async () => {
  const { request } = intercambioAceptado("usr_ana", "usr_marcos");
  const deAna = await nuevoDispositivo();
  const deMarcos = await nuevoDispositivo();
  const claveAna = repo.setPublicKey("usr_ana", deAna.jwk);
  const claveMarcos = repo.setPublicKey("usr_marcos", deMarcos.jwk);
  repo.addEncryptedMessage(request.id, "usr_ana", {
    keyId: claveAna.keyId,
    envelopes: [{ keyId: claveMarcos.keyId, ciphertext: "sobre", iv: "iv" }],
  });

  const claves = repo.conversationKeys(request.id, "usr_marcos");
  assert.deepEqual(
    claves.me.keys.map((clave) => clave.keyId).sort(),
    [claveMarcos.keyId].sort(),
    "lo mío son mis claves",
  );
  assert.deepEqual(
    claves.peer.keys.map((clave) => clave.keyId).sort(),
    [claveAna.keyId].sort(),
    "lo suyo, las de la otra parte",
  );
  // Son claves públicas: sirven para cifrar, no para leer el historial ajeno.
  assert.equal("d" in (claves.peer.keys[0]!.publicJwk as Record<string, unknown>), false);
  assert.equal(errorDe(() => repo.conversationKeys(request.id, "usr_clara")).status, 404);
});

test("dos sobres para la misma clave en un intercambio se rechazan", async () => {
  const { request } = intercambioAceptado("usr_diego", "usr_lucia");
  const propio = await nuevoDispositivo();
  const ajeno = await nuevoDispositivo();
  const clavePropia = repo.setPublicKey("usr_lucia", propio.jwk);
  const claveAjena = repo.setPublicKey("usr_diego", ajeno.jwk);

  const error = errorDe(() =>
    repo.addEncryptedMessage(request.id, "usr_lucia", {
      keyId: clavePropia.keyId,
      envelopes: [
        { keyId: claveAjena.keyId, ciphertext: "a", iv: "1" },
        { keyId: claveAjena.keyId, ciphertext: "b", iv: "2" },
      ],
    }),
  );
  assert.equal(error.status, 400);
  assert.match(error.message, /dos sobres/);
});

/** Cuenta recién creada: no tiene claves publicadas todavía. */
function sinClaves(nombre: string) {
  counter += 1;
  return repo.createUser({
    name: `${nombre} ${counter}`,
    email: `sinclaves${counter}@example.org`,
    passwordHash: "hash",
    city: "Bremen",
  });
}

test("sin clave propia no se puede mandar un mensaje cifrado", async () => {
  const nueva = sinClaves("Sin Clave");
  const listado = nuevoEjemplar(nueva.id);
  const peticion = repo.createRequest("usr_diego", listado.id, "¿Sigue libre?");
  repo.updateRequestStatus(peticion.id, nueva.id, "accepted");

  const error = errorDe(() =>
    repo.addEncryptedMessage(peticion.id, nueva.id, { keyId: "cualquiera", envelopes: [] }),
  );
  assert.equal(error.status, 409);
  assert.match(error.message, /Publica tu clave de cifrado/);
});

test("no se puede abrir un hilo contigo mismo ni escribir sin claves", async () => {
  const mismo = errorDe(() => repo.directThread("usr_ana", "usr_ana"));
  assert.equal(mismo.status, 409);
  assert.match(mismo.message, /ti mismo/);

  const nueva = sinClaves("Recién Llegada");
  repo.setFollow(nueva.id, "usr_ana", true);
  repo.setFollow("usr_ana", nueva.id, true);

  // Seguimiento mutuo sí, claves no: el envío se explica, no se rompe.
  const sinClave = errorDe(() =>
    repo.sendDirectMessage(nueva.id, "usr_ana", { keyId: "x", envelopes: [] }),
  );
  assert.equal(sinClave.status, 409);
  assert.match(sinClave.message, /Publica tu clave/);

  // Y al revés: la otra persona aún no ha activado el cifrado.
  const claveAna = repo.setPublicKey("usr_ana", (await nuevoDispositivo()).jwk);
  const sinDestino = errorDe(() =>
    repo.sendDirectMessage("usr_ana", nueva.id, { keyId: claveAna.keyId, envelopes: [] }),
  );
  assert.equal(sinDestino.status, 409);
  assert.match(sinDestino.message, /todavía no ha activado el cifrado/);

  // Con las dos claves publicadas, un sobre dirigido a una clave ajena se rechaza:
  // si no, el mensaje viajaría cifrado para quien no debe poder leerlo.
  repo.setPublicKey(nueva.id, (await nuevoDispositivo()).jwk);
  const sobreAjeno = errorDe(() =>
    repo.sendDirectMessage("usr_ana", nueva.id, {
      keyId: claveAna.keyId,
      ciphertext: "x",
      iv: "y",
      envelopes: [{ keyId: "clave_de_otra_persona", ciphertext: "z", iv: "w" }],
    }),
  );
  assert.equal(sobreAjeno.status, 400);
  assert.match(sobreAjeno.message, /no es de la otra persona/);

  // Marcar como leído un hilo que no existe no es un error: es un no-op.
  assert.doesNotThrow(() => repo.markDirectThreadRead("usr_marcos", "usr_lucia"));
  assert.equal(repo.countUnreadDirectMessages("usr_marcos"), 0);
});

/* ----------------------- baja de cuenta y bloqueos ---------------------- */

test("cancelar las conversaciones de una cuenta libera sus ejemplares reservados", () => {
  const listing = nuevoEjemplar("usr_lucia");
  const request = repo.createRequest("usr_marcos", listing.id);
  repo.updateRequestStatus(request.id, "usr_lucia", "accepted");
  assert.equal(estadoDelEjemplar(listing.id, "usr_lucia"), "reserved");

  const canceladas = repo.cancelExchangesForAccount("usr_lucia");
  assert.ok(canceladas >= 1);
  assert.equal(estado(request.id, "usr_marcos"), "cancelled");
  assert.equal(estadoDelEjemplar(listing.id, "usr_lucia"), "available");
});

test("bloquear a la otra parte corta la conversación sin cerrar el intercambio", () => {
  const { request } = intercambioAceptado("usr_clara", "usr_diego");
  repo.blockUser("usr_diego", "usr_clara");

  const error = errorDe(() => repo.addMessage(request.id, "usr_diego", "Hola"));
  assert.equal(error.status, 409);
  assert.match(error.message, /No puedes enviar mensajes/);
  // El intercambio sigue en pie: el bloqueo impide hablar, no deshace el trato.
  assert.equal(estado(request.id, "usr_diego"), "accepted");
  repo.unblockUser("usr_diego", "usr_clara");
});
