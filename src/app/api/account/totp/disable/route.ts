import { json, readJson } from "@/lib/api";
import { destroyUserSessions } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { disableTotp, getTotpState, getUserWithPassword, verifySecondFactor } from "@/lib/repo";
import { totpDisableSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Desactivar exige contraseña y, si estaba activo, un código vigente. */
export const POST = route(
  { limit: { bucket: "totp:disable", limit: 5, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const input = totpDisableSchema.parse(await readJson(request));

    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }

    if (getTotpState(user.id).enabled) {
      if (!input.code) {
        throw new ApiError(422, "Introduce el código de verificación o uno de recuperación.");
      }
      // Se acepta también un código de recuperación: quien perdió el teléfono
      // tiene que poder desactivarlo (y volver a activarlo con el nuevo).
      if (!verifySecondFactor(user.id, input.code)) {
        throw new ApiError(422, "El código no es válido o ha caducado.");
      }
    }

    disableTotp(user.id);
    // Al cambiar el segundo factor se cierran las demás sesiones: si el cambio
    // no era de la persona, no debe quedarse dentro con la sesión anterior.
    destroyUserSessions(user.id);
    return json(getTotpState(user.id));
  },
);
