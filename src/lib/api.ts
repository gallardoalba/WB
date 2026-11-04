import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { ApiError } from "./errors";
import { translate, type Locale } from "./i18n";
import { getLocale } from "./i18n-server";
import { reportError } from "./observability";

/** Tope de cuerpo para las rutas JSON: ninguno de los formularios lo necesita. */
const MAX_BODY_BYTES = 64 * 1024;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  // Las respuestas llevan datos de sesión: no se deben cachear en ningún proxy.
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

export async function readJson(request: Request): Promise<unknown> {
  // Un formulario cross-site solo puede enviar tipos "simples"; exigir JSON
  // cierra esa vía de CSRF aunque el cliente olvide la guardia de origen.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Envía el cuerpo como application/json.");
  }

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "El cuerpo de la petición es demasiado grande.");
  }

  let raw: string;
  try {
    raw = await readLimitedText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "No se pudo leer el cuerpo de la petición.");
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, "El cuerpo de la petición no es JSON válido.");
  }
}

/** Lee el cuerpo por streaming y corta en cuanto se pasa del tope. */
async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "El cuerpo de la petición es demasiado grande.");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function handleApiError(error: unknown): Promise<Response> {
  // Los errores de control de Next (prerender dinámico, redirect, notFound) deben
  // propagarse: tragárselos dejaría la ruta marcada como estática o rota.
  if (isNextControlError(error)) throw error;

  let locale: Locale = "es";
  try {
    locale = await getLocale();
  } catch {
    // Fuera de una petición (scripts/pruebas) se responde en el idioma base.
  }

  if (error instanceof ZodError) {
    return json(
      {
        error: translate(locale, "Revisa los datos del formulario."),
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      422,
    );
  }

  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
    return json(
      { error: translate(locale, error.message), details: error.details },
      error.status,
      headers,
    );
  }

  const reference = randomUUID().slice(0, 8);
  reportError(error, { reference, scope: "api" });
  return json(
    { error: translate(locale, "Ha ocurrido un error inesperado."), reference },
    500,
  );
}

function isNextControlError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  if (
    digest === "DYNAMIC_SERVER_USAGE" ||
    digest === "NEXT_REDIRECT" ||
    digest === "NEXT_NOT_FOUND"
  ) {
    return true;
  }
  if (typeof digest === "string" && /^(NEXT_|DYNAMIC_)/.test(digest)) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.startsWith("During prerendering");
}
