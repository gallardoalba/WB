import { assertTokenShape, consumeAccountToken } from "@/lib/account-tokens";
import { handleApiError, json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { markEmailVerified } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { tokenSchema } from "@/lib/validation";

/** Confirma el correo con el token del enlace. */
export async function POST(request: Request) {
  try {
    guard(request, {
      bucket: "auth:verify",
      key: "all",
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    const { token } = tokenSchema.parse(await readJson(request));
    assertTokenShape(token);

    const userId = consumeAccountToken(token, "verify_email");
    if (!userId) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
    markEmailVerified(userId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
