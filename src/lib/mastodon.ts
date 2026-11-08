/**
 * Bot de Mastodon: publica un aviso cada vez que una obra entra en el catálogo.
 *
 * Tres decisiones que explican el resto del fichero:
 *
 * - **Cola en la base, no una llamada suelta.** Publicar un libro no puede
 *   depender de que mastodon.social conteste ahora: si falla, el post se pierde
 *   y nadie se entera. Se encola (`social_outbox`) y lo intenta el `after()` de
 *   la petición y, si queda algo, el cron de mantenimiento.
 * - **Un post por obra, no por ejemplar.** Si tres personas ponen el mismo
 *   libro, el perfil no repite el mismo aviso tres veces: la tabla tiene una
 *   clave única por red y obra y el segundo `INSERT` se descarta.
 * - **Nada de datos personales.** El aviso lleva título, autoría y enlace. Ni
 *   ciudad, ni nombre de quien publica: la ciudad ya está en la ficha y quien
 *   quiera verla entra.
 *
 * Sin `MASTODON_TOKEN` no hay bot: no se encola nada y el proceso queda apagado.
 */
import { randomUUID } from "node:crypto";

import { getDb } from "./db";
import { DEFAULT_LOCALE, localePath, type Locale } from "./locale";

/** Red social del post. La tabla admite más; hoy solo hay esta. */
export const SOCIAL_NETWORK = "mastodon";

/** Un estado de Mastodon admite 500 caracteres. */
export const STATUS_LIMIT = 500;

/** Intentos antes de dar un post por perdido. */
const MAX_ATTEMPTS = 5;

export type MastodonConfig = {
  /** Origen, sin barra final: `https://mastodon.social`. */
  instance: string;
  token: string;
  visibility: "public" | "unlisted" | "private";
};

/**
 * Configuración del bot, o `null` si no está activo.
 *
 * Es silencioso a propósito: una instancia mal escrita no puede tumbar el
 * arranque por un adorno. Devuelve `null`, no se encola y el catálogo sigue.
 */
export function mastodonConfig(env: Record<string, string | undefined> = process.env): MastodonConfig | null {
  const token = env.MASTODON_TOKEN?.trim();
  if (!token) return null;
  const raw = env.MASTODON_INSTANCE?.trim() || "https://mastodon.social";
  let instance: string;
  try {
    const url = new URL(raw);
    // El token viaja en una cabecera: por HTTP viajaría en claro.
    if (url.protocol !== "https:") return null;
    instance = url.origin;
  } catch {
    return null;
  }
  const visibility = env.MASTODON_VISIBILITY?.trim();
  return {
    instance,
    token,
    visibility: visibility === "unlisted" || visibility === "private" ? visibility : "public",
  };
}

/**
 * Voz del bot por idioma.
 *
 * No vive en `i18n.ts` porque el diccionario es de **interfaz** y esto es
 * contenido con marcadores: aquí se compone una frase con el título y la
 * autoría, igual que `technical.ts` compone su documentación por idioma.
 */
const POST_TEMPLATES: Record<
  Locale,
  { lead: (title: string, author: string) => string; tags: string[] }
> = {
  de: {
    lead: (title, author) => `📚 Neu bei Wanderbibliothek: „${title}“ von ${author}.`,
    tags: ["Wanderbibliothek", "Bücher", "Büchertausch"],
  },
  es: {
    lead: (title, author) => `📚 Nuevo en Wanderbibliothek: «${title}» de ${author}.`,
    tags: ["Wanderbibliothek", "Libros", "IntercambioDeLibros"],
  },
  en: {
    lead: (title, author) => `📚 New on Wanderbibliothek: “${title}” by ${author}.`,
    tags: ["Wanderbibliothek", "Books", "BookSwap"],
  },
};

export type PostInput = {
  title: string;
  author: string;
  /** Enlace público a la obra, ya con el prefijo de idioma. */
  url: string;
  locale: Locale;
};

/** Corta por puntos de código: `length` cuenta unidades UTF-16 y un emoji cuenta doble. */
function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 1) return "…";
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * Texto del estado: frase, enlace y etiquetas, sin pasarse de 500 caracteres.
 *
 * El enlace y las etiquetas se reservan **antes** de cortar: es lo que no puede
 * perderse. Un título de 400 caracteres se recorta y el post sigue siendo útil.
 */
export function composeStatus(input: PostInput): string {
  const copy = POST_TEMPLATES[input.locale] ?? POST_TEMPLATES[DEFAULT_LOCALE];
  const tail = `\n\n${input.url}\n\n${copy.tags.map((tag) => `#${tag}`).join(" ")}`;
  const room = Math.max(1, STATUS_LIMIT - Array.from(tail).length);
  const lead = truncate(copy.lead(input.title, input.author), room);
  return `${lead}${tail}`;
}

/** Idioma del aviso a partir del idioma del ejemplar, que está en castellano. */
export function localeForLanguage(language: string | null | undefined): Locale {
  switch (language) {
    case "Español":
      return "es";
    case "Inglés":
      return "en";
    case "Alemán":
      return "de";
    default:
      // «Otro» y «No especificado» no dicen en qué idioma escribir: se usa el
      // de la casa, que es el que ve quien llega sin cookie.
      return DEFAULT_LOCALE;
  }
}

/** Enlace público de la obra en el idioma del aviso. */
export function workUrl(base: string, bookId: string, locale: Locale): string {
  return `${base.replace(/\/+$/, "")}${localePath(locale, `/werk/${bookId}`)}`;
}

