import { assertTokenShape, consumeAccountToken } from "@/lib/account-tokens";
import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { markEmailVerified } from "@/lib/repo";
import { clientKey, guard, hasClientIp, hit } from "@/lib/throttle";
import { tokenSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Confirma el correo con el token del enlace. */
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

    const userId = consumeAccountToken(token, "verify_email");
    if (!userId) throw new ApiError(410, "El enlace ha caducado o ya se ha usado.");
    markEmailVerified(userId);
    return json({ ok: true });
  },
);
