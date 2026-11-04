import { getDb } from "./db";
import { ApiError } from "./errors";

if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY !== "1") {
  console.warn(
    "[throttle] TRUST_PROXY no está activo: las cuotas por IP se desactivan y solo quedan las globales y por cuenta. Actívalo si hay un proxy o CDN delante.",
  );
}

export type Quota = { bucket: string; key: string; limit: number; windowMs: number };

let cleanupTicks = 0;

/** True cuando el despliegue declara un proxy propio y la IP es fiable. */
export function hasClientIp(): boolean {
  return process.env.TRUST_PROXY === "1";
}

/**
 * Registra un intento y lanza 429 si se supera el límite.
 * La ventana es deslizante sobre la tabla `throttle`.
 *
 * El reloj lo pone SQLite a propósito: así la función se puede llamar durante
 * el render de una página sin que Next lo tome por una lectura inestable
 * (`Date.now()` durante el prerender es un error de construcción).
 */
export function hit(quota: Quota): void {
  const { bucket, key, limit, windowMs } = quota;
  const db = getDb();
  const windowModifier = `-${windowMs / 1000} seconds`;

  // Contar e insertar en la misma transacción cierra la ventana de carrera de
  // dos peticiones simultáneas que leían el mismo contador.
  db.transaction(() => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count,
                MIN(created_at) AS oldest,
                strftime('%Y-%m-%dT%H:%M:%fZ','now') AS clock
         FROM throttle
         WHERE bucket = ? AND throttle_key = ?
           AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
      )
      .get(bucket, key, windowModifier) as {
      count: number;
      oldest: string | null;
      clock: string;
    };

    if (row.count >= limit) {
      const now = Date.parse(row.clock);
      const oldest = row.oldest ? Date.parse(row.oldest) : now;
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      throw new ApiError(429, "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.", {
        retryAfter,
      });
    }

    db.prepare(
      `INSERT INTO throttle (bucket, throttle_key, created_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ).run(bucket, key);

    // Limpieza oportunista: se hace una de cada 32 inserciones para no convertir
    // el limitador en un punto de escritura en cada petición.
    cleanupTicks += 1;
    if (cleanupTicks % 32 === 0) {
      db.prepare(
        `DELETE FROM throttle WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`,
      ).run();
    }
  })();
}

/**
 * IP del cliente. Solo se confía en `X-Forwarded-For` cuando el despliegue
 * declara `TRUST_PROXY=1` (hay un proxy propio delante); en caso contrario
 * todas las peticiones comparten la clave "direct", que falla del lado seguro.
 */
export function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  }
  return "direct";
}

/** Rechaza mutaciones cuyo Origin no coincide con el Host atendido. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // Los navegadores modernos envían `Sec-Fetch-Site` en las peticiones que
  // llevan cookies: si falta el Origin pero hablamos con un navegador, se exige
  // que sea del mismo origen. Sin ninguno de los dos, es un cliente externo
  // (curl, pruebas) que no puede sufrir CSRF porque no arrastra cookies ajenas.
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "Origen no permitido.");
  }
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Origen no permitido.");
  }
  // Detrás de un proxy que reescribe `Host` (nginx con `proxy_set_header Host
  // $proxy_host`, un ALB…) el host público solo llega en `X-Forwarded-Host`.
  // Se acepta únicamente cuando el despliegue declara que hay proxy propio.
  const allowed = new Set<string>();
  const host = request.headers.get("host");
  if (host) allowed.add(host);
  if (hasClientIp()) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (forwardedHost) allowed.add(forwardedHost);
  }
  if (!allowed.has(originHost)) {
    throw new ApiError(403, "Origen no permitido.");
  }
}

/** Aplica origen + cuota a una mutación. */
export function guard(request: Request, quota: Quota): void {
  assertSameOrigin(request);
  hit(quota);
}