export type PostResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Publica un estado. `Idempotency-Key` va con el id de la fila de la cola: si
 * dos workers coinciden o un reintento llega tarde, Mastodon devuelve el mismo
 * estado en vez de publicar dos veces.
 */
export async function postStatus(
  config: MastodonConfig,
  text: string,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostResult> {
  const body = new FormData();
  body.set("status", text);
  body.set("visibility", config.visibility);
  try {
    const response = await fetchImpl(`${config.instance}/api/v1/statuses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "Idempotency-Key": idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      url?: string;
      error?: string;
    } | null;
    if (response.ok && payload?.id) {
      return { ok: true, id: payload.id, url: payload.url ?? "" };
    }
    return {
      ok: false,
      error: payload?.error ?? `HTTP ${response.status}`,
      // 429 y 5xx se pasan solos; un 401 (token revocado) o un 422 (texto
      // inválido) no mejoran reintentando: se marcan como fallidos.
      retryable: response.status === 429 || response.status >= 500,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "sin conexión",
      retryable: true,
    };
  }
}

/**
 * Encola el aviso de una obra. Devuelve el id de la fila nueva o `null` si ya
 * había un aviso para esa obra (la clave única por red y obra lo descarta).
 */
export function enqueuePost(input: { bookId: string; text: string; network?: string }): string | null {
  const id = `soc_${randomUUID()}`;
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO social_outbox
         (id, network, subject, body, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .run(id, input.network ?? SOCIAL_NETWORK, input.bookId, input.text);
  return result.changes > 0 ? id : null;
}

/**
 * Intenta entregar los avisos pendientes. Silencioso: nunca lanza.
 *
 * `only` limita el intento a una fila concreta (la que acaba de encolar quien
 * publica), de modo que un atraso en la cola no retrasa el aviso de hoy.
 */
export async function processSocialOutbox(
  options: {
    limit?: number;
    only?: string;
    config?: MastodonConfig | null;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const config = options.config === undefined ? mastodonConfig() : options.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 3;
  if (!config) return { sent: 0, failed: 0, skipped: true };
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, body, attempts
         FROM social_outbox
        WHERE network = ? AND status = 'pending'
          AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND (? IS NULL OR id = ?)
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(SOCIAL_NETWORK, options.only ?? null, options.only ?? null, limit) as {
    id: string;
    body: string;
    attempts: number;
  }[];

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await postStatus(config, row.body, row.id, fetchImpl);
    if (result.ok) {
      db.prepare(
        `UPDATE social_outbox
            SET status = 'sent', external_id = ?, external_url = ?,
                last_error = NULL, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?`,
      ).run(result.id, result.url || null, row.id);
      sent += 1;
      continue;
    }
    const attempts = row.attempts + 1;
    const finalFailure = attempts >= MAX_ATTEMPTS || !result.retryable;
    const delaySeconds = Math.min(3600, 2 ** attempts * 60);
    db.prepare(
      `UPDATE social_outbox
          SET attempts = ?, status = ?, last_error = ?,
              next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
        WHERE id = ?`,
    ).run(
      attempts,
      finalFailure ? "failed" : "pending",
      // El error de Mastodon se guarda tal cual: es lo que se mira cuando un
      // post no sale («Text exceeds 500 characters», «Invalid access token»).
      result.error.slice(0, 300),
      `+${delaySeconds} seconds`,
      row.id,
    );
    failed += 1;
  }
  return { sent, failed, skipped: false };
}

/** Borra avisos entregados o fallidos antiguos. Los pendientes no se tocan. */
export function purgeSocialOutbox(days = 90): number {
  return getDb()
    .prepare(
      `DELETE FROM social_outbox
        WHERE status <> 'pending'
          AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .run(`-${days} days`).changes;
}

/**
 * Anuncia una obra recién publicada: compone el texto, lo encola e intenta
 * enviarlo ya. Se llama desde el `after()` de la ruta, así que **no puede
 * lanzar**: publicar un libro no depende de Mastodon.
 */
export async function announceBook(input: {
  bookId: string;
  title: string;
  author: string;
  language?: string | null;
  base: string;
}): Promise<{ queued: boolean; sent: boolean }> {
  try {
    const config = mastodonConfig();
    if (!config) return { queued: false, sent: false };
    // En desarrollo el enlace sería localhost: se publicaría una URL que no
    // existe para nadie.
    const host = (() => {
      try {
        return new URL(input.base).hostname;
      } catch {
        return "";
      }
    })();
    if (!host || host === "localhost" || host === "127.0.0.1") {
      return { queued: false, sent: false };
    }

    const locale = localeForLanguage(input.language);
    const text = composeStatus({
      title: input.title,
      author: input.author,
      url: workUrl(input.base, input.bookId, locale),
      locale,
    });
    const id = enqueuePost({ bookId: input.bookId, text });
    if (!id) return { queued: false, sent: false };
    // Se intenta esa fila y no la más antigua: un atraso en la cola (la
    // instancia caída ayer) no puede retrasar el aviso de hoy.
    const { sent } = await processSocialOutbox({ limit: 1, only: id, config });
    return { queued: true, sent: sent > 0 };
  } catch {
    // Un fallo aquí no puede dejar a medias la publicación: la cola se queda
    // pendiente y el cron lo reintenta.
    return { queued: false, sent: false };
  }
}
