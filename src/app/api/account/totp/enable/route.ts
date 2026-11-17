import { handleApiError, json, readJson } from "@/lib/api";
import { destroyUserSessions, requireUser } from "@/lib/auth";
import { enableTotp, getTotpState } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { totpCodeSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "totp:enable", key: user.id, limit: 10, windowMs: 60 * 60 * 1000 });
    const { code } = totpCodeSchema.parse(await readJson(request));
    enableTotp(user.id, code);
    // 2FA solo protege los inicios de sesión nuevos: si no se cierran las
    // sesiones anteriores, una sesión robada antes de activarlo sigue dentro.
    destroyUserSessions(user.id);
    return json(getTotpState(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
