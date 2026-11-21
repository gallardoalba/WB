import { cookies } from "next/headers";
import { json, readJson } from "@/lib/api";
import { createSession, destroyUserSessions, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { changePassword, getUserWithPassword } from "@/lib/repo";
import { passwordChangeSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const PATCH = route(
  { limit: { bucket: "account:password", limit: 5, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(await readJson(request));
    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(currentPassword, account.passwordHash))) {
      throw new ApiError(401, "La contraseña actual no es correcta.");
    }

    changePassword(user.id, await hashPassword(newPassword));
    // Se cierran todas las sesiones y se renueva la del dispositivo actual.
    destroyUserSessions(user.id);
    const token = createSession(user.id, request.headers.get("user-agent") ?? "");
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

    return json({ ok: true });
  },
);
