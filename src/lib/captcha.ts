import { ApiError } from "./errors";

export type HumanCheck = {
  token?: string | null;
  honeypot?: string | null;
  startedAt?: number | null;
  ip?: string | null;
};

const MIN_FILL_MS = 1_200;
const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Dominio de este despliegue, para no dar por bueno un token emitido para otro
 * sitio que compartiera el mismo secreto.
 */
function siteHost(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

if (process.env.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET) {
  console.warn(
    "[captcha] TURNSTILE_SECRET no está configurado: el registro solo tiene honeypot y tiempo mínimo.",
  );
}

/**
 * Prueba de humanidad del registro.
 *
 * Con `TURNSTILE_SECRET` configurado se valida el token de Cloudflare Turnstile.
 * Sin proveedor se exige que el formulario no sea instantáneo (≥1,2 s) y que el
 * campo trampa (`website`) esté vacío. Es una barrera básica: activa Turnstile
 * en producción para protección real.
 */
export async function assertHuman(input: HumanCheck): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET;

  if (secret) {
    if (!input.token) throw new ApiError(400, "Completa la verificación humana.");
    const body = new URLSearchParams({ secret, response: input.token });
    if (input.ip && input.ip !== "direct") body.set("remoteip", input.ip);

    let success = false;
    try {
      const response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body,
          signal: AbortSignal.timeout(5_000),
        },
      );
      const data = (await response.json()) as { success?: boolean; hostname?: unknown };
      success = Boolean(data.success);
      // `siteverify` dice para qué host se emitió el token: si no es el nuestro,
      // no vale aunque el secreto coincida.
      const esperado = siteHost();
      const emitidoPara = typeof data.hostname === "string" ? data.hostname : "";
      if (success && esperado && emitidoPara && emitidoPara !== esperado) success = false;
    } catch (error) {
      console.error("[captcha] no se pudo verificar Turnstile", error);
      throw new ApiError(503, "No se pudo verificar la petición. Inténtalo de nuevo.");
    }
    if (!success) throw new ApiError(400, "La verificación humana no es válida.");
    return;
  }

  // Campo trampa: los bots rellenan todo lo que encuentran.
  if ((input.honeypot ?? "").trim().length > 0) {
    throw new ApiError(400, "No se pudo verificar la petición.");
  }

  const startedAt = input.startedAt;
  const now = Date.now();
  if (!startedAt || !Number.isFinite(startedAt)) {
    throw new ApiError(400, "Vuelve a enviar el formulario.");
  }
  if (now - startedAt < MIN_FILL_MS) {
    throw new ApiError(429, "Espera un momento antes de enviar el formulario.");
  }
  if (now - startedAt > MAX_FORM_AGE_MS || startedAt > now + 60_000) {
    throw new ApiError(400, "Vuelve a enviar el formulario.");
  }
}
