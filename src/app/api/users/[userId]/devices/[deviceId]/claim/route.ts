import { json } from "@/lib/api";
import { canExchangeKeys, claimOneTimeKey } from "@/lib/repo";
import { ApiError } from "@/lib/errors";
import { hit } from "@/lib/throttle";
import { deviceIdSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Reclama una clave de un solo uso para abrir una sesión v2.
 *
 * La clave se borra en la misma transacción que se entrega: dos peticiones
 * simultáneas no pueden quedarse con la misma. Si no quedan, responde `409` y
 * el cliente espera a que la otra persona reponga; no hay un camino alternativo
 * con menos garantías, porque ese camino sería volver a v1.
 *
 * Además de la cuota por quien llama, hay un tope **por dispositivo**: sin él,
 * cuentas distintas podrían vaciar entre todas las claves de una persona y
 * dejarla sin poder recibir mensajes nuevos.
 */
export const POST = route<undefined, "user", { userId: string; deviceId: string }>(
  { limit: { bucket: "device:claim", limit: 120, windowMs: 60 * 60 * 1000 } },
  ({ user, params }) => {
    // Solo entre cuentas que podrían hablarse: si no, cualquiera con sesión
    // podría gastar las claves de un dispositivo ajeno y dejarlo sin poder
    // abrir sesiones nuevas.
    if (!canExchangeKeys(user.id, params.userId)) {
      throw new ApiError(403, "No puedes reclamar claves de esa cuenta.");
    }
    const deviceId = deviceIdSchema.parse(params.deviceId);
    hit({
      bucket: "device:claim:target",
      key: `${params.userId}:${deviceId}`,
      limit: 40,
      windowMs: 60 * 60 * 1000,
    });

    const bundle = claimOneTimeKey(params.userId, deviceId);
    if (!bundle) throw new ApiError(404, "Ese dispositivo no existe o está retirado.");
    if (!bundle.oneTimeKey) {
      throw new ApiError(409, "Ese dispositivo no tiene claves de un solo uso disponibles.");
    }
    return json({ bundle }, 200);
  },
);
