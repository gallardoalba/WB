import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { cityName } from "@/lib/city-name";
import { createClub, listClubs } from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { guard, hit } from "@/lib/throttle";
import { clubSchema } from "@/lib/validation";

const CLUB_SORTS = ["members", "meeting", "recent", "near"] as const;

/**
 * Listado de clubes para la app Android (y para cualquier cliente JSON).
 *
 * La web pinta esta misma lista en el servidor; la app nativa, en cambio, no
 * puede leer HTML, así que necesita el mismo dato en JSON. Los filtros se
 * validan aquí con el mismo criterio que la página: un valor raro se ignora.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    hit({ bucket: "clubs:list", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    const url = new URL(request.url);
    const rawCity = url.searchParams.get("city") ?? "";
    const city = rawCity.trim().slice(0, 80) || null;
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const rawSort = url.searchParams.get("sort") ?? "";
    const sort = CLUB_SORTS.find((value) => value === rawSort);
    const mine = url.searchParams.get("mine") === "1";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    return json(listClubs({ viewerId: user.id, city, q, mine, sort, page, pageSize: 12 }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:create",
      key: user.id,
      limit: 6,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = clubSchema.parse(await readJson(request));
    const club = createClub(user.id, {
      name: input.name,
      city: await cityName(input.city),
      description: input.description,
      bookId: input.bookId,
      meetsOn: input.meetsOn,
      meetsAt: input.meetsAt,
      joinPolicy: input.joinPolicy,
    });
    invalidatePublicData();
    return json({ club }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
