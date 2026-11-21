import { json } from "@/lib/api";
import { listDevices } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Dispositivos públicos de una cuenta.
 *
 * Hace falta sesión para verlos: la lista no es un directorio abierto. Devuelve
 * identidad y firma de cada dispositivo, nunca claves de un solo uso —esas se
 * reclaman de una en una en la ruta de `claim`— ni nada privado.
 */
export const GET = route<undefined, "user", { userId: string }>(
  {},
  ({ params }) => json({ devices: listDevices(params.userId) }),
);
