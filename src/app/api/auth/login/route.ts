import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { handleApiError, json, readJson } from "@/lib/api";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/password";
import {
  clearAuthFailures,
  getTotpState,
  getUserWithPassword,
  isAuthBlocked,
  recordAuthFailure,
  verifyUserTotp,
} from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    // Pseudónimo diario de la IP: el limitador no guarda direcciones en claro.
    const ip = clientKey(request);
    // Tres capas: proceso (global), origen (IP, solo con proxy propio) y cuenta
    // concreta. La de cuenta frena los ataques distribuidos que rotan IPs.
    // Válvula de seguridad global: alta a propósito. Las cuotas reales son por
    // IP y por cuenta; un bucket pequeño permitía bloquear el login de todo el
    // sitio con unas pocas peticiones basura.
    guard(request, { bucket: "login:global", key: "all", limit: 5000, windowMs: 60_000 });
    if (hasClientIp()) {
      hit({ bucket: "login:ip", key: ip, limit: 30, windowMs: 60_000 });
    }

    const input = loginSchema.parse(await readJson(request));
    // La clave se guarda hasheada: el limitador no necesita (ni debe) conservar
    // correos en claro.
    const accountKey = createHash("sha256").update(input.email).digest("hex");

    const attemptKey = `${accountKey}|${ip}`;
    // Si la cuenta viene de una racha de fallos, se comprueba igualmente la
    // contraseña: un intento correcto del titular no puede quedar bloqueado por
    // un ataque de terceros (bloqueo dirigido). Los fallos siguen cortados.
    const blocked = isAuthBlocked(attemptKey);

    const account = getUserWithPassword(input.email);
    // Se verifica siempre (contra el hash señuelo si no hay cuenta) para que el
    // tiempo de respuesta no revele si el correo está registrado.
    const valid = await verifyPassword(input.password, account?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!account || !valid) {
      recordAuthFailure(attemptKey);
      // La cuota por cuenta se aplica después de verificar: nunca impide entrar
      // con la contraseña correcta.
      hit({ bucket: "login:account", key: accountKey, limit: 20, windowMs: 15 * 60_000 });
      if (blocked) {
        return json(
          { error: "Demasiados intentos. Espera unos minutos antes de volver a probar." },
          429,
          { "Retry-After": "900" },
        );
      }
      throw new ApiError(401, "Correo o contraseña incorrectos.");
    }
    if (account.isSuspended) {
      throw new ApiError(403, "Tu cuenta está suspendida. Contacta con el equipo de moderación.");
    }

    // Segundo factor: la contraseña ya es correcta, pero no se abre sesión
    // hasta validar el código de la app de autenticación.
    if (getTotpState(account.id).enabled) {
      const code = input.code ?? "";
      if (!code) {
        return json(
          {
            error: "Introduce el código de verificación de tu aplicación de autenticación.",
            twoFactorRequired: true,
          },
          401,
        );
      }
      if (!verifyUserTotp(account.id, code)) {
        recordAuthFailure(attemptKey);
        hit({ bucket: "login:account", key: accountKey, limit: 20, windowMs: 15 * 60_000 });
        throw new ApiError(401, "El código de verificación no es válido o ha caducado.");
      }
    }

    clearAuthFailures(attemptKey);
    const token = createSession(account.id);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    const user = {
      id: account.id,
      name: account.name,
      email: account.email,
      city: account.city,
      bio: account.bio,
      isAdmin: account.isAdmin,
      isSuspended: account.isSuspended,
      emailVerified: account.emailVerified,
      emailNotifications: account.emailNotifications,
    };
    return json({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
