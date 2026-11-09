import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  /**
   * El catálogo público vive ahora en «Descubrir», dentro de la aplicación.
   * `/buecher` se anunció unos días en el sitemap, así que se redirige para
   * siempre en vez de desaparecer.
   */
  async redirects() {
    return [{ source: "/buecher", destination: "/descubrir", permanent: true }];
  },
  /**
   * Idioma en la URL: `/es/…` y `/en/…` se sirven con la misma página que la
   * ruta sin prefijo, y el proxy pone el idioma en la cabecera. El alemán es el
   * idioma por defecto y no lleva prefijo.
   *
   * El «recorte» del prefijo se declara aquí, y no como `rewrite` del proxy, a
   * propósito: un rewrite de middleware lleva la URL absoluta de destino, y
   * detrás de nginx el `Host` que llega a Node es `localhost:3000`, así que
   * Next lo tomaba por una reescritura externa y respondía 500 en producción.
   * Una reescritura del config es siempre interna: no hay host que comparar.
   */
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/es", destination: "/" },
        { source: "/es/:path*", destination: "/:path*" },
        { source: "/en", destination: "/" },
        { source: "/en/:path*", destination: "/:path*" },
      ],
    };
  },
  // El indicador flotante del desarrollo (la «N» de la esquina con bundler,
  // caché y componentes) no aporta nada aquí y confunde al mirar la interfaz.
  // Solo existe en `next dev`: en la compilación de producción no se pinta.
  devIndicators: false,
  // No revelar el framework usado en cada respuesta.
  poweredByHeader: false,
  // La compresión la hace nginx, no Node: `next start` solo comprime lo que
  // sirve él, y aquí los estáticos los sirve nginx y las respuestas dinámicas
  // pasan por su `gzip`. Comprimir en los dos sitios solo gastaba CPU.
  // ⚠ Requiere el bloque `gzip` de `deploy/nginx.conf`; sin un proxy delante,
  // `next start` serviría todo sin comprimir.
  compress: false,
  // Playwright y otras herramientas visitan 127.0.0.1 además de localhost.
  // En desarrollo también se abre la app desde el móvil o el portátil de al
  // lado (`http://192.168.0.11:3000`): Next 16 bloquea el HMR y los recursos
  // de desarrollo cuando el `Origin` no es el del arranque. Las entradas son
  // nombres de host sin esquema ni puerto y `*` cubre una etiqueta de la IP
  // que dé el DHCP. Solo afecta a `next dev`.
  allowedDevOrigins: [
    "127.0.0.1",
    // `DEV_ALLOWED_ORIGINS=a.local,b.local` añade hosts propios (túneles,
    // nombres de la red local) sin tocar el código.
    ...(process.env.DEV_ALLOWED_ORIGINS?.split(",").map((host) => host.trim()) ?? []).filter(
      Boolean,
    ),
    "192.168.*.*",
    "10.*.*.*",
  ],
  serverExternalPackages: ["better-sqlite3"],
  /**
   * La barra final se gestiona en `src/proxy.ts`, no aquí.
   *
   * Con el valor por defecto, Next responde a `/api/requests/` con un 308 de
   * vuelta a `/api/requests`, y ese 308 se emite antes del proxy. Si un proxy
   * delante (nginx) normaliza al revés, los dos se devuelven la petición el uno
   * al otro y ni el navegador ni la app pueden salir del bucle. Desactivado, la
   * ruta con barra se atiende igual y el proxy mantiene las URL de las páginas
   * sin barra, como hasta ahora.
   */
  skipTrailingSlashRedirect: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
