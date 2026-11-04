import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setClubAttendance } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubAttendanceSchema } from "@/lib/validation";

/** Confirmar o retirar la asistencia al encuentro que muestra el club. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:attendance",
      key: user.id,
      limit: 200,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const { attending } = clubAttendanceSchema.parse(await readJson(request));
    return json(setClubAttendance(user.id, clubId, attending));
  } catch (error) {
    return handleApiError(error);
  }
}
