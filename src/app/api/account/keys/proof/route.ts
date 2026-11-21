import { json } from "@/lib/api";
import { keyInclusion, verifyKeySnapshotSignature, latestKeySnapshot } from "@/lib/transparency";
import { deviceIdSchema } from "@/lib/validation";
import { ApiError } from "@/lib/errors";
import { route } from "@/lib/route";

/**
 * Prueba de que la clave publicada de esta cuenta está en la última
 * instantánea firmada del directorio.
 *
 * Solo la pide su titular: el directorio no se publica entero porque revelaría
 * cuántas cuentas hay y cuándo cambió cada clave. Con la rama de Merkle y la
 * raíz firmada, la persona puede comprobar por su cuenta que lo que el servidor
 * le enseña es lo que quedó comprometido.
 *
 * `?device=<id>` pide la prueba de un dispositivo v2. Sin él se devuelve la
 * ranura `web` de siempre, así que una cuenta que solo tenga dispositivos
 * —posible desde el protocolo v2— tiene que poder pedir la suya.
 */
export const GET = route(
  {},
  ({ user, request }) => {
    const device = new URL(request.url).searchParams.get("device");
    const proof = device
      ? keyInclusion(user.id, `device:${deviceIdSchema.parse(device)}`)
      : keyInclusion(user.id);
    if (!proof) {
      const snapshot = latestKeySnapshot();
      if (device && !snapshot) {
        throw new ApiError(404, "Todavía no hay ninguna instantánea del directorio de claves.");
      }
      return json(
        {
          proof: null,
          reason: snapshot
            ? device
              ? "Ese dispositivo no está en la última instantánea."
              : "Esta cuenta todavía no tiene clave publicada en la última instantánea."
            : "Todavía no hay ninguna instantánea del directorio de claves.",
        },
        404,
      );
    }
    const snapshot = latestKeySnapshot();
    return json(
      {
        ...proof,
        verified: snapshot ? verifyKeySnapshotSignature(snapshot) : false,
      },
      200,
      { "cache-control": "no-store" },
    );
  },
);
