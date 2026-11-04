import { getDb } from "../db";
import { ApiError } from "../errors";
import { decryptSecret, encryptSecret } from "../secret-box";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../totp";
import { getUserById } from "./users";

export type TotpState = { enabled: boolean; pending: boolean };

type TotpRow = {
  totp_secret: string | null;
  totp_enabled_at: string | null;
  totp_last_step: number | null;
};

function readRow(userId: string): TotpRow | undefined {
  return getDb()
    .prepare("SELECT totp_secret, totp_enabled_at, totp_last_step FROM users WHERE id = ?")
    .get(userId) as TotpRow | undefined;
}

export function getTotpState(userId: string): TotpState {
  const row = readRow(userId);
  if (!row) throw new ApiError(404, "La cuenta no existe.");
  return {
    enabled: Boolean(row.totp_enabled_at),
    // Hay secreto pero todavía no se ha confirmado con un código.
    pending: Boolean(row.totp_secret) && !row.totp_enabled_at,
  };
}

/** Genera (o reemplaza) un secreto pendiente y devuelve el enlace otpauth. */
export function startTotpSetup(userId: string): { secret: string; otpauthUrl: string } {
  const user = getUserById(userId);
  if (!user) throw new ApiError(404, "La cuenta no existe.");
  const row = readRow(userId);
  if (row?.totp_enabled_at) {
    throw new ApiError(409, "La verificación en dos pasos ya está activa.");
  }

  const secret = generateTotpSecret();
  getDb()
    .prepare(
      "UPDATE users SET totp_secret = ?, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?",
    )
    .run(encryptSecret(secret), userId);

  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

/** Confirma el secreto pendiente con un código válido. */
export function enableTotp(userId: string, code: string): void {
  const row = readRow(userId);
  if (!row?.totp_secret) throw new ApiError(409, "Genera primero el secreto de verificación.");
  if (row.totp_enabled_at) throw new ApiError(409, "La verificación en dos pasos ya está activa.");

  const step = verifyTotp(decryptSecret(row.totp_secret), code, { window: 1 });
  if (step === null) throw new ApiError(422, "El código no es válido o ha caducado.");

  getDb()
    .prepare(
      `UPDATE users
          SET totp_enabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              totp_last_step = ?
        WHERE id = ?`,
    )
    .run(step, userId);
}

export function disableTotp(userId: string): void {
  getDb()
    .prepare(
      "UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?",
    )
    .run(userId);
}

/**
 * Comprueba el código de una cuenta con 2FA activo y consume el paso para que
 * no se pueda reutilizar. Devuelve true si la cuenta no tiene 2FA.
 */
export function verifyUserTotp(userId: string, code: string): boolean {
  const row = readRow(userId);
  if (!row?.totp_secret || !row.totp_enabled_at) return true;

  const step = verifyTotp(decryptSecret(row.totp_secret), code, {
    window: 1,
    afterStep: row.totp_last_step ?? 0,
  });
  if (step === null) return false;

  // Consumo atómico del paso: dos peticiones simultáneas con el mismo código
  // solo pueden tener éxito una vez (antes se leía y luego se escribía).
  const consumed = getDb()
    .prepare(
      `UPDATE users SET totp_last_step = ?
        WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    )
    .run(Math.max(row.totp_last_step ?? 0, step), userId, step);
  return consumed.changes === 1;
}
