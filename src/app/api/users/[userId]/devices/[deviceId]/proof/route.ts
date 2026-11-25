import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { getDevice } from "@/lib/repo";
import { keyInclusion, latestKeySnapshot } from "@/lib/transparency";
import { deviceIdSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Prueba de que el dispositivo de una cuenta está en la última instantánea
 * firmada del directorio.
 *
 * La pide quien va a hablar con ese dispositivo: sin ella, el cliente solo
 * puede comprobar que el paquete está firmado por sí mismo, no que el servidor
 * lo publicó cuando dice. La línea de la prueba lleva la cuenta, el
 * identificador del dispositivo, su clave de identidad y la fecha —nada que
 * quien pregunta no tenga ya del registro—, así que no revela nada nuevo del
 * directorio.
 */
export const GET = route<undefined, "user", { userId: string; deviceId: string }>(
  // Descomprimir la instantánea y calcular la rama cuesta O(n) por petición y no
  // hace falta sesión: con cuota, igual que el resto de rutas del directorio.
  { limit: { bucket: "device:proof", limit: 120, windowMs: 60 * 60 * 1000 } },
  ({ params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    const device = getDevice(params.userId, deviceId);
    if (!device) {
      throw new ApiError(404, "Ese dispositivo no existe.");
    }
    // Un dispositivo retirado **sí** tiene prueba: la hoja lleva
    // `revoked:<fecha>` y el cliente la usa para distinguir una retirada
    // legítima de una lista a la que el servidor le ha quitado un aparato
    // activo. Devolver 404 aquí dejaba la conversación bloqueada para siempre.
    const account = getDb()
      .prepare("SELECT is_suspended FROM users WHERE id = ?")
      .get(params.userId) as { is_suspended: number } | undefined;
    if (!account || account.is_suspended) {
      throw new ApiError(404, "Ese dispositivo no está disponible.");
    }
    const snapshot = latestKeySnapshot();
    if (snapshot && !snapshot.signature) {
      // Sin firma la prueba no vale para el cliente y el fallo real es de
      // configuración: decirlo aquí ahorra buscar en el navegador.
      throw new ApiError(
        503,
        "El directorio de claves no está firmado: configura TRANSPARENCY_SIGNING_KEY para poder verificar dispositivos.",
      );
    }
    const proof = keyInclusion(params.userId, `device:${deviceId}`);
    if (!snapshot || !proof) {
      throw new ApiError(404, "Todavía no hay una instantánea del directorio con ese dispositivo.");
    }
    return json(
      {
        proof,
        snapshot: {
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          itemCount: snapshot.itemCount,
          merkleRoot: snapshot.merkleRoot,
          previousRoot: snapshot.previousRoot,
          signature: snapshot.signature,
          publicKey: snapshot.publicKey,
          signer: snapshot.signer,
        },
      },
      200,
      { "cache-control": "no-store" },
    );
  },
);
