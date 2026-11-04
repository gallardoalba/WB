import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { disableTotp, getTotpState, getUserWithPassword, verifyUserTotp } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { totpDisableSchema } from "@/lib/validation";

/** Desactivar exige contraseña y, si estaba activo, un código vigente. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "totp:disable", key: user.id, limit: 5, windowMs: 60 * 60 * 1000 });
    const input = totpDisableSchema.parse(await readJson(request));

    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }

    if (getTotpState(user.id).enabled) {
      if (!input.code) throw new ApiError(422, "Introduce el código de verificación.");
      if (!verifyUserTotp(user.id, input.code)) {
        throw new ApiError(422, "El código de verificación no es válido o ha caducado.");
      }
    }

    disableTotp(user.id);
    return json({ enabled: false, pending: false });
  } catch (error) {
    return handleApiError(error);
  }
}
