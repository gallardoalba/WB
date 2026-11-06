import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import {
  changePublicKey,
  listConversationPeers,
  listPublicKeyHistory,
  listPublicKeyRecords,
  notify,
} from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { publicKeySchema } from "@/lib/validation";

/** Resumen de las ranuras activas, con la web como `keyId` de compatibilidad. */
function keySummary(userId: string) {
  const records = listPublicKeyRecords(userId);
  return {
    keys: records.map((record) => ({
      platform: record.platform,
      keyId: record.keyId,
      publicJwk: record.jwk,
    })),
    keyId: records.find((record) => record.platform === "web")?.keyId ?? null,
    history: listPublicKeyHistory(userId),
  };
}

/**
 * Claves públicas de cifrado de la cuenta.
 *
 * Cada dispositivo ocupa una ranura (`web`, `android`). El navegador y la app
 * generan su par ECDH P-256 y guardan la mitad privada en el dispositivo: aquí
 * solo llega la pública. Sin la privada, ni el servidor ni quien administre la
 * base de datos pueden descifrar los mensajes.
 *
 * La **primera** publicación de una cuenta sin claves es TOFU. En cuanto la
 * cuenta ya tiene una clave (en esta ranura o en otra) hay que confirmar la
 * contraseña, tanto para sustituirla como para añadir un dispositivo nuevo: una
 * sesión robada no basta para instalar otra clave y leer los mensajes futuros.
 * Cada cambio queda en el historial y genera un aviso de seguridad.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return json(keySummary(user.id));
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
    const { platform, ...publicJwk } = publicKeySchema.parse(body);
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
      platform,
    });

    if (saved.changed) {
      // También se avisa al *añadir* una ranura: es una clave nueva en la
      // cuenta, aunque la anterior siga valiendo.
      notify({
        userId: user.id,
        type: "security",
        title: saved.previousKeyId
          ? "Nueva clave de cifrado en tu cuenta"
          : "Se ha añadido una clave de cifrado a tu cuenta",
        body: saved.previousKeyId
          ? "Se ha activado una clave distinta en otro dispositivo. Revisa que seas tú."
          : "Un dispositivo nuevo ha publicado su clave. Revisa que sea tuyo.",
        link: "/u/" + user.id,
      });
      // Al rotar, quien chatea contigo tiene que confirmar la nueva huella
      // antes de seguir enviando mensajes cifrados. Al añadir una ranura los
      // sobres anteriores siguen siendo válidos, así que no hay nada que
      // confirmar.
      if (saved.previousKeyId && saved.previousKeyId !== saved.keyId) {
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
    }

    return json({
      ...keySummary(user.id),
      previousKeyId: saved.previousKeyId,
      changed: saved.changed,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
