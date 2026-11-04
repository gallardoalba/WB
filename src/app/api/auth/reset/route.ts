import { assertTokenShape, consumeAccountToken } from "@/lib/account-tokens";
import { handleApiError, json, readJson } from "@/lib/api";
import { destroyUserSessions } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";
import { changePassword, getUserById } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { resetPasswordSchema } from "@/lib/validation";

/** Restablece la contraseña con el token del enlace y cierra todas las sesiones. */
export async function POST(request: Request) {
  try {
    guard(request, {
      bucket: "auth:reset",
      key: "all",
      limit: 1000,
      windowMs: 60 * 60 * 1000,
    });
    const { token, password } = resetPasswordSchema.parse(await readJson(request));
    assertTokenShape(token);

    const userId = consumeAccountToken(token, "reset_password");
    if (!userId) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
    if (!getUserById(userId)) throw new ApiError(404, "La cuenta no existe.");

    changePassword(userId, await hashPassword(password));
    destroyUserSessions(userId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
