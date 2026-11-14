import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type SessionStore = typeof import("../src/lib/session-store.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let sesiones: SessionStore;
let db: DbModule;

before(async () => {
  db = await import("../src/lib/db/index.ts");
  sesiones = await import("../src/lib/session-store.ts");

  const connection = db.getDb();
  for (const id of ["usr_sesion", "usr_otra"]) {
    connection
      .prepare(
        `INSERT INTO users (id, name, email, city, password_hash, created_at)
         VALUES (?, ?, ?, 'Leipzig', 'scrypt$00$00', '2026-01-01T00:00:00.000Z')`,
      )
      .run(id, id, `${id}@example.test`);
  }
});

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Crea una sesión real y mueve su reloj: el alta y la caducidad son lo único
 * que no se puede esperar en una prueba (30 días). La renovación, el tope
 * absoluto y la purga los ejecuta el código de verdad.
 */
function agedSession(userId: string, createdOffsetMs: number, expiresOffsetMs: number): string {
  const token = sesiones.createSession(userId, "Mozilla/5.0 Chrome/140.0");
  db.getDb()
    .prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?")
    .run(iso(createdOffsetMs), iso(expiresOffsetMs), hash(token));
  return token;
}

const expiresIn = (token: string) =>
  new Date(
    (
      db
        .getDb()
        .prepare("SELECT expires_at AS value FROM sessions WHERE id = ?")
        .get(hash(token)) as { value: string }
    ).value,
  ).getTime() - Date.now();

const sessionCount = (userId: string) =>
  (
    db
      .getDb()
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .get(userId) as { n: number }
  ).n;

test("el token de la sesión solo se guarda como hash", () => {
  const token = sesiones.createSession("usr_sesion", "Mozilla/5.0 Chrome/140.0");
  assert.match(token, /^[0-9a-f]{64}$/, "el token que va al navegador son 32 bytes aleatorios");

  const ids = db
    .getDb()
    .prepare("SELECT id FROM sessions WHERE user_id = 'usr_sesion'")
    .all()
    .map((row) => (row as { id: string }).id);
  // Lo que queda en la base es el SHA-256: una copia de la tabla no sirve para
  // suplantar a nadie.
  assert.ok(ids.includes(hash(token)));
  assert.equal(ids.includes(token), false, "el token en claro no está en la tabla");
});

test("la cookie de sesión no la puede leer la página", () => {
  const options = sesiones.sessionCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, 14 * 24 * 60 * 60, "14 días, renovables mientras se use");
  // En producción `SESSION_COOKIE` es `__Host-`, que el navegador solo acepta
  // con Secure; en las pruebas (http) no lo exige.
  assert.equal(typeof options.secure, "boolean");
});

test("un token inventado no abre ninguna sesión", () => {
  assert.equal(sesiones.userForToken("0".repeat(64)), null);
  assert.equal(sesiones.userForToken(undefined), null);
});

test("una sesión que se usa se alarga hasta 14 días", () => {
  const token = agedSession("usr_otra", -1 * DAY, 3 * 60 * 60 * 1000);
  assert.ok(sesiones.userForToken(token), "le quedaban horas y sigue valiendo");

  const left = expiresIn(token);
  assert.ok(
    left > 13.9 * DAY && left <= 14 * DAY,
    `debería quedar cerca de 14 días y quedan ${Math.round(left / 3600000)} h`,
  );
});

test("la renovación nunca pasa del tope absoluto de 30 días", () => {
  // Alta hace 20 días: 14 más serían 34, así que corta en 30.
  const token = agedSession("usr_otra", -20 * DAY, 2 * DAY);
  assert.ok(sesiones.userForToken(token));

  const left = expiresIn(token);
  assert.ok(
    left > 9.9 * DAY && left <= 10 * DAY,
    `el tope son 30 días desde el alta (quedan ${Math.round(left / 3600000)} h)`,
  );
});

test("una sesión de más de 30 días deja de valer y se borra", () => {
  // Aún no ha caducado (le quedan 5 días), pero el tope absoluto la anula: no
  // se renueva, se elimina. Es lo que corta una sesión robada que se mantiene
  // viva usándola.
  const token = agedSession("usr_sesion", -31 * DAY, 5 * DAY);
  assert.equal(sesiones.userForToken(token), null);

  const row = db.getDb().prepare("SELECT id FROM sessions WHERE id = ?").get(hash(token));
  assert.equal(row, undefined, "la sesión caducada por antigüedad se elimina al consultarla");
});

test("una sesión caducada no abre nada", () => {
  const token = agedSession("usr_sesion", -2 * DAY, -60_000);
  assert.equal(sesiones.userForToken(token), null);
});

test("cada cuenta conserva como mucho diez sesiones", () => {
  const create = db.getDb().prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, last_seen_at)
     VALUES (?, 'usr_otra', ?, ?, 'Mozilla/5.0 Chrome/140.0', ?)`,
  );
  // Once antiguas: al entrar de nuevo, las dos más viejas caen.
  for (let index = 0; index < 11; index += 1) {
    create.run(`ses_antigua_${index}`, iso(-(index + 1) * DAY), iso(14 * DAY), iso(-(index + 1) * DAY));
  }
  const token = sesiones.createSession("usr_otra", "Mozilla/5.0 Chrome/140.0");

  assert.equal(sessionCount("usr_otra"), 10, "un cliente que entra en bucle no llena la tabla");
  assert.equal(
    db.getDb().prepare("SELECT id FROM sessions WHERE id = 'ses_antigua_10'").get(),
    undefined,
    "la más antigua se descarta",
  );
  assert.ok(sesiones.userForToken(token), "la sesión recién creada sigue valiendo");
});

test("cerrar sesión invalida solo ese dispositivo", () => {
  const movil = sesiones.createSession("usr_sesion", "Wanderbibliothek-Android/0.2.0");
  const portatil = sesiones.createSession("usr_sesion", "Mozilla/5.0 Firefox/130.0");
  sesiones.destroySession(movil);
  assert.equal(sesiones.userForToken(movil), null);
  assert.ok(sesiones.userForToken(portatil), "cerrar en el móvil no echa al portátil");
});

test("tras cambiar la contraseña, los tokens anteriores dejan de valer", () => {
  const robada = sesiones.createSession("usr_sesion", "Mozilla/5.0 Chrome/140.0");
  // Lo que hace `POST /api/account/password`: tira todas las sesiones y abre
  // una nueva para el navegador que acaba de cambiar la contraseña.
  sesiones.destroyUserSessions("usr_sesion");
  const nueva = sesiones.createSession("usr_sesion", "Mozilla/5.0 Chrome/140.0");

  assert.equal(sesiones.userForToken(robada), null, "la sesión robada deja de servir");
  assert.ok(sesiones.userForToken(nueva));
  assert.equal(sessionCount("usr_sesion"), 1, "y no queda ninguna otra abierta");
});
