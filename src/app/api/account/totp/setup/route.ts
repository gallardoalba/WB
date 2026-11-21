import { json, readJson } from "@/lib/api";
import QRCode from "qrcode";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { getUserWithPassword, startTotpSetup } from "@/lib/repo";
import { totpSetupSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Genera un secreto pendiente. Se pide la contraseña para que una sesión
 * robada no pueda activar (ni sustituir) el segundo factor.
 */
export const POST = route(
  { limit: { bucket: "totp:setup", limit: 5, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const { password } = totpSetupSchema.parse(await readJson(request));

    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }

    const setup = startTotpSetup(user.id);
    const qrDataUrl = await QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 });
    return json({ ...setup, qrDataUrl });
  },
);
