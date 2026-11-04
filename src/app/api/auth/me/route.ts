import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleApiError, json } from "@/lib/api";
import { SESSION_COOKIE, sessionCookieOptions, userForToken } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  try {
    const user = userForToken(token);
    // La BD renueva la sesión de forma deslizante; hay que refrescar también la
    // cookie del navegador o el usuario perdería la sesión a los 14 días.
    if (user && token) {
      (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    }
    return json({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
