import { assertTokenShape, consumeAccountToken } from "@/lib/account-tokens";
import { json, readJson } from "@/lib/api";
import { destroyUserSessions } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";
import { changePassword, getUserById } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { resetPasswordSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Restablece la contraseña con el token del enlace y cierra todas las sesiones. */
export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    guard(request, {
      bucket: "auth:reset",
      key: "all",
      limit: 1000,
      windowMs: 60 * 60 * 1000,
    });
    const { token, password } = resetPasswordSchema.parse(await readJson(request));
    assertTokenShape(token);

    const consumed = consumeAccountToken(token, "reset_password");
    if (!consumed) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
    const { userId } = consumed;
    if (!getUserById(userId)) throw new ApiError(404, "La cuenta no existe.");

    changePassword(userId, await hashPassword(password));
    destroyUserSessions(userId);
    return json({ ok: true });
  },
);
