/**
 * Bot de Mastodon: publica un aviso cada vez que una obra entra en el catálogo.
 *
 * Cinco decisiones que explican el resto del fichero:
 *
 * - **Registro sobrio.** Sin emoji, sin exclamaciones y sin superlativos: una
 *   frase enunciativa, el enlace y tres etiquetas. Es la voz de una biblioteca,
 *   no la de una promoción.
 * - **Cola en la base, no una llamada suelta.** Publicar un libro no puede
 *   depender de que mastodon.social conteste ahora: si falla, el post se pierde
 *   y nadie se entera. Se encola (`social_outbox`) y lo intenta el `after()` de
 *   la petición y, si queda algo, el cron de mantenimiento.
 * - **Un post por obra, no por ejemplar.** Si tres personas ponen el mismo
 *   libro, el perfil no repite el aviso: la tabla tiene una clave única por red
 *   y obra y el segundo `INSERT` se descarta.
 * - **Veinte formulaciones por idioma.** Un perfil que repite la misma frase
 *   veinte veces parece un robot. La variante se elige por el id de la obra, así
 *   que el mismo libro siempre se anuncia igual y lo que se ve en la cola es lo
 *   que se publica.
 * - **Nada de datos personales.** Título, autoría, portada y enlace. Ni ciudad,
 *   ni nombre de quien publica: la ciudad está en la ficha y quien quiera verla
 *   entra.
 *
 * El idioma del aviso es el del ejemplar; «Otro» y «No especificado» caen al
 * alemán, que es el idioma de la casa. Sin `MASTODON_TOKEN` no hay bot: no se
 * encola nada y el proceso queda apagado.
 */
import { randomUUID } from "node:crypto";

import { getCover, readUploadedCover } from "./covers";
import { getDb } from "./db";
import { DEFAULT_LOCALE, localePath, type Locale } from "./locale";

/** Red social del post. La tabla admite más; hoy solo hay esta. */
export const SOCIAL_NETWORK = "mastodon";

/** Un estado de Mastodon admite 500 caracteres. */
export const STATUS_LIMIT = 500;

/** Mastodon corta las descripciones de medios a 1500 caracteres. */
const ALT_LIMIT = 1500;

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

/** Una forma de empezar el aviso. Recibe el título y la autoría ya limpios. */
type Lead = (title: string, author: string) => string;

/**
 * Voz del bot por idioma: veinte formulaciones enunciativas.
 *
 * No vive en `i18n.ts` porque el diccionario es de **interfaz** y esto es
 * contenido con marcadores: aquí se compone una frase con el título y la
 * autoría, igual que `technical.ts` compone su documentación por idioma.
 *
 * Reglas de estilo, para que las veinte suenen a la misma voz:
 *
 * - Una sola frase, en tercera persona, sin emoji ni exclamaciones.
 * - Nada de superlativos ni de promesas que la plataforma no hace: el texto dice
 *   lo único cierto, que ese libro está y puede leerse.
 * - Comillas tipográficas de cada idioma y coma antes de la autoría cuando la
 *   frase lo pide (««X», de Y» frente a ««X» de Y»).
 */
