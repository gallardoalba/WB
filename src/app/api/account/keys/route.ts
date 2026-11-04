import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import {
  changePublicKey,
  getPublicKeyRecord,
  listConversationPeers,
  listPublicKeyHistory,
  notify,
} from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { publicKeySchema } from "@/lib/validation";

/**
 * Clave pública de cifrado de la cuenta.
 *
 * El navegador genera un par ECDH P-256 y guarda la mitad privada en IndexedDB
 * (no extraíble): aquí solo llega la mitad pública. Sin la privada, ni el
 * servidor ni quien administre la base de datos pueden descifrar los mensajes.
 *
 * La **primera** publicación es TOFU. Sustituir una clave existente exige la
 * contraseña de la cuenta: una sesión robada no basta para instalar otra clave
 * y leer los mensajes futuros. Cada cambio queda en el historial.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const record = getPublicKeyRecord(user.id);
    return json({
      publicJwk: record?.jwk ?? null,
      keyId: record?.keyId ?? null,
      history: listPublicKeyHistory(user.id),
    });
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
    const body = await readJson(request);
    const publicJwk = publicKeySchema.parse(body);
    const password = (body as { password?: unknown }).password;

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

    const saved = await changePublicKey(user.id, publicJwk, {
      password: typeof password === "string" && password.length > 0 ? password : undefined,
    });

    if (saved.changed && saved.previousKeyId && saved.previousKeyId !== saved.keyId) {
      notify({
        userId: user.id,
        type: "security",
        title: "Nueva clave de cifrado en tu cuenta",
        body: "Se ha activado una clave distinta en otro dispositivo. Revisa que seas tú.",
        link: "/u/" + user.id,
      });
      // Quien chatea contigo tiene que confirmar la nueva huella antes de
      // seguir enviando mensajes cifrados.
      for (const peerId of listConversationPeers(user.id)) {
        notify({
          userId: peerId,
          type: "security",
          title: "Cambio de clave de cifrado",
          body: "La persona con la que hablabas ha cambiado su clave. Confirma la nueva huella antes de enviar mensajes.",
          link: "/u/" + user.id,
        });
      }
    }

    return json({
      publicJwk: saved.jwk,
      keyId: saved.keyId,
      previousKeyId: saved.previousKeyId,
      changed: saved.changed,
      history: listPublicKeyHistory(user.id),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
