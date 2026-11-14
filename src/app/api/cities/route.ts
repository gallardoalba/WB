import { handleApiError, json } from "@/lib/api";
import { searchCities } from "@/lib/city-search";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";

/**
 * Sugerencias de ciudad para el formulario (alta, perfil, libros y clubes).
 *
 * Es pública a propósito: hay que poder elegir la ciudad **antes** de tener
 * cuenta. Con cuota, porque el selector la llama mientras se escribe y sin
 * límite una sola persona podría barrer el callejero entero.
 */
export async function GET(request: Request) {
  try {
    if (hasClientIp()) {
      hit({ bucket: "cities:search:ip", key: clientKey(request), limit: 240, windowMs: 60_000 });
    } else {
      hit({ bucket: "cities:search", key: "all", limit: 1_200, windowMs: 60_000 });
    }
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return json({ cities: await searchCities(q) });
  } catch (error) {
    return handleApiError(error);
  }
}
