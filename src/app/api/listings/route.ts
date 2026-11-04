import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { catalogPage, countBookWants, createListing } from "@/lib/repo";
import { clientIp, guard, hasClientIp, hit } from "@/lib/throttle";
import { catalogParamsSchema, listingSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    // La búsqueda es pública: se limita el ritmo para que no se pueda raspar.
    if (hasClientIp()) {
      hit({ bucket: "catalog:search:ip", key: clientIp(request), limit: 120, windowMs: 60_000 });
    } else {
      hit({ bucket: "catalog:search", key: "all", limit: 600, windowMs: 60_000 });
    }
    const user = await getSessionUser();
    const url = new URL(request.url);
    const params = catalogParamsSchema.parse(Object.fromEntries(url.searchParams));
    return json(catalogPage(user?.id ?? null, params));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    // Se valida **antes** de gastar cuota: un cuerpo inválido no es un
    // intento de publicar y no debe consumir el límite diario (si no, unos
    // cuantos formularios mal enviados dejan la cuenta sin poder publicar el
    // resto del día). El rechazo es una respuesta 422 barata y sin escrituras.
    const input = listingSchema.parse(await readJson(request));
    guard(request, {
      bucket: "listing:create",
      key: user.id,
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const listing = createListing(user.id, input);
    invalidatePublicData();
    // La demanda se calcula después de publicar: si alguien buscaba la obra
    // en la misma ciudad, la persona que publica lo ve de inmediato.
    const demand = countBookWants(listing.bookId, user.city, user.id);
    return json({ listing, demand }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