const LEADS: Record<Locale, Lead[]> = {
  de: [
    (title, author) => `Neu im gemeinsamen Regal: „${title}“ von ${author}.`,
    (title, author) => `Soeben eingetroffen: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} ist ab heute im Katalog.`,
    (title, author) => `Der Katalog wächst um „${title}“ von ${author}.`,
    (title, author) => `Neu aufgenommen: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} steht jetzt im Regal.`,
    (title, author) => `Ab heute verfügbar: „${title}“ von ${author}.`,
    (title, author) => `Eingestellt und zu vergeben: „${title}“ von ${author}.`,
    (title, author) => `Dem Regal hinzugefügt: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} sucht neue Leserinnen und Leser.`,
    (title, author) => `Ein weiteres Buch im Regal: „${title}“ von ${author}.`,
    (title, author) => `Neu bei Wanderbibliothek: „${title}“ von ${author}.`,
    (title, author) => `Eben eingetragen: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author}, jetzt Teil des Katalogs.`,
    (title, author) => `Zur Weitergabe eingestellt: „${title}“ von ${author}.`,
    (title, author) => `Im Katalog zu finden: „${title}“ von ${author}.`,
    (title, author) => `In die Wanderbibliothek aufgenommen: „${title}“ von ${author}.`,
    (title, author) => `Ab sofort zu lesen und weiterzugeben: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} ergänzt das gemeinsame Regal.`,
    (title, author) => `Der Bestand wächst: „${title}“ von ${author}.`,
  ],
  es: [
    (title, author) => `Nuevo en la estantería común: «${title}» de ${author}.`,
    (title, author) => `Recién incorporado al catálogo: «${title}» de ${author}.`,
    (title, author) => `«${title}», de ${author}, ya forma parte del catálogo.`,
    (title, author) => `El catálogo suma «${title}», de ${author}.`,
    (title, author) => `Disponible desde hoy: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, espera en la estantería.`,
    (title, author) => `Se incorpora a la estantería «${title}», de ${author}.`,
    (title, author) => `Nueva entrada en la estantería común: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, busca nuevos lectores.`,
    (title, author) => `El fondo crece con «${title}», de ${author}.`,
    (title, author) => `Añadido al catálogo: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, disponible para su intercambio.`,
    (title, author) => `Un nuevo título en la estantería: «${title}», de ${author}.`,
    (title, author) => `Pasa a formar parte del catálogo «${title}», de ${author}.`,
    (title, author) => `Registrado hoy: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, queda a disposición de quien lo lea.`,
    (title, author) => `Ampliamos el catálogo con «${title}», de ${author}.`,
    (title, author) => `Nuevo ejemplar en la estantería común: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, inicia su recorrido entre lectores.`,
    (title, author) => `Desde hoy figura en el catálogo «${title}», de ${author}.`,
  ],
  en: [
    (title, author) => `New in the shared library: “${title}” by ${author}.`,
    (title, author) => `Newly added to the catalogue: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is now part of the collection.`,
    (title, author) => `The catalogue grows with “${title}” by ${author}.`,
    (title, author) => `Available from today: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is waiting on the shelf.`,
    (title, author) => `Added to the shelf: “${title}” by ${author}.`,
    (title, author) => `A new entry in the shared library: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is looking for its next reader.`,
    (title, author) => `“${title}” by ${author} joins the collection.`,
    (title, author) => `Now in the catalogue: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author}, available to borrow.`,
    (title, author) => `One more title on the shelf: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} becomes part of the catalogue.`,
    (title, author) => `Recorded today: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is available to whoever reads it next.`,
    (title, author) => `The catalogue has gained “${title}” by ${author}.`,
    (title, author) => `A new copy in the shared library: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} begins its journey between readers.`,
    (title, author) => `From today, “${title}” by ${author} is in the catalogue.`,
  ],
};

/** Las formulaciones de un idioma (las del idioma base si no lo hay). */
export function leadVariants(locale: Locale): Lead[] {
  return LEADS[locale] ?? LEADS[DEFAULT_LOCALE];
}

/** Etiquetas por idioma, en el idioma de quien va a leer el aviso. */
const TAGS: Record<Locale, string[]> = {
  de: ["Wanderbibliothek", "Bücher", "Büchertausch"],
  es: ["Wanderbibliothek", "Libros", "IntercambioDeLibros"],
  en: ["Wanderbibliothek", "Books", "BookSwap"],
};

/** Texto alternativo de la portada: lo lee quien no ve la imagen. */
const ALT: Record<Locale, (title: string, author: string) => string> = {
  de: (title, author) => `Buchcover von „${title}“ von ${author}`,
  es: (title, author) => `Portada de «${title}» de ${author}`,
  en: (title, author) => `Cover of “${title}” by ${author}`,
};

/**
 * Elige la variante con un hash del id de la obra.
 *
 * Determinista a propósito: el mismo libro da siempre el mismo texto, así que lo
 * que se ve en la cola es lo que se publica y un reintento no cambia el aviso.
 */
export function variantIndex(seed: string, count: number): number {
  // FNV-1a de 32 bits: corto, sin dependencias y bien repartido para ids cortos.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return count > 0 ? hash % count : 0;
}

export type PostInput = {
  title: string;
  author: string;
  /** Enlace público a la obra, ya con el prefijo de idioma. */
  url: string;
  locale: Locale;
  /** Id de la obra: decide la variante del texto. */
  seed: string;
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
  const locale = LEADS[input.locale] ? input.locale : DEFAULT_LOCALE;
  const leads = leadVariants(locale);
  const lead = leads[variantIndex(input.seed, leads.length)]!;
  const tail = `\n\n${input.url}\n\n${TAGS[locale].map((tag) => `#${tag}`).join(" ")}`;
  const room = Math.max(1, STATUS_LIMIT - Array.from(tail).length);
  return `${truncate(lead(input.title, input.author), room)}${tail}`;
}

