import { sendVerificationEmail } from "@/lib/account-tokens";
import { processOutbox } from "@/lib/outbox";
import { after } from "next/server";
import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { getUserById } from "@/lib/repo";
import { guard } from "@/lib/throttle";

/** Reenvía el enlace de confirmación a la cuenta con sesión iniciada. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "account:verify:resend",
      key: user.id,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });
    const account = getUserById(user.id);
    if (!account) throw new ApiError(404, "La cuenta no existe.");
    if (account.emailVerified) return json({ ok: true, alreadyVerified: true });
    await sendVerificationEmail(account.id, account.email);
    after(async () => {
      await processOutbox().catch((error: unknown) => {
        console.error("[auth] no se pudo procesar el correo", error);
      });
    });
    return json({ ok: true, sent: true });
  } catch (error) {
    return handleApiError(error);
  }
}
