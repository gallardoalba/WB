import { after } from "next/server";
import {
  assertTokenShape,
  consumeAccountToken,
  sendEmailChangedNotice,
} from "@/lib/account-tokens";
import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { processOutbox } from "@/lib/outbox";
import { applyEmailChange, markEmailVerified } from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { tokenSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Confirma un correo con el token del enlace.
 *
 * Atiende dos enlaces del mismo tipo: el de la cuenta recién creada
 * (`verify_email`) y el del cambio de dirección (`change_email`). En el
 * segundo, la dirección nueva pasa a ser la de la cuenta y el buzón anterior
 * recibe un aviso.
 */
export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    guard(request, {
      bucket: "auth:verify",
      key: "all",
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (hasClientIp()) {
      hit({ bucket: "auth:verify:ip", key: clientKey(request), limit: 60, windowMs: 60 * 60 * 1000 });
    }
    const { token } = tokenSchema.parse(await readJson(request));
    assertTokenShape(token);

    const consumed = consumeAccountToken(token, ["verify_email", "change_email"]);
    if (!consumed) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");

    if (consumed.purpose === "change_email") {
      const change = applyEmailChange(consumed.userId);
      if (!change) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
      sendEmailChangedNotice(consumed.userId, change.previous, change.email);
      after(async () => {
        await processOutbox().catch((error: unknown) => {
          console.error("[auth] no se pudo procesar el aviso de cambio de correo", error);
        });
      });
      return json({ ok: true, emailChanged: true, email: change.email });
    }

    markEmailVerified(consumed.userId);
    return json({ ok: true });
  },
);
