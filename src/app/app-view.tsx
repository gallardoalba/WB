import { after } from "next/server";
import { redirect } from "next/navigation";
import { preload } from "react-dom";
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
// La portada y el catálogo (Bücher entdecken) son públicos: enseñan obras y
// ejemplares, y quien no tiene cuenta puede ojear qué hay antes de registrarse.
// El resto (estantería, intercambios, comunidad) sigue pidiendo sesión.
const PUBLIC_VIEWS: readonly View[] = ["home", "discover"];

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
  // La portada no ordena por cercanía ni por fecha: enseña una muestra del
  // catálogo (ver `shuffleOrder`). `shuffle` viaja aparte de la URL para que el
  // scroll infinito del catálogo siga trayendo páginas coherentes.
  //
  // La portada pide **seis** tarjetas y no quince: `.home-grid` deja ver entre
  // tres y seis según el ancho, así que el resto se pintaba en el servidor y se
  // ocultaba con `:nth-child` — unos 440 nodos del DOM que nadie llegaba a ver.
  const snapshot = getSnapshot(
    user,
    { ...params, shuffle: view === "home", pageSize: view === "home" ? 6 : params.pageSize },
    { stats, activity },
  );

  // La portada del primer ejemplar es el LCP de la portada y del catálogo (lo
  // señala el propio Next al medir). Declararla aquí hace que el navegador la
  // empiece a descargar mientras llega el HTML de las tarjetas, en vez de
  // esperar a que el componente que la pinta se hidrate. Solo la primera: con
  // quince, la precarga competiría consigo misma.
  const primeraPortada = snapshot.listings[0]?.coverUrl;
  if (primeraPortada) {
    preload(primeraPortada, { as: "image", fetchPriority: "high" });
  }

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
