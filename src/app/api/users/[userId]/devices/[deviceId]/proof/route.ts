import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
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
  {},
  ({ params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    if (!getDevice(params.userId, deviceId)) {
      throw new ApiError(404, "Ese dispositivo no existe.");
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
