import { connection } from "next/server";
import { json } from "@/lib/api";
import { PAYLOAD_RETENTION_DAYS, listSnapshots } from "@/lib/transparency";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { route } from "@/lib/route";

/**
 * Instantáneas firmadas del catálogo público.
 *
 * Es la puerta pública a la transparencia del contenido: cada entrada lleva la
 * raíz de Merkle, el hash del NDJSON y la firma Ed25519. Nada de personas sale
 * de aquí; el contenido se comprueba descargando `/api/transparency/export`.
 */
export const GET = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    // Depende de la base y del reloj: fuera del prerender.
    try {
      await connection();
    } catch {
      // Fuera de una petición (pruebas, scripts): no hay render que aplazar.
    }

    // Es una lectura pública y acotada, pero un raspador no debería poder
    // recorrer el histórico a máxima velocidad.
    if (hasClientIp()) {
      hit({
        bucket: "transparency:index:ip",
        key: clientKey(request),
        limit: 120,
        windowMs: 60_000,
      });
    } else {
      hit({ bucket: "transparency:index", key: "all", limit: 600, windowMs: 60_000 });
    }

    const snapshots = listSnapshots(20);
    return json(
      {
        latest: snapshots[0] ?? null,
        snapshots,
        /**
         * Cuántos días se conserva el contenido descargable. Pasado el plazo,
         * la fila (raíz y firma) sigue publicada: la cadena no se rompe.
         */
        payloadRetentionDays: PAYLOAD_RETENTION_DAYS,
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  },
);
