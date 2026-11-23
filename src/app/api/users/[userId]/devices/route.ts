import { json } from "@/lib/api";
import { listDevices } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Dispositivos públicos de una cuenta.
 *
 * Hace falta sesión para verlos: la lista no es un directorio abierto. Devuelve
 * solo lo que hace falta para abrir una sesión —identificador, claves públicas y
 * la firma del paquete—, nunca claves de un solo uso —esas se reclaman de una en
 * una en la ruta de `claim`— ni cuántas quedan: ese contador solo lo necesita su
 * dueño (`GET /api/account/devices`) y aquí sería una pista para agotarlas.
 */
export const GET = route<undefined, "user", { userId: string }>(
  {},
  ({ params }) =>
    json({
      devices: listDevices(params.userId).map((device) => ({
        deviceId: device.deviceId,
        identityKey: device.identityKey,
        signingKey: device.signingKey,
        bundleSignature: device.bundleSignature,
      })),
    }),
);
