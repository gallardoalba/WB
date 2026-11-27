import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD_HASH } from "../src/lib/db/schema";
import { totpCode, totpStep } from "../src/lib/totp";
import { localDatabase } from "./db";

/**
 * Flujos de cuenta que tocan la base por dentro: el cambio de correo confirmado
 * desde el buzón y la entrada con un código de recuperación del segundo factor.
 *
 * Las dos pruebas crean su propia cuenta y la borran al terminar. Cambiar el
 * correo de una cuenta demo dejaría al resto de la suite sin poder entrar.
 */

let counter = 0;

/** Cuenta desechable con la contraseña de demostración. */
function createAccount(): { id: string; email: string } {
  const db = localDatabase();
  if (!db) throw new Error("estas pruebas necesitan la base local del servidor");
  counter += 1;
  const id = `usr_e2e_${Date.now()}_${counter}`;
  const email = `cuenta-e2e-${Date.now()}-${counter}@wanderbibliothek.test`;
  try {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, city, bio, created_at)
       VALUES (?, ?, ?, ?, 'Stuttgart', '', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ).run(id, "Cuenta de prueba", email, DEMO_PASSWORD_HASH);
  } finally {
    db.close();
  }
  return { id, email };
}

/**
 * Borra la cuenta y lo que cuelga de ella. La conexión del test no activa
 * `foreign_keys`, así que las cascadas no se aplican aquí.
 */
function deleteAccount(id: string, emails: string[]): void {
  const db = localDatabase();
  if (!db) return;
  try {
    for (const sql of [
      "DELETE FROM sessions WHERE user_id = ?",
      "DELETE FROM account_tokens WHERE user_id = ?",
      "DELETE FROM totp_recovery_codes WHERE user_id = ?",
      "DELETE FROM users WHERE id = ?",
    ]) {
      db.prepare(sql).run(id);
    }
    // La cola de correo guarda el destino, no la cuenta: se limpia por las dos
    // direcciones que ha usado la prueba.
    for (const email of emails) db.prepare("DELETE FROM jobs WHERE target = ?").run(email);
  } catch {
    // Si la prueba falló antes de crear la cuenta, no hay nada que limpiar.
  } finally {
    db.close();
  }
}

/** Enlace del último correo encolado a esa dirección (el outbox guarda el texto). */
function lastMailLink(email: string): string | null {
  const db = localDatabase();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT payload FROM jobs WHERE target = ? ORDER BY created_at DESC LIMIT 1")
      .get(email) as { payload: string } | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.payload) as { text?: string };
    return /https?:\/\/\S+/.exec(payload.text ?? "")?.[0] ?? null;
  } finally {
    db.close();
  }
}

test("el correo no cambia hasta abrir el enlace que va a la dirección nueva", async ({ request }) => {
  const account = createAccount();
  const nuevo = `nuevo-${Date.now()}@wanderbibliothek.test`;
  try {
    expect(
      (await request.post("/api/auth/login", {
        data: { email: account.email, password: "demo1234" },
      })).status(),
    ).toBe(200);

    // Sin la contraseña no hay cambio, ni siquiera con sesión iniciada.
    const sinClave = await request.patch("/api/account/email", {
      data: { password: "no-es-esta", email: nuevo },
    });
    expect(sinClave.status()).toBe(401);

    const pedido = await request.patch("/api/account/email", {
      data: { password: "demo1234", email: nuevo },
    });
    expect(pedido.status()).toBe(200);

    const estado = await (await request.get("/api/account/email")).json();
    expect(estado).toEqual({ email: account.email, pendingEmail: nuevo, pendingExpired: false });

    // El enlace se manda a la dirección **nueva**, que es la prueba de que el
    // buzón es de quien pide el cambio.
    const link = lastMailLink(nuevo);
    expect(link).toBeTruthy();
    const token = /token=([a-f0-9]{64})/.exec(link ?? "")?.[1];
    expect(token).toBeTruthy();

    const confirmado = await request.post("/api/auth/verify", { data: { token } });
    expect(confirmado.status()).toBe(200);
    expect(await confirmado.json()).toMatchObject({ emailChanged: true, email: nuevo });

    const despues = await (await request.get("/api/account/email")).json();
    expect(despues).toEqual({ email: nuevo, pendingEmail: null, pendingExpired: false });
  } finally {
    deleteAccount(account.id, [account.email, nuevo]);
  }
});

test("un código de recuperación entra sin la aplicación de autenticación", async ({ request }) => {
  const account = createAccount();
  try {
    expect(
      (await request.post("/api/auth/login", {
        data: { email: account.email, password: "demo1234" },
      })).status(),
    ).toBe(200);

    const setup = await request.post("/api/account/totp/setup", {
      data: { password: "demo1234" },
    });
    expect(setup.status()).toBe(200);
    const { secret } = (await setup.json()) as { secret: string };

    const enable = await request.post("/api/account/totp/enable", {
      data: { code: totpCode(secret, totpStep()) },
    });
    expect(enable.status()).toBe(200);
    const { recoveryCodes } = (await enable.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);

    // A partir de aquí la cuenta pide segundo factor.
    const sinCodigo = await request.post("/api/auth/login", {
      data: { email: account.email, password: "demo1234" },
    });
    expect(sinCodigo.status()).toBe(401);
    expect(await sinCodigo.json()).toMatchObject({ twoFactorRequired: true });

    const conRecuperacion = await request.post("/api/auth/login", {
      data: { email: account.email, password: "demo1234", code: recoveryCodes[0] },
    });
    expect(conRecuperacion.status()).toBe(200);

    // El mismo código no sirve dos veces.
    await request.post("/api/auth/logout");
    const repetido = await request.post("/api/auth/login", {
      data: { email: account.email, password: "demo1234", code: recoveryCodes[0] },
    });
    expect(repetido.status()).toBe(401);
  } finally {
    deleteAccount(account.id, [account.email]);
  }
});
