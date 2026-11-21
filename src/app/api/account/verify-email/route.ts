import { sendVerificationEmail } from "@/lib/account-tokens";
import { processOutbox } from "@/lib/outbox";
import { after } from "next/server";
import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { getUserById } from "@/lib/repo";
import { route } from "@/lib/route";

/** Reenvía el enlace de confirmación a la cuenta con sesión iniciada. */
export const POST = route(
  { limit: { bucket: "account:verify:resend", limit: 3, windowMs: 60 * 60 * 1000 } },
  async ({ user }) => {
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
  },
);
