import { json, readJson } from "@/lib/api";
import { destroyUserSessions } from "@/lib/auth";
import { enableTotp, getTotpState } from "@/lib/repo";
import { totpCodeSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route(
  { limit: { bucket: "totp:enable", limit: 10, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const { code } = totpCodeSchema.parse(await readJson(request));
    // Los códigos de recuperación se entregan en esta única respuesta: en la
    // base solo queda su hash.
    const recoveryCodes = enableTotp(user.id, code);
    // 2FA solo protege los inicios de sesión nuevos: si no se cierran las
    // sesiones anteriores, una sesión robada antes de activarlo sigue dentro.
    destroyUserSessions(user.id);
    return json({ ...getTotpState(user.id), recoveryCodes });
  },
);