/** Texto alternativo de la portada, en el idioma del aviso. */
export function coverAlt(locale: Locale, title: string, author: string): string {
  const build = ALT[locale] ?? ALT[DEFAULT_LOCALE];
  return truncate(build(title, author), ALT_LIMIT);
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

/** Portada de la obra: la subida a mano manda; si no, la del ISBN (y se cachea). */
export async function coverForBook(
  bookId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const uploaded = readUploadedCover(bookId);
  if (uploaded) return uploaded;
  const row = getDb().prepare("SELECT isbn, title, author FROM books WHERE id = ?").get(bookId) as
    | { isbn: string | null; title: string; author: string }
    | undefined;
  if (!row?.isbn) return null;
  return getCover(row.isbn, { title: row.title, author: row.author });
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
  options: { mediaIds?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<PostResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new FormData();
  body.set("status", text);
  body.set("visibility", config.visibility);
  for (const id of options.mediaIds ?? []) body.append("media_ids[]", id);
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

export type MediaResult =
  | { ok: true; id: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Sube una imagen y devuelve su id para engancharla a un estado.
 *
 * Desde Mastodon 4.0 las imágenes se procesan en el momento (200 con `url`), así
 * que casi nunca entra en juego la rama 202; cuando entra, se sondea el medio
 * hasta que esté listo, porque adjuntar una imagen a medio procesar hace que el
 * estado falle con 422.
 */
export async function uploadMedia(
  config: MastodonConfig,
  media: { data: Buffer; contentType: string; description: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MediaResult> {
  const form = new FormData();
  // La extensión ayuda a Mastodon a clasificar el archivo cuando el
  // `Content-Type` no le basta.
  const extension = media.contentType === "image/png" ? "png" : "jpg";
  form.set(
    "file",
    new Blob([new Uint8Array(media.data)], { type: media.contentType }),
    `portada.${extension}`,
  );
  form.set("description", media.description);

  let mediaId: string;
  try {
    const response = await fetchImpl(`${config.instance}/api/v2/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      url?: string | null;
      error?: string;
    } | null;
    if (!response.ok || !payload?.id) {
      return {
        ok: false,
        error: payload?.error ?? `HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    mediaId = payload.id;
    if (payload.url) return { ok: true, id: mediaId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "sin conexión",
      retryable: true,
    };
  }

  // Sigue procesándose: se pregunta hasta cinco veces, un segundo entre intentos.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const response = await fetchImpl(`${config.instance}/api/v1/media/${mediaId}`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(8000),
      });
      // 206 significa «todavía procesando».
      if (response.status === 206) continue;
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}`, retryable: false };
      }
      return { ok: true, id: mediaId };
    } catch {
      // Se reintenta en la vuelta siguiente; si se agotan, se publica sin
      // imagen, que es mejor que no publicar.
    }
  }
  return { ok: false, error: "la imagen sigue procesándose", retryable: true };
}

/**
 * Encola el aviso de una obra. Devuelve el id de la fila nueva o `null` si ya
 * había un aviso para esa obra (la clave única por red y obra lo descarta).
 */
export function enqueuePost(input: {
  bookId: string;
  text: string;
  mediaId?: string | null;
  network?: string;
}): string | null {
  const id = `soc_${randomUUID()}`;
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO social_outbox
         (id, network, subject, body, status, attempts, next_attempt_at, created_at, media_id)
       VALUES (?, ?, ?, ?, 'pending', 0,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`,
    )
    .run(id, input.network ?? SOCIAL_NETWORK, input.bookId, input.text, input.mediaId ?? null);
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
      `SELECT id, body, attempts, media_id
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
    media_id: string | null;
  }[];

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await postStatus(config, row.body, row.id, {
      mediaIds: row.media_id ? [row.media_id] : [],
      fetchImpl,
    });
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
 * Anuncia una obra recién publicada: compone el texto, sube la portada si la
 * hay, lo encola e intenta enviarlo ya. Se llama desde el `after()` de la ruta,
 * así que **no puede lanzar**: publicar un libro no depende de Mastodon.
 *
 * Que la portada falle (sin imagen, `write:media` sin permiso, instancia lenta)
 * no impide el aviso: se publica el texto sin imagen.
 */
export async function announceBook(input: {
  bookId: string;
  title: string;
  author: string;
  language?: string | null;
  base: string;
}): Promise<{ queued: boolean; sent: boolean; media: boolean }> {
  try {
    const config = mastodonConfig();
    if (!config) return { queued: false, sent: false, media: false };
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
      return { queued: false, sent: false, media: false };
    }

    const locale = localeForLanguage(input.language);
    const text = composeStatus({
      title: input.title,
      author: input.author,
      url: workUrl(input.base, input.bookId, locale),
      locale,
      seed: input.bookId,
    });

    // La portada se sube antes de encolar: así el id queda guardado y un
    // reintento publica exactamente lo mismo, con su imagen.
    let mediaId: string | null = null;
    try {
      const cover = await coverForBook(input.bookId);
      if (cover) {
        const uploaded = await uploadMedia(config, {
          data: cover.data,
          contentType: cover.contentType,
          description: coverAlt(locale, input.title, input.author),
        });
        if (uploaded.ok) mediaId = uploaded.id;
      }
    } catch {
      // Sin portada se publica igual: el aviso es lo importante.
    }

    const id = enqueuePost({ bookId: input.bookId, text, mediaId });
    if (!id) return { queued: false, sent: false, media: false };
    // Se intenta esa fila y no la más antigua: un atraso en la cola (la
    // instancia caída ayer) no puede retrasar el aviso de hoy.
    const { sent } = await processSocialOutbox({ limit: 1, only: id, config });
    return { queued: true, sent: sent > 0, media: Boolean(mediaId) };
  } catch {
    // Un fallo aquí no puede dejar a medias la publicación: la cola se queda
    // pendiente y el cron lo reintenta.
    return { queued: false, sent: false, media: false };
  }
}
