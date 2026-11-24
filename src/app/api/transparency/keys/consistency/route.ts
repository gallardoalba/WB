import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { consistencyProofBetween } from "@/lib/transparency";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { keySnapshotIdSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Prueba de que una instantánea del directorio **contiene** a otra anterior.
 *
 * Es lo que convierte «esta raíz la firma el operador» en «esta raíz es la
 * continuación de la que ya vi». Sin ella, el operador puede firmar dos
 * historias coherentes y las dos verifican: la firma dice quién habló, no que
 * solo haya una historia. Con ella, quien guardó una raíz antigua comprueba que
 * la nueva la extiende, y fabricar una prueba falsa exigiría una colisión de
 * SHA-256.
 *
 * Solo devuelve hashes: ni una línea del directorio, así que no revela qué
 * cuentas hay ni qué claves tienen.
 */
export const GET = route<undefined, "none">(
  { auth: "none" },
  ({ request }) => {
    if (hasClientIp()) {
      hit({
        bucket: "transparency:consistency:ip",
        key: clientKey(request),
        limit: 120,
        windowMs: 60_000,
      });
    } else {
      hit({ bucket: "transparency:consistency", key: "all", limit: 600, windowMs: 60_000 });
    }

    const url = new URL(request.url);
    const raw = { from: url.searchParams.get("from"), to: url.searchParams.get("to") };
    if (!raw.from || !raw.to) {
      throw new ApiError(400, "Faltan las dos instantáneas: `from` y `to`.");
    }
    // Forma de id antes de tocar la base: no hay razón para consultar por algo
    // que no puede ser una instantánea.
    const from = keySnapshotIdSchema.parse(raw.from);
    const to = keySnapshotIdSchema.parse(raw.to);
    if (from === to) {
      throw new ApiError(400, "Las dos instantáneas tienen que ser distintas.");
    }

    const answer = consistencyProofBetween(from, to);
    if (!answer) {
      throw new ApiError(
        404,
        "No se puede demostrar la consistencia entre esas instantáneas: alguna no existe o la nueva no continúa la anterior.",
      );
    }
    return json(answer, 200, { "cache-control": "public, max-age=60" });
  },
);
