import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { sendVerificationEmail } from "@/lib/account-tokens";
import { processOutbox } from "@/lib/outbox";
import { handleApiError, json, readJson } from "@/lib/api";
import { assertHuman } from "@/lib/captcha";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { createUser } from "@/lib/repo";
import { clientIp, clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { registerSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    // La cuota por IP solo tiene sentido si la IP es fiable (`TRUST_PROXY=1`);
    // si no, todas las peticiones comparten la clave y bloquearían el registro
    // de todo el sitio.
    guard(request, { bucket: "register:global", key: "all", limit: 2000, windowMs: 60 * 60 * 1000 });
    if (hasClientIp()) {
      hit({ bucket: "register:ip", key: clientKey(request), limit: 5, windowMs: 60 * 60 * 1000 });
    }

    const input = registerSchema.parse(await readJson(request));
    await assertHuman({
      token: input.turnstileToken,
      honeypot: input.website,
      startedAt: input.startedAt,
      ip: clientIp(request),
    });
    // Cuota por correo: evita crear cuentas en cadena con la misma dirección.
    const emailKey = createHash("sha256").update(input.email).digest("hex");
    hit({ bucket: "register:email", key: emailKey, limit: 3, windowMs: 60 * 60 * 1000 });
    const user = createUser({
      name: input.name,
      email: input.email,
      city: input.city,
      passwordHash: await hashPassword(input.password),
    });
    const token = createSession(user.id);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    // El enlace de confirmación sale después de responder: un proveedor lento
    // no retrasa el registro.
    after(async () => {
      await sendVerificationEmail(user.id, user.email).catch((error: unknown) => {
        console.error("[auth] no se pudo encolar la verificación", error);
      });
      await processOutbox().catch((error: unknown) => {
        console.error("[auth] no se pudo procesar el correo", error);
      });
    });
    return json({ user }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
