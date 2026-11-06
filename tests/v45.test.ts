/**
 * Idioma de los correos de cuenta.
 *
 * El sitio tiene el alemán por defecto, así que un correo en castellano fijo
 * llegaba mal a la mayoría de las personas. Manda el idioma de la **cuenta**
 * (`users.locale`), que se guarda al registrarse.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type TokensModule = typeof import("../src/lib/account-tokens.ts");
type TemplatesModule = typeof import("../src/lib/mail-templates.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let dbModule: DbModule;
let tokens: TokensModule;
let templates: TemplatesModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  templates = await import("../src/lib/mail-templates.ts");
  tokens = await import("../src/lib/account-tokens.ts");
});

const ENLACE = "https://wanderbibliothek.org";
const enlaceVerificar = `${ENLACE}/verificar#token=${"a".repeat(64)}`;

test("las dos plantillas existen en los dos idiomas y llevan el enlace y el aviso de spam", () => {
  const confirmarDe = templates.verificationMail("de", enlaceVerificar);
  const confirmarEs = templates.verificationMail("es", enlaceVerificar);

  for (const mail of [confirmarDe, confirmarEs]) {
    assert.ok(mail.subject.length > 0);
    assert.ok(mail.text.includes(enlaceVerificar), "el enlace va tal cual, con el token en el fragmento");
    assert.match(mail.text, /[Ss]pam/, "sin el aviso, un correo en spam parece un fallo de la web");
  }
  assert.match(confirmarDe.subject, /Bestätige/);
  assert.match(confirmarEs.subject, /Confirma/);
  assert.notEqual(confirmarDe.subject, confirmarEs.subject);

  const resetDe = templates.passwordResetMail("de", `${ENLACE}/restablecer#token=x`);
  assert.match(resetDe.subject, /Passwort/);
  assert.ok(resetDe.text.includes(`${ENLACE}/restablecer#token=x`));
});

test("una cuenta en alemán recibe la confirmación en alemán", async () => {
  const db = dbModule.getDb();
  const { email } = db.prepare("SELECT email FROM users WHERE id = 'usr_ana'").get() as {
    email: string;
  };
  db.prepare("UPDATE users SET locale = 'de' WHERE id = 'usr_ana'").run();

  await tokens.sendVerificationEmail("usr_ana", email);

  const row = db
    .prepare("SELECT subject, body FROM mail_outbox WHERE to_email = ? ORDER BY rowid DESC LIMIT 1")
    .get(email) as { subject: string; body: string };
  assert.match(row.subject, /Bestätige deine E-Mail/);
  assert.match(row.body, /Posteingang/);
  assert.doesNotMatch(row.body, /bandeja de entrada/);
});

test("una cuenta en castellano recibe el restablecimiento en castellano", async () => {
  const db = dbModule.getDb();
  const { email } = db.prepare("SELECT email FROM users WHERE id = 'usr_diego'").get() as {
    email: string;
  };
  db.prepare("UPDATE users SET locale = 'es' WHERE id = 'usr_diego'").run();

  await tokens.sendPasswordResetEmail("usr_diego", email);

  const row = db
    .prepare("SELECT subject, body FROM mail_outbox WHERE to_email = ? ORDER BY rowid DESC LIMIT 1")
    .get(email) as { subject: string; body: string };
  assert.match(row.subject, /Restablece tu contraseña/);
  assert.match(row.body, /bandeja de entrada/);
});

test("un idioma desconocido en la fila cae al alemán, nunca a una clave técnica", async () => {
  const db = dbModule.getDb();
  const { email } = db.prepare("SELECT email FROM users WHERE id = 'usr_clara'").get() as {
    email: string;
  };
  // Una fila tocada a mano (o migrada desde otro sitio) no debe producir un
  // correo vacío ni en un idioma que no existe.
  db.prepare("UPDATE users SET locale = 'fr' WHERE id = 'usr_clara'").run();

  await tokens.sendVerificationEmail("usr_clara", email);

  const row = db
    .prepare("SELECT subject FROM mail_outbox WHERE to_email = ? ORDER BY rowid DESC LIMIT 1")
    .get(email) as { subject: string };
  assert.match(row.subject, /Bestätige deine E-Mail/);
});
