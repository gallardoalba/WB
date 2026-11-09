import { createHmac } from "node:crypto";
import { getDb } from "./db";
import { ApiError } from "./errors";

if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY !== "1") {
  console.warn(
    "[throttle] TRUST_PROXY no está activo: las cuotas por IP se desactivan y solo quedan las globales y por cuenta. Actívalo si hay un proxy o CDN delante.",
  );
}

export type Quota = { bucket: string; key: string; limit: number; windowMs: number };

/** Hasta cinco minutos de espera, «un momento» es la verdad. */
const SHORT_WAIT_SECONDS = 300;
const SHORT_WAIT_MESSAGE = "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.";
/**
 * Cuotas largas: quien publica su décimo libro del día no espera un momento,
 * espera horas. Prometer lo contrario hace que la persona reintente en bucle y
 * crea que la aplicación está rota. El `{marcador}` lo rellena `waitMessage()`.
 */
const WAIT_MINUTES_MESSAGE =
  "Has llegado al límite de esta acción. Podrás volver a intentarlo dentro de {minutos} min.";
const WAIT_HOURS_MESSAGE =
  "Has llegado al límite de esta acción. Podrás volver a intentarlo dentro de {horas} h.";

/** Mensaje del 429 y valores para el marcador, según lo que falte para el hueco. */
function waitMessage(retryAfter: number): { message: string; vars?: Record<string, number> } {
  if (retryAfter <= SHORT_WAIT_SECONDS) return { message: SHORT_WAIT_MESSAGE };
  if (retryAfter < 3600) {
    return { message: WAIT_MINUTES_MESSAGE, vars: { minutos: Math.ceil(retryAfter / 60) } };
  }
  return { message: WAIT_HOURS_MESSAGE, vars: { horas: Math.ceil(retryAfter / 3600) } };
}

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
      const { message, vars } = waitMessage(retryAfter);
      throw new ApiError(429, message, {
        retryAfter,
        details: { retryAfterSeconds: retryAfter },
        vars,
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
 * IP del cliente a partir de las cabeceras de la petición.
 *
 * Solo se confía en `X-Forwarded-For` cuando el despliegue declara
 * `TRUST_PROXY=1` (hay un proxy propio delante); en caso contrario todas las
 * peticiones comparten la clave "direct", que falla del lado seguro.
 *
 * De la lista se toma la entrada que añadió el proxy más cercano (la última),
 * no la primera: el cliente puede escribir las de la izquierda. Con varios
 * proxies encadenados, define `TRUSTED_PROXY_HOPS`.
 */
export function clientIpFrom(get: (name: string) => string | null): string {
  if (process.env.TRUST_PROXY !== "1") return "direct";
  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      const index = hops.length - trustedProxyHops();
      return hops[index >= 0 ? index : 0]!;
    }
  }
  const realIp = get("x-real-ip");
  return realIp?.trim() || "direct";
}

/** Saltos de confianza declarados por el operador (por defecto, uno). */
function trustedProxyHops(): number {
  const parsed = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 10);
}

export function clientIp(request: Request): string {
  return clientIpFrom((name) => request.headers.get(name));
}

let cachedSalt = { day: "", key: "" };

/**
 * Clave del limitador, que va a la base de datos: no es la IP, es un pseudónimo
 * con sal que cambia cada día.
 *
 * Una IP es un dato personal y el limitador no necesita la dirección, solo
 * distinguir clientes. La sal se deriva (`APP_ENCRYPTION_KEY` o, en desarrollo,
 * un valor fijo) y del día: sin la clave no se puede volver a la IP, y la misma
 * dirección deja de ser reconocible al día siguiente.
 */
export function pseudonymizeIp(ip: string): string {
  if (ip === "direct") return "direct";
  const day = new Date().toISOString().slice(0, 10);
  if (cachedSalt.day !== day) {
    const secret = process.env.APP_ENCRYPTION_KEY?.trim() || "desarrollo-wanderbibliothek";
    cachedSalt = {
      day,
      key: createHmac("sha256", secret).update(`throttle:${day}`).digest("hex"),
    };
  }
  return createHmac("sha256", cachedSalt.key).update(ip).digest("hex").slice(0, 32);
}

/** Igual que `clientIpFrom`, pero devolviendo el pseudónimo que se guarda. */
export function clientKeyFrom(get: (name: string) => string | null): string {
  return pseudonymizeIp(clientIpFrom(get));
}

/** Clave del limitador para esta petición (nunca la IP en claro). */
export function clientKey(request: Request): string {
  return clientKeyFrom((name) => request.headers.get(name));
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
  // Al construir una `Request` a mano (pruebas, llamadas internas) no hay
  // cabecera `Host`: el host al que se dirige la petición es el de su URL, y es
  // el mismo que compararía el navegador.
  try {
    allowed.add(new URL(request.url).host);
  } catch {
    // Una URL ilegible no aporta host; se sigue con lo que haya.
  }
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

/**
 * ¿Esta cuenta publica sin tope?
 *
 * La administración queda fuera de las cuotas de publicación: catalogar un fondo
 * entero de una sentada es trabajo normal del servicio, y el freno existe contra
 * el abuso de una cuenta cualquiera, no contra quien lo mantiene. Lo que se salta
 * es el recuento, no la guardia de mismo origen (el CSRF se sigue exigiendo).
 */
export function publicaSinTope(user: { isAdmin: boolean } | null | undefined): boolean {
  return Boolean(user?.isAdmin);
}
