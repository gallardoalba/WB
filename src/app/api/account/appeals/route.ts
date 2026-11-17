import { assertTokenShape, consumeAccountToken } from "@/lib/account-tokens";
import { handleApiError, json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { createAppeal } from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { appealSchema } from "@/lib/validation";

/**
 * Apelación desde el enlace del correo. No hay sesión: quien está suspendido
 * no puede entrar. El token es de un solo uso y caduca a los 30 días.
 */
export async function POST(request: Request) {
  try {
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
    const userId = consumeAccountToken(token, "appeal");
    if (!userId) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
    createAppeal(userId, message);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
