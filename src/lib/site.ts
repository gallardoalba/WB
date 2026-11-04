/** URL pública del sitio, con aviso si falta en producción. */
const FALLBACK = "http://localhost:3000";
let warned = false;

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const value = configured.replace(/\/+$/, "");
    // La cookie __Host- exige HTTPS: por HTTP el login fallaría en silencio.
    if (!warned && process.env.NODE_ENV === "production" && value.startsWith("http://")) {
      warned = true;
      console.warn(
        "[site] NEXT_PUBLIC_SITE_URL usa http en producción: la cookie de sesión __Host- requiere HTTPS.",
      );
    }
    return value;
  }
  if (!warned && process.env.NODE_ENV === "production") {
    warned = true;
    console.warn(
      `[site] NEXT_PUBLIC_SITE_URL no está definida: sitemap, robots y canonical publicarán ${FALLBACK}.`,
    );
  }
  return FALLBACK;
}
