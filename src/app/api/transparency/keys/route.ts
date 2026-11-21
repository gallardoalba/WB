import { json } from "@/lib/api";
import { listKeySnapshots } from "@/lib/transparency";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { route } from "@/lib/route";

/**
 * Instantáneas firmadas del directorio de claves.
 *
 * Publica **raíces y firmas, no el directorio**: qué cuenta tiene qué huella
 * no sale de aquí. Cada cuenta puede pedir su prueba de inclusión en
 * `/api/account/keys/proof` y comprobar que la clave que ve está en la raíz
 * firmada. Un servidor que quisiera enseñarle otra clave no podría fabricar la
 * prueba contra una raíz que ya está publicada.
 */
export const GET = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    if (hasClientIp()) {
      hit({
        bucket: "transparency:keys:ip",
        key: clientKey(request),
        limit: 120,
        windowMs: 60_000,
      });
    } else {
      hit({ bucket: "transparency:keys", key: "all", limit: 600, windowMs: 60_000 });
    }

    const snapshots = listKeySnapshots(20);
    return json(
      { latest: snapshots[0] ?? null, snapshots },
      200,
      { "cache-control": "public, max-age=60" },
    );
  },
);
