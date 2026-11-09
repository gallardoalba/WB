import { ApiError } from "./errors";
import { clientKey, hasClientIp, hit } from "./throttle";

/**
 * Cuota de las tarjetas sociales (`/api/og/…`).
 *
 * Cada petición rasteriza una imagen de 1200×630 con Satori + resvg, y si la
 * obra todavía no tiene la portada en caché además sale a la red. Sin límite,
 * un bucle sobre estas dos rutas públicas consume la CPU del VPS entera, así
 * que se cuentan como cualquier otra lectura cara.
 *
 * No lanza: devuelve la respuesta 429 lista para que la ruta la retorne, porque
 * el `ImageResponse` no pasa por `handleApiError()`.
 */
export function ogRateLimit(request: Request): Response | null {
  try {
    hit(
      hasClientIp()
        ? { bucket: "og:ip", key: clientKey(request), limit: 60, windowMs: 60_000 }
        : { bucket: "og", key: "all", limit: 600, windowMs: 60_000 },
    );
    return null;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 429) throw error;
    const retryAfter = Math.max(1, error.retryAfter ?? 60);
    return new Response("Demasiadas peticiones.", {
      status: 429,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": String(retryAfter),
      },
    });
  }
}
