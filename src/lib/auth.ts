import "server-only";
import { cookies } from "next/headers";
import { ApiError } from "./errors";
import type { SessionUser } from "./domain";
import { getTotpState } from "./repo/totp";
import { hashToken, userForToken } from "./session-store";

// El ciclo de vida de la sesión (alta, renovación deslizante, tope absoluto,
// cierre) vive en `session-store.ts`, sin nada de React, para poder probarlo.
// Aquí se reexporta: las rutas y las páginas siguen importando de `@/lib/auth`.
export {
  createSession,
  destroySession,
  destroyUserSessions,
  hashToken,
  sessionCookieOptions,
  userForToken,
} from "./session-store";

const BASE_COOKIE = "b2p_session";
const HOST_COOKIE = "__Host-b2p_session";

/** En producción se usa el prefijo __Host-, que exige Secure, Path=/ y sin Domain. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? HOST_COOKIE : BASE_COOKIE;
// En producción solo vale la cookie __Host-: una cookie de subdominio con
// Domain=.dominio no debe poder fijar la sesión (login CSRF / cookie tossing).
const READABLE_COOKIES =
  process.env.NODE_ENV === "production" ? [HOST_COOKIE] : [HOST_COOKIE, BASE_COOKIE];

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  for (const name of READABLE_COOKIES) {
    const value = cookieStore.get(name)?.value;
    if (value) return userForToken(value);
  }
  return null;
}

/**
 * Id (hash) de la sesión que acompaña a esta petición. Nunca sale de aquí el
 * token: el hash solo sirve para señalar «este dispositivo» y para cerrarla.
 */
export async function currentSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  for (const name of READABLE_COOKIES) {
    const value = cookieStore.get(name)?.value;
    if (value) return hashToken(value);
  }
  return null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Inicia sesión para continuar.");
  if (user.isSuspended) {
    throw new ApiError(403, "Tu cuenta está suspendida. Contacta con el equipo de moderación.");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "No tienes permisos de administración.");
  // En producción, una sesión de administración robada no debe bastar: el
  // segundo factor es obligatorio para moderar.
  if (process.env.NODE_ENV === "production" && !getTotpState(user.id).enabled) {
    throw new ApiError(403, "Activa la verificación en dos pasos para usar la administración.");
  }
  return user;
}
