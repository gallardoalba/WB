import { json } from "@/lib/api";
import { claimOneTimeKey } from "@/lib/repo";
import { ApiError } from "@/lib/errors";
import { deviceIdSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Reclama una clave de un solo uso para abrir una sesión v2.
 *
 * La clave se borra en la misma transacción que se entrega: dos peticiones
 * simultáneas no pueden quedarse con la misma. Si no quedan, responde `409` y
 * el cliente espera a que la otra persona reponga; no hay un camino alternativo
 * con menos garantías.
 */
export const POST = route<undefined, "user", { userId: string; deviceId: string }>(
  { limit: { bucket: "device:claim", limit: 120, windowMs: 60 * 60 * 1000 } },
  ({ params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    const bundle = claimOneTimeKey(params.userId, deviceId);
    if (!bundle) throw new ApiError(404, "Ese dispositivo no existe o está retirado.");
    if (!bundle.oneTimeKey) {
      throw new ApiError(409, "Ese dispositivo no tiene claves de un solo uso disponibles.");
    }
    return json({ bundle }, 200);
  },
);
