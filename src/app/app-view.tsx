import { after } from "next/server";
import { redirect } from "next/navigation";
import WanderbibliothekApp from "@/components/wanderbibliothek-app";
import { getSessionUser } from "@/lib/auth";
import { VIEWS, type View } from "@/lib/domain";
import { publicActivity, publicStats } from "@/lib/public-data";
import { expireStaleRequestsThrottled, getSnapshot } from "@/lib/repo";
import { catalogParamsSchema } from "@/lib/validation";

/**
 * Renderiza el shell de la aplicación para una vista concreta.
 *
 * Cada vista tiene su propia ruta (`/`, `/descubrir`, `/estanteria`,
 * `/intercambios`, `/comunidad`), pero comparte este renderizador: así los
 * enlaces son compartibles y cada ruta puede cachearse por separado más
 * adelante. `/?view=x` sigue funcionando para no romper enlaces antiguos.
 */

/** Vistas que se pueden ver sin sesión. */
// Solo la portada es pública. El catálogo (nombre y ciudad de cada lector
// junto a sus libros) exige sesión: era accesible sin cuenta y, aunque
// robots.txt ya evita indexarlo, cualquiera podía recorrerlo entero.
const PUBLIC_VIEWS: readonly View[] = ["home"];

type RawParams = Record<string, string | string[] | undefined>;

const isView = (value: unknown): value is View =>
  typeof value === "string" && (VIEWS as readonly string[]).includes(value);

export async function renderAppView(routeView: View, raw: RawParams, path: string) {
  // La ruta manda; en la portada se acepta `?view=x` por compatibilidad.
  const view: View = routeView === "home" && isView(raw.view) ? raw.view : routeView;

  const parsed = catalogParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : catalogParamsSchema.parse({});
  // El parámetro de la URL no puede cambiar la vista de la ruta.
  params.view = view;

  const user = await getSessionUser();
  if (!user && !PUBLIC_VIEWS.includes(view)) {
    const target = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && !["auth", "offer", "profile", "notifications", "next", "view"].includes(key)) {
        target.set(key, value);
      }
    }
    const query = target.toString();
    redirect(`/?auth=1&next=${encodeURIComponent(`${path}${query ? `?${query}` : ""}`)}`);
  }

  // `?profile=1` era la forma antigua de abrir los ajustes en un diálogo:
  // ahora la cuenta tiene página propia, así que los enlaces viejos se mueven.
  if (raw.profile === "1") redirect("/cuenta");
  // Igual con «ofrecer un libro»: era una ventana sobre la portada y ahora es
  // una página, así que los enlaces con `?offer=1` se redirigen a ella.
  if (raw.offer === "1") redirect("/ofrecer");

  const [stats, activity] = await Promise.all([publicStats(), publicActivity()]);
  const snapshot = getSnapshot(user, params, { stats, activity });

  // En desarrollo `after()` dispara un diagnóstico de Next; la caducidad queda
  // cubierta por el cron y las pruebas.
  if (user && process.env.NODE_ENV === "production") {
    after(async () => {
      try {
        expireStaleRequestsThrottled();
      } catch (error) {
        console.error("[repo] no se pudieron expirar solicitudes", error);
      }
    });
  }

  const rawNext = Array.isArray(raw.next) ? raw.next[0] : raw.next;
  const nextPath =
    typeof rawNext === "string" &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.startsWith("/\\")
      ? rawNext
      : null;

  return (
    <WanderbibliothekApp
      snapshot={snapshot}
      openAuth={raw.auth === "1"}
      openNotifications={raw.notifications === "1"}
      nextPath={nextPath}
    />
  );
}

export type AppViewPageProps = {
  searchParams: Promise<RawParams>;
};
