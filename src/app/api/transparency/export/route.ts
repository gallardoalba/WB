import { connection } from "next/server";
import { ApiError } from "@/lib/errors";
import { latestSnapshot, readPayload } from "@/lib/transparency";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { route } from "@/lib/route";

/**
 * Contenido exacto de una instantánea, en NDJSON y sin sesión.
 *
 * Es el mismo texto que se firmó: una línea canónica por obra pública. Quien
 * lo descarga puede recalcular el hash y la raíz de Merkle sin fiarse de esta
 * respuesta, que además los anuncia en cabeceras para una comprobación rápida.
 */
export const GET = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    try {
      await connection();
    } catch {
      // Fuera de una petición (pruebas, scripts): no hay render que aplazar.
    }

    if (hasClientIp()) {
      hit({
        bucket: "transparency:export:ip",
        key: clientKey(request),
        limit: 30,
        windowMs: 60_000,
      });
    } else {
      hit({ bucket: "transparency:export", key: "all", limit: 150, windowMs: 60_000 });
    }

    // Un id son 40 caracteres; el tope evita que una URL enorme llegue a SQLite.
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim().slice(0, 120);
    const latest = id ? null : latestSnapshot();
    const target = readPayload(id || latest?.id || "");

    if (!target) {
      throw new ApiError(404, "No hay ninguna instantánea con ese identificador.");
    }
    if (target.payload === null) {
      throw new ApiError(
        410,
        "El contenido de esa instantánea ya no se conserva; la raíz y la firma siguen publicadas.",
      );
    }

    return new Response(target.payload, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        // Mismo valor que se firma; el verificador externo lo recalcula.
        "x-snapshot-id": target.snapshot.id,
        "x-content-sha256": target.snapshot.payloadHash,
        "x-merkle-root": target.snapshot.merkleRoot,
        "x-item-count": String(target.snapshot.itemCount),
        "cache-control": "public, max-age=300",
        "content-disposition": `attachment; filename="wanderbibliothek-${target.snapshot.id}.ndjson"`,
      },
    });
  },
);
