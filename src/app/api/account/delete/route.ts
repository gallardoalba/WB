import { invalidatePublicData } from "@/lib/revalidate";
import { cookies } from "next/headers";
import { json, readJson } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { deleteAccount, getUserWithPassword } from "@/lib/repo";
import { createKeySnapshot } from "@/lib/transparency";
import { deleteAccountSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route(
  { limit: { bucket: "account:delete", limit: 3, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const { password } = deleteAccountSchema.parse(await readJson(request));
    const account = getUserWithPassword(user.email);
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      throw new ApiError(401, "La contraseña no es correcta.");
    }

    deleteAccount(user.id);
    // El borrado deja líneas de retirada en el directorio; una instantánea
    // nueva las incluye para que las pruebas no sigan viendo las claves de una
    // cuenta que ya no existe.
    try {
      createKeySnapshot();
    } catch (error) {
      console.error("No se pudo firmar la instantánea tras borrar la cuenta:", error);
    }
    (await cookies()).delete(SESSION_COOKIE);
    invalidatePublicData();
    return json({ ok: true });
  },
);
