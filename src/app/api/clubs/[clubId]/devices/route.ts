import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { getClub, listClubDevices, moderatesClub } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Dispositivos de los miembros del club: a quién hay que cifrar un mensaje.
 *
 * Solo lo ve **quien está dentro**. No es un directorio abierto: la lista lleva
 * el nombre de cada miembro con sus aparatos, así que sirve para enumerar el
 * club entero.
 */
export const GET = route<undefined, "user", { clubId: string }>(
  {},
  ({ params, user }) => {
    const club = getClub(params.clubId, user.id);
    if (!club) throw new ApiError(404, "El club no existe.");
    if (!club.isMember && !moderatesClub(params.clubId, user.id)) {
      throw new ApiError(403, "Solo quien está en el club ve sus dispositivos.");
    }
    return json({ devices: listClubDevices(params.clubId) });
  },
);
