import { connection } from "next/server";
import { headers } from "next/headers";
import { hit } from "./throttle";

/**
 * Límite de ritmo para páginas públicas con datos de muchas personas
 * (directorio y clubs). Se aplica por IP y **no** rompe la página: si se
 * supera, quien llama decide qué mostrar.
 */
export async function allowPageView(limit: number, windowMs: number): Promise<boolean> {
  // Estas páginas se prerenderizan, pero contar visitas solo tiene sentido con
  // una petición real delante.
  await connection();

  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  const trust = process.env.TRUST_PROXY === "1";
  const key = trust && forwarded ? (forwarded.split(",")[0] ?? "direct").trim() : "direct";

  try {
    hit({ bucket: "page:view", key, limit, windowMs });
    return true;
  } catch {
    return false;
  }
}
