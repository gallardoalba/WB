import { timingSafeEqual } from "node:crypto";

/**
 * Autorización de operación: la sesión de administración o el token del cron.
 *
 * El vigilante y un recolector de métricas corren **en el mismo host** y no
 * tienen cookie de sesión: lo único que pueden presentar es el
 * `MAINTENANCE_TOKEN` que ya está en `/etc/wanderbibliothek/env`. Aceptarlo en
 * las rutas de lectura de operación evita inventar un segundo secreto y deja el
 * acceso limitado a quien ya puede lanzar el mantenimiento.
 */

/** Comparación en tiempo constante: una comparación con `===` filtra el prefijo. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** La cabecera `Authorization: Bearer <MAINTENANCE_TOKEN>` de una petición. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * True si la petición trae el token de operación.
 *
 * Sin `MAINTENANCE_TOKEN` configurado no hay nada que aceptar: el token no
 * existe, y una cabecera `Bearer ` vacía no puede valer como tal.
 */
export function hasOpsToken(request: Request): boolean {
  const token = process.env.MAINTENANCE_TOKEN;
  if (!token) return false;
  return safeEqual(bearerToken(request), token);
}
