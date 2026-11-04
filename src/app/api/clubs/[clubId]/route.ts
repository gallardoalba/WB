import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteClub, updateClub } from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { guard } from "@/lib/throttle";
import { clubUpdateSchema } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ clubId: string }> }) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "club:edit", key: user.id, limit: 120, windowMs: 60 * 60 * 1000 });
    const { clubId } = await params;
    const input = clubUpdateSchema.parse(await readJson(request));
    updateClub(user.id, clubId, {
      name: input.name,
      description: input.description,
      meetsOn: input.meetsOn,
      meetsAt: input.meetsAt,
      bookId: input.bookId ?? null,
      joinPolicy: input.joinPolicy,
      progress: input.progress,
      progressNote: input.progressNote,
    });
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "club:delete", key: user.id, limit: 30, windowMs: 24 * 60 * 60 * 1000 });
    const { clubId } = await params;
    deleteClub(user.id, clubId);
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
