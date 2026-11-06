import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // El indicador flotante del desarrollo (la «N» de la esquina con bundler,
  // caché y componentes) no aporta nada aquí y confunde al mirar la interfaz.
  // Solo existe en `next dev`: en la compilación de producción no se pinta.
  devIndicators: false,
  // No revelar el framework usado en cada respuesta.
  poweredByHeader: false,
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
