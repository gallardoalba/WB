import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import {
  deleteClub,
  getActiveClubPoll,
  getClub,
  listClubMembers,
  listClubPosts,
  listClubRequests,
  updateClub,
} from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { guard, hit } from "@/lib/throttle";
import { clubUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ clubId: string }> };

/**
 * Ficha completa de un club en una sola respuesta: es lo que necesita la app
 * Android para pintar la pantalla sin cuatro viajes de ida y vuelta. El foro y
 * la votación solo se incluyen para quien es miembro (la API no debe filtrar
 * conversaciones a quien ya no pertenece al club).
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    hit({ bucket: "clubs:detail", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { clubId } = await params;
    const club = getClub(clubId, user.id);
    if (!club) throw new ApiError(404, "Ese club ya no está disponible.");
    const posts = club.isMember
      ? listClubPosts(club.id, { id: user.id, isAdmin: user.isAdmin })
      : null;
    // La lista de miembros no sale del club: la página ya la ocultaba y la API
    // tampoco debe entregarla a quien no pertenece a él.
    const canSeeMembers = club.isMember || club.isMine || club.isModerator;
    return json({
      club,
      members: canSeeMembers
        ? listClubMembers(club.id, { page: 1, pageSize: 24, viewerId: user.id })
        : { members: [], total: 0, hasMore: false },
      posts,
      poll: club.isMember ? getActiveClubPoll(club.id, user.id) : null,
      requests:
        club.isMine || club.isModerator ? listClubRequests(club.id, user.id) : [],
    });
  } catch (error) {
    return handleApiError(error);
  }
}

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
      meetsPlace: input.meetsPlace,
      meetsLink: input.meetsLink,
      bookId: input.bookId,
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
