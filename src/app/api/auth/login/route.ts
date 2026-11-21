import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { json, readJson } from "@/lib/api";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import {
  changePassword,
  clearAuthFailures,
  getTotpState,
  getUserWithPassword,
  isAuthBlocked,
  liftSuspension,
  publicSessionUser,
  recordAuthFailure,
  verifyUserTotp,
} from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { loginSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
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
      // Una suspensión temporal que ya ha vencido no debe durar hasta que pase
      // el cron: se levanta aquí, con la misma condición que usa el
      // mantenimiento.
      const until = account.suspendedUntil ? new Date(account.suspendedUntil).getTime() : null;
      if (until !== null && Number.isFinite(until) && until <= Date.now()) {
        liftSuspension(account.id);
        account.isSuspended = false;
        account.suspendedUntil = null;
      } else {
        throw new ApiError(
          403,
          "Tu cuenta está suspendida. Revisa el correo con la sanción o escribe al equipo de moderación.",
        );
      }
    }

    // Segundo factor: la contraseña ya es correcta, pero no se abre sesión
    // hasta validar el código de la app de autenticación.
    if (getTotpState(account.id).enabled) {
      // Los fallos del segundo factor se cuentan aparte: un ataque contra el
      // código no puede bloquear el acceso de quien solo se equivocó con la
      // contraseña, y una racha de códigos incorrectos sí se corta aquí. Antes
      // el contador subía pero nadie lo miraba, así que probar códigos era
      // gratis para quien ya tenía la contraseña.
      const totpKey = `${accountKey}|totp`;
      if (isAuthBlocked(totpKey)) {
        return json(
          { error: "Demasiados códigos incorrectos. Espera unos minutos antes de volver a probar." },
          429,
          { "Retry-After": "900" },
        );
      }
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
        recordAuthFailure(totpKey);
        throw new ApiError(401, "El código de verificación no es válido o ha caducado.");
      }
      clearAuthFailures(totpKey);
    }

    // El hash viejo (sin parámetros versionados) se vuelve a firmar aquí, que
    // es el único momento en el que la contraseña está disponible.
    if (needsRehash(account.passwordHash)) {
      changePassword(account.id, await hashPassword(input.password));
    }

    clearAuthFailures(attemptKey);
    const token = createSession(account.id, request.headers.get("user-agent") ?? "");
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    // Se devuelve la cuenta entera (sin el hash) y no un subconjunto: la
    // interfaz pinta la sesión ya iniciada con la respuesta, sin esperar al
    // `router.refresh()`. La forma tiene que coincidir con la de
    // `/api/auth/register`, que ya devuelve un `SessionUser`.
    return json({ user: publicSessionUser(account) });
  },
);
