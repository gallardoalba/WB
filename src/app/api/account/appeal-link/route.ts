import { createHash } from "node:crypto";
import { after } from "next/server";
import { sendSuspensionEmail } from "@/lib/account-tokens";
import { processOutbox } from "@/lib/outbox";
import { json, readJson } from "@/lib/api";
import { hasOpenAppeal, suspendedAccountByEmail } from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { appealLinkSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Pide otro enlace de apelación: el correo se pierde, acaba en spam o el token
 * caduca, y sin esto la sanción quedaría sin recurso. No hay sesión porque una
 * cuenta suspendida no puede entrar, y la respuesta es siempre la misma para no
 * revelar si el correo corresponde a una cuenta sancionada.
 */
export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    guard(request, {
      bucket: "account:appeal-link",
      key: "all",
      limit: 1000,
      windowMs: 60 * 60 * 1000,
    });
    if (hasClientIp()) {
      hit({ bucket: "account:appeal-link:ip", key: clientKey(request), limit: 10, windowMs: 60 * 60 * 1000 });
    }
    const { email } = appealLinkSchema.parse(await readJson(request));
    const emailKey = createHash("sha256").update(email).digest("hex");
    hit({ bucket: "account:appeal-link:email", key: emailKey, limit: 3, windowMs: 60 * 60 * 1000 });

    const account = suspendedAccountByEmail(email);
    if (account && !hasOpenAppeal(account.id)) {
      const resend = async () => {
        try {
          sendSuspensionEmail(account.id, account.email, account.reason, account.until);
          await processOutbox();
        } catch (error) {
          console.error("[appeals] no se pudo reenviar el enlace", error);
        }
      };
      // Fuera de la petición: el tiempo de respuesta no delata si hay sanción.
      // Sin contexto de petición (pruebas), se hace en el momento.
      try {
        after(resend);
      } catch {
        await resend();
      }
    }

    return json({ ok: true });
  },
);
