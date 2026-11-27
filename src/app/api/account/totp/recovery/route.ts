import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import {
  generateRecoveryCodes,
  getTotpState,
  getUserWithPassword,
  verifySecondFactor,
} from "@/lib/repo";
import { route } from "@/lib/route";
import { totpRecoverySchema } from "@/lib/validation";

/**
 * Códigos de recuperación nuevos.
 *
 * No basta con la contraseña ni con la sesión: si valiera, quien robara ambas
 * podría generarse una entrada que se salta el segundo factor. Se exige también
 * un código vigente (de la aplicación o uno de recuperación, que se gasta).
 */
export const POST = route(
  { limit: { bucket: "totp:recovery", limit: 5, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const input = totpRecoverySchema.parse(await readJson(request));

    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }
    if (!getTotpState(user.id).enabled) {
      throw new ApiError(409, "Activa la verificación en dos pasos antes de generar códigos.");
    }
    if (!verifySecondFactor(user.id, input.code)) {
      throw new ApiError(422, "El código no es válido o ha caducado.");
    }

    // Los nuevos sustituyen a los anteriores en la misma transacción: los
    // viejos dejan de valer en cuanto se genera la tanda.
    const recoveryCodes = generateRecoveryCodes(user.id);
    return json({ ...getTotpState(user.id), recoveryCodes });
  },
);
