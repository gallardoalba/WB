import { json } from "@/lib/api";
import { listDevices } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Los dispositivos de cifrado de esta cuenta.
 *
 * Es la lista que ve su dueño: identificador, fechas y cuántas claves de un solo
 * uso le quedan a cada uno (lo que dispara la reposición). No incluye material
 * privado ni claves pendientes.
 */
export const GET = route<undefined, "user">({}, ({ user }) =>
  json({
    devices: listDevices(user.id).map((device) => ({
      deviceId: device.deviceId,
      identityKey: device.identityKey,
      signingKey: device.signingKey,
      bundleSignature: device.bundleSignature,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
      oneTimeKeys: device.oneTimeKeys,
    })),
  }),
);
