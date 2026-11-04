import { invalidatePublicData } from "@/lib/revalidate";
import { cookies } from "next/headers";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { deleteAccount, getUserWithPassword } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { deleteAccountSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "account:delete", key: user.id, limit: 3, windowMs: 60 * 60 * 1000 });

    const { password } = deleteAccountSchema.parse(await readJson(request));
    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }

    deleteAccount(user.id);
    (await cookies()).delete(SESSION_COOKIE);
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
