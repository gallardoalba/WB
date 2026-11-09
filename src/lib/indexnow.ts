/**
 * Aviso a los buscadores que hablan IndexNow (Bing, Yandex, Seznam, Naver).
 *
 * Google no lo usa —su vía es Search Console y el sitemap—, pero DuckDuckGo y
 * Ecosia sirven resultados de Bing, así que avisar aquí es la forma de que una
 * obra recién publicada aparezca en esos buscadores en horas y no en semanas.
 *
 * La clave es pública por diseño: no autentica nada, solo demuestra que quien
 * avisa controla el dominio, porque el fichero `public/<clave>.txt` tiene que
 * estar servido desde él. Por eso vive en el repositorio y no en el entorno.
 */
export const INDEXNOW_KEY = "dcdbcaba01ea668188a2cc14d3aaa95f";

/** Dónde está el fichero que demuestra la propiedad del dominio. */
export function indexNowKeyLocation(base: string): string {
  return `${base.replace(/\/+$/, "")}/${INDEXNOW_KEY}.txt`;
}

/**
 * Avisa de las URLs indicadas. Silencioso a propósito: si el buscador no
 * responde, publicar un libro no puede fallar por eso. Se llama dentro de
 * `after()`, cuando la respuesta ya salió.
 */
export async function notifyIndexNow(base: string, urls: string[]): Promise<boolean> {
  if (urls.length === 0) return false;
  // Se compara el **nombre** del host, no `host`: `new URL("http://localhost:3000").host`
  // es `localhost:3000`, así que la guardia antigua no casaba y en desarrollo se
  // avisaba de verdad al buscador (y la prueba dependía de que la red fallara).
  const hostname = (() => {
    try {
      return new URL(base).hostname;
    } catch {
      return null;
    }
  })();
  if (!hostname || esHostLocal(hostname)) return false;

  try {
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: hostname,
        key: INDEXNOW_KEY,
        keyLocation: indexNowKeyLocation(base),
        urlList: urls.slice(0, 10_000),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Localhost, bucles y redes privadas: avisar de ellos no tiene sentido. */
function esHostLocal(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}
