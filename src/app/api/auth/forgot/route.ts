import { createHash } from "node:crypto";
import { after } from "next/server";
import { sendPasswordResetEmail } from "@/lib/account-tokens";
import { processOutbox } from "@/lib/outbox";
import { handleApiError, json, readJson } from "@/lib/api";
import { getUserWithPassword } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * Pide un enlace de recuperación. Responde siempre lo mismo para no revelar si
 * el correo está registrado.
 */
export async function POST(request: Request) {
  try {
    // Cuota global alta como válvula de seguridad; la cuota real es por correo,
    // así nadie puede agotar la recuperación para todo el sitio.
    guard(request, {
      bucket: "auth:forgot",
      key: "all",
      limit: 2000,
      windowMs: 60 * 60 * 1000,
    });
    const { email } = forgotPasswordSchema.parse(await readJson(request));
    const emailKey = createHash("sha256").update(email).digest("hex");
    hit({ bucket: "auth:forgot:email", key: emailKey, limit: 3, windowMs: 60 * 60 * 1000 });

    const account = getUserWithPassword(email);
    if (account && !account.isSuspended) {
      // El envío sale después de responder: el tiempo de la petición no revela
      // si la cuenta existe y un proveedor lento no bloquea la ruta.
      after(async () => {
        await sendPasswordResetEmail(account.id, account.email).catch((error: unknown) => {
          console.error("[auth] no se pudo encolar la recuperación", error);
        });
        await processOutbox().catch((error: unknown) => {
          console.error("[auth] no se pudo procesar el correo", error);
        });
      });
    }

    return json({
      ok: true,
      message: "Si ese correo tiene cuenta, te hemos enviado un enlace para elegir otra contraseña.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
