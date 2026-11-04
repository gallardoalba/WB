import { redirect } from "next/navigation";
import { getSessionUser } from "./auth";

/**
 * Sin sesión solo se puede ver la portada. Las páginas internas (clubes,
 * listas, lectores, obra, ficha y perfiles) redirigen al acceso.
 */
export async function requirePageUser(nextPath?: string) {
  const user = await getSessionUser();
  if (!user) {
    const target = nextPath ? `/?auth=1&next=${encodeURIComponent(nextPath)}` : "/?auth=1";
    redirect(target);
  }
  return user;
}
