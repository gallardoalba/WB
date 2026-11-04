/**
 * Arranque del servidor: se comprueba el entorno antes de servir la primera
 * petición. En desarrollo no hace nada.
 *
 * Next ejecuta `register()` una vez por proceso; durante `next build` también
 * puede invocarse para prerenderizar, y ahí no tiene sentido exigir TLS ni
 * proveedor de correo (el build no necesita ninguno de los dos).
 */
export async function register() {
  // Solo el servidor de Node: los runtime de borde no comparten este entorno.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE?.startsWith("phase-production-build")) return;
  if (process.env.NODE_ENV !== "production") return;

  const { assertEnv } = await import("./lib/env-check");
  assertEnv();
}
