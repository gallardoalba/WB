import { invalidatePublicData } from "@/lib/revalidate";
import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import {
  editListing,
  getListing,
  removeListing,
  setListingStatus,
  similarListings,
} from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { listingPatchSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Ficha de un ejemplar: lo que ve quien abre un libro desde la app Android.
 *
 * La web la renderiza en el servidor; aquí se expone el mismo `ListingView`
 * junto con las sugerencias de la misma categoría o etiquetas, para no pedir
 * dos veces desde el móvil. La lectura es pública: sin sesión no hay distancia
 * ni estado de solicitud, igual que en el catálogo.
 */
export const GET = route<undefined, "optional", { id: string }>(
  { auth: "optional" },
  ({ params, user }) => {
    hit({
      bucket: "listings:detail",
      key: user?.id ?? "anon",
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    const { id } = params;
    const listing = getListing(id, user?.id ?? null);
    if (!listing) throw new ApiError(404, "Ese ejemplar ya no está disponible.");
    return json({ listing, similar: similarListings(listing.bookId, user?.id ?? null) });
  },
);

export const PATCH = route<undefined, "user", { id: string }>(
  { limit: { bucket: "listing:edit", limit: 60, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { id } = params;

    const input = listingPatchSchema.parse(await readJson(request));
    if ("status" in input) {
      setListingStatus(user.id, id, input.status);
    } else {
      editListing(user.id, id, input);
    }
    invalidatePublicData();
    return json({ ok: true });
  },
);

export const DELETE = route<undefined, "user", { id: string }>(
  { limit: { bucket: "listing:remove", limit: 20, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {
    const { id } = params;

    removeListing(user.id, id);
    invalidatePublicData();
    return json({ ok: true });
  },
);
