import { json } from "@/lib/api";
import {
  createReadingList,
  listPublicReadingLists,
  listReadingLists,
} from "@/lib/repo";
import { DIA, route } from "@/lib/route";
import { readingListSchema } from "@/lib/validation";

export const POST = route(
  {
    body: readingListSchema,
    limit: { bucket: "list:create", limit: 12, windowMs: DIA },
  },
  ({ user, body }) => json({ list: createReadingList(user.id, body) }, 201),
);

/**
 * Listas propias (para el selector de «añadir a una lista»).
 *
 * Con `?scope=public` devuelve el escaparate público, que es lo que muestra la
 * app Android en la pestaña de listas: sin este parámetro solo se podían leer
 * las listas propias y las públicas quedaban fuera del alcance de un cliente
 * que no renderiza HTML.
 */
export const GET = route(
  {
    limit: {
      bucket: "lists:list",
      limit: 240,
      windowMs: 60 * 60 * 1000,
      mode: "hit",
    },
  },
  ({ request, user }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("scope") === "public") {
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
      return json(listPublicReadingLists({ viewerId: user.id, q, page }));
    }
    return json({ lists: listReadingLists(user.id, user.id) });
  },
);
