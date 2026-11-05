/**
 * Registro de errores de servidor.
 *
 * Siempre escribe en consola; si `ERROR_WEBHOOK_URL` está definido, envía
 * además un JSON al endpoint (Sentry, Logtail, un webhook propio…). El envío
 * no bloquea la respuesta y tiene timeout.
 */
export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  const payload = {
    level: "error",
    at: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
  };

  console.error(`[error] ${payload.message}`, context, error);

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
