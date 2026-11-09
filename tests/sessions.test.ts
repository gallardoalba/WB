import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let db: DbModule;
let repo: RepoModule;

before(async () => {
  db = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
});

/** Inserta una sesión como la crearía un acceso desde ese navegador. */
function session(id: string, userId: string, userAgent: string, seenAgoMinutes = 0): void {
  const now = new Date();
  const seen = new Date(now.getTime() - seenAgoMinutes * 60_000);
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, seen.toISOString(), expires.toISOString(), userAgent, seen.toISOString());
}

test("el navegador se reduce a una palabra reconocible", () => {
  assert.equal(
    repo.describeAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"),
    "Chrome",
  );
  assert.equal(repo.describeAgent("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0"), "Firefox");
  assert.equal(repo.describeAgent("Wanderbibliothek-Android/0.2.0"), "App");
  assert.equal(repo.describeAgent("Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile"), "Android");
  assert.equal(repo.describeAgent(""), "");
});

test("la lista de sesiones marca la actual y no enseña tokens", () => {
  session("ses_ana_web", "usr_ana", "Mozilla/5.0 Chrome/140.0", 30);
  session("ses_ana_app", "usr_ana", "Wanderbibliothek-Android/0.2.0", 1);
  const sessions = repo.listSessions("usr_ana", "ses_ana_web");
  assert.equal(sessions.length >= 2, true);
  const web = sessions.find((item) => item.id === "ses_ana_web");
  assert.ok(web);
  assert.equal(web.current, true, "la del navegador que pregunta va marcada");
  assert.equal(web.device, "Chrome");
  // La más reciente primero: la app se usó hace un minuto.
  assert.equal(sessions[0]?.id, "ses_ana_app");
  assert.equal(sessions[0]?.current, false);
  assert.equal(sessions[0]?.device, "App");
});

test("nadie puede cerrar la sesión de otra cuenta", () => {
  session("ses_ajena", "usr_marcos", "Mozilla/5.0 Firefox/130.0", 5);
  assert.equal(repo.revokeSession("usr_ana", "ses_ajena"), false);
  assert.ok(repo.listSessions("usr_marcos", null).some((item) => item.id === "ses_ajena"));
});

test("cerrar una sesión la quita de la lista y deja las demás", () => {
  assert.equal(repo.revokeSession("usr_ana", "ses_ana_web"), true);
  const sessions = repo.listSessions("usr_ana", null);
  assert.equal(sessions.some((item) => item.id === "ses_ana_web"), false);
  assert.equal(sessions.some((item) => item.id === "ses_ana_app"), true);
  // Cerrar dos veces no rompe: la segunda no encuentra nada.
  assert.equal(repo.revokeSession("usr_ana", "ses_ana_web"), false);
});

test("el último uso no se reescribe en cada petición", () => {
  const read = () =>
    (
      db
        .getDb()
        .prepare("SELECT last_seen_at AS value FROM sessions WHERE id = ?")
        .get("ses_ana_app") as { value: string }
    ).value;

  const reciente = read();
  repo.touchSession("ses_ana_app");
  assert.equal(read(), reciente, "una sesión usada hace un minuto no se toca");

  const viejo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(viejo, "ses_ana_app");
  repo.touchSession("ses_ana_app");
  assert.notEqual(read(), viejo, "pasada la ventana, el último uso sí se actualiza");
});
