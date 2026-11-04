import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { ApiError } from "./errors";
import { siteUrl } from "./site";
import { enqueueMail } from "./outbox";

export type TokenPurpose = "verify_email" | "reset_password";

const TTL_MINUTES: Record<TokenPurpose, number> = {
  verify_email: 60 * 24,
  reset_password: 60,
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Emite un token de un solo uso y devuelve el valor en claro (solo una vez). */
export function issueAccountToken(userId: string, purpose: TokenPurpose): string {
  const db = getDb();
  const raw = randomBytes(32).toString("hex");
  const now = (db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS ts").get() as { ts: string })
    .ts;
  const expires = (
    db
      .prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) AS ts")
      .get(`+${TTL_MINUTES[purpose]} minutes`) as { ts: string }
  ).ts;

  db.transaction(() => {
    // Un token vigente por persona y propósito.
    db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL").run(
      userId,
      purpose,
    );
    db.prepare(
      "INSERT INTO account_tokens (id, user_id, purpose, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
    ).run(`tok_${randomBytes(12).toString("hex")}`, userId, purpose, hashToken(raw), expires, now);
    db.prepare("DELETE FROM account_tokens WHERE expires_at <= ?").run(now);
  })();

  return raw;
}

/** Consume el token (una sola vez) y devuelve el usuario o null. */
export function consumeAccountToken(raw: string, purpose: TokenPurpose): string | null {
  const db = getDb();
  const tokenHash = hashToken(raw);

  // El UPDATE condicional es la parte atómica: si dos peticiones llegan a la
  // vez, solo una cambia `used_at` y la otra se queda sin token.
  return db.transaction(() => {
    const { changes } = db
      .prepare(
        `UPDATE account_tokens
            SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE token_hash = ? AND purpose = ? AND used_at IS NULL
            AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(tokenHash, purpose);
    if (changes !== 1) return null;

    const row = db
      .prepare("SELECT user_id FROM account_tokens WHERE token_hash = ? AND purpose = ?")
      .get(tokenHash, purpose) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  })();
}

/** Encola el enlace de verificación; el outbox lo entrega con reintentos. */
export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = issueAccountToken(userId, "verify_email");
  const link = `${siteUrl()}/verificar?token=${token}`;
  enqueueMail({
    to: email,
    subject: "Confirma tu correo en Wanderbibliothek",
    text: `Abre este enlace para confirmar tu correo (caduca en 24 horas):\n${link}`,
  });
}

/** Encola el enlace de recuperación. No revela si el correo existe. */
export async function sendPasswordResetEmail(userId: string, email: string): Promise<void> {
  const token = issueAccountToken(userId, "reset_password");
  const link = `${siteUrl()}/restablecer?token=${token}`;
  enqueueMail({
    to: email,
    subject: "Restablece tu contraseña de Wanderbibliothek",
    text: `Abre este enlace para elegir una contraseña nueva (caduca en 1 hora):\n${link}`,
  });
}

export function assertTokenShape(token: string): void {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, "El enlace no es válido.");
}
