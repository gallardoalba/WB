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
