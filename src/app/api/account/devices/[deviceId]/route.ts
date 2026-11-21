import { json } from "@/lib/api";
import { publishDevice, revokeDevice } from "@/lib/repo";
import { deviceIdSchema, publishDeviceSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Publica la identidad de un dispositivo y sus claves de un solo uso.
 *
 * Es su propia clave: la ruta exige sesión y el `deviceId` de la URL es el que
 * se publica, así que nadie puede dar de alta un dispositivo a nombre de otra
 * cuenta. Solo viaja material público: identidad Curve25519, firma Ed25519 y
 * claves de un solo uso.
 */
export const PUT = route<typeof publishDeviceSchema, "user", { deviceId: string }>(
  {
    body: publishDeviceSchema,
    limit: { bucket: "device:publish", limit: 60, windowMs: 60 * 60 * 1000 },
  },
  ({ user, body, params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    return json({ device: publishDevice(user.id, { deviceId, ...body }) }, 200);
  },
);

/** Baja lógica: deja de publicarse y pierde sus claves de un solo uso. */
export const DELETE = route<undefined, "user", { deviceId: string }>(
  { limit: { bucket: "device:revoke", limit: 30, windowMs: 24 * 60 * 60 * 1000 } },
  ({ user, params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    return json({ revoked: revokeDevice(user.id, deviceId) }, 200);
  },
);
