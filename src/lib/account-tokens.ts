import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { ApiError } from "./errors";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./locale";
import { passwordResetMail, suspensionMail, appealResolvedMail, verificationMail } from "./mail-templates";
import { siteUrl } from "./site";
import { enqueueMail } from "./outbox";

export type TokenPurpose = "verify_email" | "reset_password" | "appeal";

const TTL_MINUTES: Record<TokenPurpose, number> = {
  verify_email: 60 * 24,
  reset_password: 60,
  // Una persona suspendida puede necesitar días para decidir apelar; el enlace
  // caduca con el tiempo suficiente para hacerlo sin dejarlo abierto siempre.
  appeal: 60 * 24 * 30,
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
  // El token va en la **query**, no en el fragmento: Brevo construye el enlace
  // del correo sin el `#…` y el clic llegaba a `/verificar` sin token. Sigue sin
  // acabar en el registro de accesos porque nginx anota `$uri` (sin query) y
  // estas dos páginas se sirven con `Referrer-Policy: no-referrer`; la propia
  // página lo borra de la barra en cuanto lo lee.
  const link = `${siteUrl()}/verificar?token=${token}&lang=${accountLocale(userId)}`;
  enqueueMail({ to: email, ...verificationMail(accountLocale(userId), link) });
}

/** Encola el enlace de recuperación. No revela si el correo existe. */
export async function sendPasswordResetEmail(userId: string, email: string): Promise<void> {
  const token = issueAccountToken(userId, "reset_password");
  const link = `${siteUrl()}/restablecer?token=${token}&lang=${accountLocale(userId)}`;
  enqueueMail({ to: email, ...passwordResetMail(accountLocale(userId), link) });
}

/**
 * Idioma del correo: el de la cuenta, no el de quien pide el envío. Un
 * restablecimiento puede pedirse desde un navegador en otro idioma o sin
 * cookie; la persona que lo recibe es la misma de siempre.
 */
function accountLocale(userId: string): Locale {
  try {
    const row = getDb()
      .prepare("SELECT locale FROM users WHERE id = ?")
      .get(userId) as { locale: string } | undefined;
    return normalizeLocale(row?.locale);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function assertTokenShape(token: string): void {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, "El enlace no es válido.");
}

/**
 * Comprueba un token sin consumirlo. La página de apelación lo usa para
 * enseñar el formulario; el envío sí lo consume.
 */
export function peekAccountToken(raw: string, purpose: TokenPurpose): string | null {
  const row = getDb()
    .prepare(
      `SELECT user_id FROM account_tokens
        WHERE token_hash = ? AND purpose = ? AND used_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .get(hashToken(raw), purpose) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/** Encola el aviso de suspensión con el enlace de apelación. */
export function sendSuspensionEmail(
  userId: string,
  email: string,
  reason: string,
  until: string,
): void {
  const token = issueAccountToken(userId, "appeal");
  const locale = accountLocale(userId);
  const link = `${siteUrl()}/apelar?token=${token}&lang=${locale}`;
  enqueueMail({
    to: email,
    ...suspensionMail(locale, { reason, until: until.slice(0, 10), link }),
  });
}

/** Encola la respuesta a la apelación, en el idioma de la cuenta. */
export function sendAppealResolvedEmail(
  userId: string,
  email: string,
  upheld: boolean,
  resolution: string,
): void {
  const locale = accountLocale(userId);
  enqueueMail({ to: email, ...appealResolvedMail(locale, { upheld, resolution }) });
}
