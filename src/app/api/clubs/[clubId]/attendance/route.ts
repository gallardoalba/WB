import { json, readJson } from "@/lib/api";
import { setClubAttendance } from "@/lib/repo";
import { clubAttendanceSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Confirmar o retirar la asistencia al encuentro que muestra el club. */
export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:attendance", limit: 200, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const { attending } = clubAttendanceSchema.parse(await readJson(request));
    return json(setClubAttendance(user.id, clubId, attending));
  },
);
