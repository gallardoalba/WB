import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { CITIES } from "@/lib/cities";
import {
  getStats,
  listActivity,
  listClubs,
  listPublicReadingLists,
  listReaders,
  listRecentComments,
} from "@/lib/repo";
import { hit } from "@/lib/throttle";

/**
 * Panel de comunidad en una sola respuesta: muro, conversaciones, clubes,
 * lectores y listas.
 *
 * La web pinta cada pestaña en el servidor (`getSnapshot`) y no paga las demás.
 * La app Android, en cambio, cambia de pestaña en el cliente: aquí se devuelven
 * las cinco colecciones de una vez con un tamaño de página pensado para móvil.
 * El ámbito «ciudad» usa la ciudad del perfil, igual que la web.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    hit({ bucket: "community:panel", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    const url = new URL(request.url);
    const rawCity = url.searchParams.get("city") ?? "";
    const requestedCity = CITIES.some((entry) => entry.name === rawCity) ? rawCity : null;
    const scopeCity = url.searchParams.get("scope") === "city" ? user.city : requestedCity;
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const viewer = { id: user.id, isAdmin: user.isAdmin };

    return json({
      activity: listActivity(12, scopeCity),
      conversations: listRecentComments(8, viewer, scopeCity),
      clubs: listClubs({
        viewerId: user.id,
        city: scopeCity,
        q,
        sort: "meeting",
        pageSize: 12,
      }),
      readers: listReaders({
        viewerId: user.id,
        city: scopeCity,
        q,
        sort: "near",
        pageSize: 12,
      }),
      lists: listPublicReadingLists({ viewerId: user.id, q, pageSize: 12 }),
      stats: getStats(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
