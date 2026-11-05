import { createHash } from "node:crypto";
import { connection } from "next/server";
import { headers } from "next/headers";
import { clientKeyFrom, hit } from "./throttle";

/**
 * Límite de ritmo para páginas con datos de muchas personas (directorio, clubs
 * y listas). No rompe la página: si se supera, quien llama decide qué mostrar.
 *
 * La clave es la IP cuando hay proxy de confianza y, si no, la cuenta que está
 * mirando (estas páginas exigen sesión). Así un solo cliente no consume la
 * cuota de todo el sitio, que es lo que pasaba con la clave global "direct".
 */
export async function allowPageView(
  limit: number,
  windowMs: number,
  viewerId?: string | null,
): Promise<boolean> {
  // Estas páginas se prerenderizan, pero contar visitas solo tiene sentido con
  // una petición real delante.
  await connection();

  const store = await headers();
  // Pseudónimo, no la IP: la tabla `throttle` no debe guardar direcciones.
  const ip = clientKeyFrom((name) => store.get(name));
  const key =
    ip !== "direct"
      ? `ip:${ip}`
      : viewerId
        ? `user:${createHash("sha256").update(viewerId).digest("hex").slice(0, 16)}`
        : "direct";

  try {
    hit({ bucket: "page:view", key, limit, windowMs });
    return true;
  } catch {
    return false;
  }
}
