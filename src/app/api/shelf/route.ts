import { json } from "@/lib/api";
import { shelfListings } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { route } from "@/lib/route";

/**
 * Estantería de la cuenta: sus ejemplares, los guardados o los dos.
 *
 * El catálogo (`/api/listings`) no acepta `shelf` porque su consulta está
 * pensada para descubrir, no para la estantería. La web resuelve esto al pintar
 * la página; un cliente nativo necesita la misma lista en JSON.
 */
export const GET = route(
  {},
  ({ request, user }) => {
    hit({ bucket: "shelf:list", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    const url = new URL(request.url);
    const raw = url.searchParams.get("shelf") ?? "all";
    const shelf = raw === "mine" || raw === "saved" ? raw : "all";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    return json(shelfListings(user.id, shelf, page));
  },
);
