import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { editListing, removeListing, setListingStatus } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { listingPatchSchema } from "@/lib/validation";

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
