import { after } from "next/server";
import { json } from "@/lib/api";
import { revokeAccountTokens, sendEmailChangeConfirmation } from "@/lib/account-tokens";
import { ApiError } from "@/lib/errors";
import { processOutbox } from "@/lib/outbox";
import { verifyPassword } from "@/lib/password";
import {
  cancelEmailChange,
  getAccountEmail,
  getTotpState,
  getUserWithPassword,
  requestEmailChange,
  verifySecondFactor,
} from "@/lib/repo";
import { route } from "@/lib/route";
import { emailChangeSchema } from "@/lib/validation";

/**
 * Correo de la cuenta.
 *
 * Cambiarlo es cambiar la llave de recuperación: por eso exige la contraseña
 * (y el segundo factor si lo hay) y no se aplica hasta abrir el enlace que se
 * manda a la dirección **nueva**. La dirección anterior recibe un aviso.
 */
export const GET = route({}, ({ user }) => {
  const account = getAccountEmail(user.id);
  if (!account) throw new ApiError(404, "La cuenta no existe.");
  return json(account);
});

export const PATCH = route(
  { body: emailChangeSchema, limit: { bucket: "account:email", limit: 5, windowMs: 60 * 60 * 1000 } },
  async ({ user, body }) => {
    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(body.password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }

    // Con 2FA activo se pide también un código: una contraseña filtrada no
    // basta para llevarse la cuenta a otro buzón.
    if (getTotpState(user.id).enabled && !verifySecondFactor(user.id, body.code ?? "")) {
      throw new ApiError(422, "El código de verificación no es válido o ha caducado.");
    }

    requestEmailChange(user.id, body.email);
    await sendEmailChangeConfirmation(user.id, body.email);
    // El correo sale después de responder: el proveedor no debe retrasar el
    // guardado ni la respuesta.
    after(async () => {
      await processOutbox().catch((error: unknown) => {
        console.error("[account] no se pudo procesar el correo", error);
      });
    });
    return json({ email: account.email, pendingEmail: body.email });
  },
);

/** Cancelar un cambio que aún no se ha confirmado. */
export const DELETE = route(
  { limit: { bucket: "account:email:cancel", limit: 10, windowMs: 60 * 60 * 1000 } },
  ({ user }) => {
    cancelEmailChange(user.id);
    revokeAccountTokens(user.id, "change_email");
    return json({ ok: true });
  },
);
