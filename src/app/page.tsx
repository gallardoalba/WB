import { after } from "next/server";
import { redirect } from "next/navigation";
import Book2PeerApp from "@/components/book2peer-app";
import { getSessionUser } from "@/lib/auth";
import { publicActivity, publicStats } from "@/lib/public-data";
import { expireStaleRequestsThrottled, getSnapshot } from "@/lib/repo";
import { catalogParamsSchema, type CatalogParams } from "@/lib/validation";

// Depende de la sesión y de los filtros: se renderiza en el servidor por petición.
export const instant = false;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const parsed = catalogParamsSchema.safeParse(raw);
  const params: CatalogParams = parsed.success ? parsed.data : catalogParamsSchema.parse({});
  const user = await getSessionUser();
  // Sin sesión solo se puede mirar la portada y el catálogo: estantería,
  // intercambios y comunidad redirigen al acceso sin perder el destino.
  if (!user && params.view !== "home" && params.view !== "discover") {
    const target = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && key !== "auth" && key !== "next") {
        target.set(key, value);
      }
    }
    const query = target.toString();
    redirect(`/?auth=1&next=${encodeURIComponent(query ? `/?${query}` : "/")}`);
  }
  const [stats, activity] = await Promise.all([publicStats(), publicActivity()]);
  const snapshot = getSnapshot(user, params, { stats, activity });

  // En desarrollo, `after()` dispara un diagnóstico de Next («Date.now while
  // prerendering») que no afecta a la página; la caducidad se cubre con el cron
  // y con las pruebas. En producción sí se ejecuta tras la respuesta.
  if (user && process.env.NODE_ENV === "production") {
    // La caducidad de solicitudes se resuelve después de responder: el render
    // no debe pagar escrituras ni notificaciones.
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
    <Book2PeerApp
      snapshot={snapshot}
      openAuth={raw.auth === "1"}
      openProfile={raw.profile === "1"}
      openNotifications={raw.notifications === "1"}
      initialOfferOpen={raw.offer === "1"}
      nextPath={nextPath}
    />
  );
}
