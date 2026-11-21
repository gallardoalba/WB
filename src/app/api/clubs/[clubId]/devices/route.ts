import { json } from "@/lib/api";
import { listClubDevices } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Dispositivos de los miembros del club: a quién hay que cifrar un mensaje.
 *
 * Solo lo ve quien está dentro. Es lo que necesita el cliente para repartir un
 * sobre por dispositivo; el servidor no puede hacerlo él porque no tiene las
 * claves de nadie.
 */
export const GET = route<undefined, "user", { clubId: string }>(
  {},
  ({ params }) => json({ devices: listClubDevices(params.clubId) }),
);
