import { json } from "@/lib/api";
import { keyInclusion, verifyKeySnapshotSignature, latestKeySnapshot } from "@/lib/transparency";
import { route } from "@/lib/route";

/**
 * Prueba de que la clave publicada de esta cuenta está en la última
 * instantánea firmada del directorio.
 *
 * Solo la pide su titular: el directorio no se publica entero porque revelaría
 * cuántas cuentas hay y cuándo cambió cada clave. Con la rama de Merkle y la
 * raíz firmada, la persona puede comprobar por su cuenta que lo que el servidor
 * le enseña es lo que quedó comprometido.
 */
export const GET = route(
  {},
  ({ user }) => {
    const proof = keyInclusion(user.id);
    if (!proof) {
      const snapshot = latestKeySnapshot();
      return json(
        {
          proof: null,
          reason: snapshot
            ? "Esta cuenta todavía no tiene clave publicada en la última instantánea."
            : "Todavía no hay ninguna instantánea del directorio de claves.",
        },
        404,
      );
    }
    const snapshot = latestKeySnapshot();
    return json(
      {
        ...proof,
        verified: snapshot ? verifyKeySnapshotSignature(snapshot) : false,
      },
      200,
      { "cache-control": "no-store" },
    );
  },
);
