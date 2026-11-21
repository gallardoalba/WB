import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { route } from "@/lib/route";

export const GET = route({ auth: "optional" }, async ({ user }) => {
  // La BD renueva la sesión de forma deslizante; hay que refrescar también la
  // cookie del navegador o el usuario perdería la sesión a los 14 días.
  if (user) {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
  }
  return json({ user });
});
