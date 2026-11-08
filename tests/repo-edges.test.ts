/**
 * Ramas de la capa de datos que ninguna prueba tocaba.
 *
 * No es cobertura por rellenar: cada caso de aquí es una decisión que alguien
 * puede romper sin que se note en la interfaz.
 *
 * - Los filtros de comunidad ofrecen ciudades: si incluyen la de una cuenta
 *   suspendida, la moderación se queda a medias.
 * - Quitar un favorito y quitar una portada son acciones distintas de ponerlas.
 * - Los contadores del panel de administración paginan listas: si cuentan otra
 *   cosa que la lista, la última página queda vacía o se pierde una denuncia.
 * - El sello de mensajes es lo que hace sonar el aviso de «mensaje nuevo»: si
 *   cualquiera puede consultarlo, se puede espiar una conversación ajena.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");
type SharedModule = typeof import("../src/lib/repo/shared.ts");

let dbModule: DbModule;
let repo: RepoModule;
let shared: SharedModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
  shared = await import("../src/lib/repo/shared.ts");
});

/** Sobre de mentira: el servidor no descifra nada. */
function sobre(keyId: string) {
  return { ciphertext: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4", iv: "MTIzNDU2Nzg5MDEy", keyId };
}

test("un error de restricción se distingue de cualquier otro fallo", () => {
  const restriccion = Object.assign(new Error("UNIQUE constraint failed"), {
    code: "SQLITE_CONSTRAINT_UNIQUE",
  });
  assert.equal(shared.isConstraintError(restriccion), true);

  assert.equal(shared.isConstraintError(new Error("otra cosa")), false, "sin código no es de restricción");
  assert.equal(shared.isConstraintError({ code: "SQLITE_CONSTRAINT" }), false, "no es un Error");
  assert.equal(shared.isConstraintError("SQLITE_CONSTRAINT"), false);
  assert.equal(shared.isConstraintError(null), false);
  assert.equal(
    shared.isConstraintError(Object.assign(new Error("disco"), { code: "SQLITE_FULL" })),
    false,
    "un disco lleno no se debe tragar como una carrera",
  );
});

test("las ciudades de la comunidad salen de los datos y dejan fuera a quien está suspendido", () => {
  const lectores = shared.citiesInUse("readers");
  assert.ok(lectores.length > 0, "la muestra tiene lectores");
  assert.deepEqual(lectores, [...lectores].sort(), "vienen ordenadas");
  assert.equal(new Set(lectores).size, lectores.length, "sin repetir ciudad");

  const suspendida = "Ciudad Suspendida";
  const db = dbModule.getDb();
  db.prepare(
    `INSERT INTO users (id, name, email, city, password_hash, is_suspended, created_at)
     VALUES ('usr_suspendida', 'Suspendida', 'suspendida@example.test', ?, 'scrypt$00$00', 1, '2026-01-01T00:00:00.000Z')`,
  ).run(suspendida);
  assert.equal(
    shared.citiesInUse("readers").includes(suspendida),
    false,
    "la ciudad de una cuenta suspendida no se ofrece",
  );

  // Y la lista de clubes usa su propia tabla.
  const clubes = shared.citiesInUse("clubs");
  assert.ok(Array.isArray(clubes));

  // El tope se respeta.
  assert.ok(shared.citiesInUse("readers", 1).length <= 1);
});

test("un favorito se pone y se quita, y el listado lo refleja", () => {
  const vista = repo.catalogPage(null, {
    view: "discover",
    q: "",
    category: "Todos",
    language: "Todos",
    sort: "recent",
    radius: 0,
    shelf: "all",
    feed: "all",
    tag: "",
    tab: "conversations",
    scope: "region",
    page: 1,
  });
  const ejemplar = vista.items[0];
  assert.ok(ejemplar, "hay ejemplares en el catálogo");

  repo.setFavorite("usr_ana", ejemplar.id, true);
  const conFavorito = repo
    .catalogPage(null, {
      view: "discover",
      q: "",
      category: "Todos",
      language: "Todos",
      sort: "recent",
      radius: 0,
      shelf: "all",
      feed: "all",
      tag: "",
      tab: "conversations",
      scope: "region",
      page: 1,
    })
    .items.find((item) => item.id === ejemplar.id);
  assert.equal(conFavorito?.isFavorite, false, "sin sesión no se pinta como favorito");

  const enEstanteria = repo.shelfListings("usr_ana", "saved");
  assert.ok(
    enEstanteria.items.some((item) => item.id === ejemplar.id),
    "el ejemplar aparece en los guardados",
  );

  // Y se puede quitar (la interfaz lo llama al volver a pulsar el corazón).
  repo.setFavorite("usr_ana", ejemplar.id, false);
  const despues = repo.shelfListings("usr_ana", "saved");
  assert.equal(despues.items.some((item) => item.id === ejemplar.id), false);
});

test("las obras de una clave agrupan ediciones y no repiten claves", () => {
  assert.deepEqual(repo.booksForWorkKeys([]), [], "sin claves no se consulta nada");
  assert.deepEqual(repo.booksForWorkKeys([""]), [], "una clave vacía tampoco");

  const libro = repo.createListing("usr_marcos", {
    title: "La obra de prueba",
    author: "Autora",
    category: "Ficción",
    condition: "Buen estado",
    isbn: "9780306406157",
    city: "Leipzig",
    tags: [],
  });
  const obra = dbModule
    .getDb()
    .prepare("SELECT work_key FROM books WHERE id = ?")
    .get(libro.bookId) as { work_key: string | null };
  assert.ok(obra.work_key, "al publicar con ISBN se deriva la clave de la obra");

  const porClave = repo.booksForWorkKeys([obra.work_key]);
  assert.ok(porClave.some((ficha) => ficha.id === libro.bookId));
  // Repetir la misma clave no multiplica resultados.
  assert.deepEqual(
    repo.booksForWorkKeys([obra.work_key, obra.work_key]).map((ficha) => ficha.id),
    porClave.map((ficha) => ficha.id),
  );

  assert.equal(repo.bookExists(libro.bookId), true);
  assert.equal(repo.bookExists("bok_que_no_existe"), false);
});

test("el sello de mensajes solo lo puede pedir quien participa en el intercambio", () => {
  const db = dbModule.getDb();
  const ejemplar = db
    .prepare("SELECT id, owner_id FROM listings WHERE status = 'available' LIMIT 1")
    .get() as { id: string; owner_id: string };
  const otro = ejemplar.owner_id === "usr_ana" ? "usr_diego" : "usr_ana";

  const solicitud = repo.createRequest(otro, ejemplar.id);
  const sello = repo.requestMessageStamp(solicitud.id, otro);
  assert.equal(sello.count, 0);
  assert.equal(sello.lastId, null);

  assert.throws(() => repo.requestMessageStamp(solicitud.id, "usr_clara"), {
    name: "ApiError",
  });
});

test("los contadores del panel cuentan lo mismo que sus listas", () => {
  const antes = repo.countSuspendedUsers();
  const suspendida = "usr_diego";
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: suspendida,
  });
  assert.equal(repo.countSuspendedUsers(), antes + 1);
  assert.equal(repo.listSuspendedUsers().some((user) => user.id === suspendida), true);

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: suspendida,
  });
  assert.equal(repo.countSuspendedUsers(), antes);
  assert.equal(repo.listSuspendedUsers().some((user) => user.id === suspendida), false);

  // La auditoría crece con cada acción de moderación.
  const auditoria = repo.countAudit();
  assert.ok(auditoria >= 2, "quedan registradas las dos acciones");
  assert.equal(repo.listAudit().length, Math.min(auditoria, 20));
});

test("el contador de no leídos de la mensajería directa cuenta lo que la lista marca", () => {
  // Ana y Clara se siguen en la muestra: con la clave publicada se abre el hilo.
  const claveAna = repo.setPublicKey("usr_ana", {
    kty: "EC",
    crv: "P-256",
    x: "ana-publica-x",
    y: "ana-publica-y",
  }).keyId;
  repo.setPublicKey("usr_clara", {
    kty: "EC",
    crv: "P-256",
    x: "clara-publica-x",
    y: "clara-publica-y",
  });

  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 0, "sin mensajes no hay nada pendiente");

  repo.sendDirectMessage("usr_ana", "usr_clara", sobre(claveAna));
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 1);
  assert.equal(
    repo.countUnreadDirectMessages("usr_ana"),
    0,
    "lo que uno escribe no cuenta como no leído para sí mismo",
  );

  repo.markDirectThreadRead("usr_clara", "usr_ana");
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 0);

  // Marcar como leído un hilo que no existe no es un error: solo no hace nada.
  repo.markDirectThreadRead("usr_clara", "usr_diego");
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 0);
});
