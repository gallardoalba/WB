import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import {
  editListing,
  getListing,
  removeListing,
  setListingStatus,
  similarListings,
} from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { listingPatchSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

/**
 * Ficha de un ejemplar: lo que ve quien abre un libro desde la app Android.
 *
 * La web la renderiza en el servidor; aquí se expone el mismo `ListingView`
 * junto con las sugerencias de la misma categoría o etiquetas, para no pedir
 * dos veces desde el móvil. La lectura es pública: sin sesión no hay distancia
 * ni estado de solicitud, igual que en el catálogo.
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getSessionUser();
    hit({
      bucket: "listings:detail",
      key: user?.id ?? "anon",
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    const { id } = await params;
    const listing = getListing(id, user?.id ?? null);
    if (!listing) throw new ApiError(404, "Ese ejemplar ya no está disponible.");
    return json({ listing, similar: similarListings(listing.bookId, user?.id ?? null) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    guard(request, { bucket: "listing:edit", key: user.id, limit: 60, windowMs: 24 * 60 * 60 * 1000 });

    const input = listingPatchSchema.parse(await readJson(request));
    if ("status" in input) {
      setListingStatus(user.id, id, input.status);
    } else {
      editListing(user.id, id, input);
    }
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    guard(request, { bucket: "listing:remove", key: user.id, limit: 20, windowMs: 24 * 60 * 60 * 1000 });
    removeListing(user.id, id);
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
