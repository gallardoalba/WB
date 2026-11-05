export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

/** Error de API con el estado y el cuerpo originales (p. ej. `twoFactorRequired`). */
export class ClientApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.body = body;
  }

  /** Errores por campo que devuelve la validación del servidor (422). */
  get issues(): { path?: string; message: string }[] {
    const payload = this.body;
    if (!payload || typeof payload !== "object" || !("issues" in payload)) return [];
    const issues = (payload as { issues?: unknown }).issues;
    if (!Array.isArray(issues)) return [];
    return issues.filter(
      (issue): issue is { path?: string; message: string } =>
        Boolean(issue) &&
        typeof issue === "object" &&
        typeof (issue as { message?: unknown }).message === "string",
    );
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // Sin red, `fetch` lanza: sin esto el usuario veía «Failed to fetch».
    throw new ClientApiError(
      "No hay conexión con el servidor. Comprueba tu red e inténtalo de nuevo.",
      0,
      null,
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload : null;
    // La validación del servidor acompaña al mensaje genérico con la lista de
    // campos; mostrar «Revisa los datos del formulario» sin decir cuál es no
    // sirve de nada. Se enseña el primer problema concreto.
    const firstIssue = Array.isArray((body as { issues?: unknown })?.issues)
      ? ((body as { issues: { message?: unknown }[] }).issues ?? []).find(
          (issue) => issue && typeof issue.message === "string",
        )?.message
      : undefined;
    const generic = body && "error" in body ? String(body.error) : "";
    const message =
      (typeof firstIssue === "string" && firstIssue) ||
      generic ||
      (response.status === 429
        ? "Demasiadas peticiones. Espera un momento e inténtalo de nuevo."
        : "No se pudo completar la acción.");

    // La sesión caducó a mitad de uso: el shell reabre el acceso con esta
    // página como destino, en vez de dejar al usuario ante un error sin salida.
    // Los endpoints de acceso quedan fuera para no reabrirse por una
    // contraseña incorrecta.
    if (response.status === 401 && !path.startsWith("/api/auth/")) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("wb:auth-required"));
      }
    }

    throw new ClientApiError(message, response.status, payload);
  }

  return payload as T;
}
