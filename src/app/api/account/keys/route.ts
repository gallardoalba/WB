import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { getPublicKeyRecord, notify, setPublicKey } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { publicKeySchema } from "@/lib/validation";

/**
 * Clave pública de cifrado de la cuenta.
 *
 * El navegador genera un par ECDH P-256 y guarda la mitad privada en IndexedDB
 * (no extraíble): aquí solo llega la mitad pública. Sin la privada, ni el
 * servidor ni quien administre la base de datos pueden descifrar los mensajes.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const record = getPublicKeyRecord(user.id);
    return json({ publicJwk: record?.jwk ?? null, keyId: record?.keyId ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "account:keys",
      key: user.id,
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const publicJwk = publicKeySchema.parse(await readJson(request));
    // Comprobar que la clave es un punto válido de P-256 antes de publicarla.
    try {
      await crypto.subtle.importKey(
        "jwk",
        { ...publicJwk, ext: true },
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
    } catch {
      throw new ApiError(400, "La clave pública no es un punto válido de P-256.");
    }
    const saved = setPublicKey(user.id, publicJwk);
    if (saved.previousKeyId && saved.previousKeyId !== saved.keyId) {
      notify({
        userId: user.id,
        type: "security",
        title: "Nueva clave de cifrado en tu cuenta",
        body: "Se ha activado una clave distinta en otro dispositivo. Revisa que seas tú.",
        link: "/u/" + user.id,
      });
    }
    return json({ publicJwk: saved.jwk, keyId: saved.keyId });
  } catch (error) {
    return handleApiError(error);
  }
}
