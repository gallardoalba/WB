/** Longitud máxima de un texto que sale de aquí (mensaje, traza, contexto). */
const MAX_TEXTO = 300;
/** Una traza de pila recortada sigue sirviendo; entera puede llevar rutas y datos. */
const MAX_TRAZA = 2_000;
/** Tope de claves por objeto del contexto, para que un volcado no se lleve la memoria. */
const MAX_CLAVES = 20;

/** Claves cuyo valor nunca sale del proceso. */
const CLAVE_SENSIBLE =
  /token|password|contrase[ñn]a|secret|clave|authorization|cookie|code|c[oó]digo|e-?mail|correo/i;

/**
 * Recorta y enmascara un texto antes de mandarlo fuera.
 *
 * El webhook es un tercero y la consola del servidor acaba en un fichero que se
 * rota, así que ni uno ni otro deben recibir «el correo x@y falló», un Bearer ni
 * el token de un enlace de reseteo. Se conserva lo que permite diagnosticar
 * (el dominio del correo y algo de contexto) y se tapa el resto.
 */
export function redactarTexto(valor: string, max = MAX_TEXTO): string {
  const sinCorreo = valor.replace(
    /([\w.+-])[\w.+-]*@([\w-]+(?:\.[\w-]+)+)/g,
    "$1***@$2",
  );
  const sinToken = sinCorreo
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [oculto]")
    .replace(/\b[a-f0-9]{24,}\b/gi, "[token]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]");
  return sinToken.length > max ? `${sinToken.slice(0, max)}…` : sinToken;
}

/** Aplica `redactarTexto` a un valor de contexto, con profundidad y tamaño acotados. */
export function redactarContexto(valor: unknown, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return redactarTexto(valor);
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (valor instanceof Error) return redactarTexto(valor.message);
  if (profundidad >= 2) return "[…]";
  if (Array.isArray(valor)) {
    return valor.slice(0, MAX_CLAVES).map((item) => redactarContexto(item, profundidad + 1));
  }
  if (typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [clave, item] of Object.entries(valor as Record<string, unknown>).slice(
      0,
      MAX_CLAVES,
    )) {
      salida[clave] = CLAVE_SENSIBLE.test(clave) ? "[oculto]" : redactarContexto(item, profundidad + 1);
    }
    return salida;
  }
  return "[…]";
}

/**
 * Registro de errores de servidor.
 *
 * Siempre escribe en consola; si `ERROR_WEBHOOK_URL` está definido, envía
 * además un JSON al endpoint (Sentry, Logtail, un webhook propio…). El envío
 * no bloquea la respuesta y tiene timeout.
 *
 * Mensaje, traza y contexto pasan por `redactarTexto`/`redactarContexto`: un
 * webhook de errores no debe recibir correos, tokens ni el cuerpo de una
 * petición.
 */
export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  const contexto = (redactarContexto(context) ?? {}) as Record<string, unknown>;
  const payload = {
    level: "error",
    at: new Date().toISOString(),
    message: redactarTexto(error instanceof Error ? error.message : String(error)),
    stack: error instanceof Error && error.stack
      ? redactarTexto(error.stack, MAX_TRAZA)
      : undefined,
    context: contexto,
  };

  console.error(`[error] ${payload.message}`, contexto, error);

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ERROR_WEBHOOK_TOKEN) {
    headers.authorization = `Bearer ${process.env.ERROR_WEBHOOK_TOKEN}`;
  }

  void fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3_000),
  }).catch((failure: unknown) => {
    console.warn("[error] no se pudo enviar el error al webhook", failure);
  });
}

/* ---------------------------------------------------------------------------
 * Identificador de petición y latencia
 *
 * Sin un id por petición, el 500 que ve una persona y la traza del registro son
 * dos historias que no se pueden unir. El id viaja en la cabecera
 * `x-request-id` (se respeta el que mande el proxy de delante), se devuelve en
 * la respuesta y es el mismo que aparece en el cuerpo del error y en la línea
 * de registro de la petición.
 * ------------------------------------------------------------------------- */

export const REQUEST_ID_HEADER = "x-request-id";
/** A partir de aquí una petición se marca como lenta en el registro. */
export const SLOW_REQUEST_MS = 500;

/** Un id de fuera solo se acepta si es corto y sin caracteres raros. */
export function sanitizeRequestId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._-]{8,64}$/.test(trimmed) ? trimmed : null;
}

/** El id de la petición: el del proxy si es válido, uno nuevo si no. */
export function requestIdFrom(headers: { get(name: string): string | null }): string {
  return sanitizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();
}

export type RequestLog = {
  id: string;
  method: string;
  path: string;
  status: number;
  ms: number;
};

/**
 * Una línea por petición de API, en JSON y con el mismo id que la respuesta.
 * Es lo que permite calcular el p95 por ruta con `jq` sobre journald.
 */
export function recordRequest(entry: RequestLog): void {
  const slow = entry.ms >= SLOW_REQUEST_MS;
  const line = JSON.stringify({
    level: slow ? "warn" : "info",
    at: new Date().toISOString(),
    id: entry.id,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    ms: Math.round(entry.ms * 10) / 10,
    ...(slow ? { slow: true } : {}),
  });
  if (slow) console.warn(`[req] ${line}`);
  else console.log(`[req] ${line}`);
}
