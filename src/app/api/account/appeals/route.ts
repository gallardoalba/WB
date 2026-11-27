import { assertTokenShape, consumeAccountToken } from "@/lib/account-tokens";
import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { createAppeal } from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { appealSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Apelación desde el enlace del correo. No hay sesión: quien está suspendido
 * no puede entrar. El token es de un solo uso y caduca a los 30 días.
 */
export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    guard(request, {
      bucket: "account:appeal",
      key: "all",
      limit: 1000,
      windowMs: 60 * 60 * 1000,
    });
    if (hasClientIp()) {
      hit({ bucket: "account:appeal:ip", key: clientKey(request), limit: 20, windowMs: 60 * 60 * 1000 });
    }
    const { token, message } = appealSchema.parse(await readJson(request));
    assertTokenShape(token);
    const consumed = consumeAccountToken(token, "appeal");
    if (!consumed) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
    createAppeal(consumed.userId, message);
    return json({ ok: true });
  },
);
