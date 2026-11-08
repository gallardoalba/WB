/**
 * El bot también lee: da «me gusta» a publicaciones sobre libros.
 *
 * Lo delicado de esta parte no es la API —dos llamadas— sino **no parecer un
 * robot**. Un perfil que pulsa veinte corazones en un minuto lo bloquean, y con
 * razón. De ahí las reglas, todas pensadas para que la actividad se pueda
 * confundir con la de una persona:
 *
 * - **Apagado por defecto.** Solo se enciende con `MASTODON_LIKES=on` y un
 *   token: actúa sobre lo que escriben otras personas, así que no se hace solo.
 * - **Por etiqueta, nunca por búsqueda libre.** Se leen las líneas de tiempo de
 *   etiquetas de libros (`#Bücher`, `#Libros`, `#Bookstodon`…) y se descarta lo
 *   que no está en el idioma de la etiqueta.
 * - **Pocas y espaciadas.** Un tope en 24 h (`MASTODON_LIKES_PER_DAY`, 8 por
 *   defecto) y una separación mínima entre pulsaciones
 *   (`MASTODON_LIKES_MIN_GAP_MINUTES`, 25). Como el cron pasa cada 15 minutos,
 *   nunca hay dos seguidas.
 * - **Una vez por cuenta y día.** Si alguien publica cuatro cosas sobre libros,
 *   se le pulsa una: el resto parecería acoso.
 * - **Solo lo que se puede leer sin cuenta.** Estados públicos o no listados,
 *   originales (nada de boosts), sin marcar como sensibles, con texto de verdad
 *   y una palabra de libros dentro, de los últimos siete días.
 * - **Memoria.** `social_likes` guarda cada estado pulsado: el mismo post no se
 *   repite ni al día siguiente.
 *
 * Cualquier fallo de red o un 429 cortan la pasada sin reintentar en bucle: el
 * siguiente pase del cron volverá a mirar cuando toque.
 */
import { randomUUID } from "node:crypto";

import { getDb } from "./db";
import type { Locale } from "./locale";
import {
  dayKey,
  mastodonConfig,
  SOCIAL_NETWORK,
  variantIndex,
  type MastodonConfig,
} from "./mastodon";

/**
 * Etiquetas por idioma. Son las que usa la comunidad librera de cada lengua; se
 * consultan en este orden tras un barajado estable por día.
 */
export const LIKE_TAGS: Record<Locale, string[]> = {
  de: ["Bücher", "Buch", "Lesen", "Literatur", "Buchtipp"],
  es: ["Libros", "Lectura", "Libro", "Literatura"],
  en: ["Books", "Bookstodon", "Reading", "BookRecommendation"],
};

/** Palabra que tiene que aparecer en el texto: la etiqueta sola no basta. */
const BOOK_WORDS: Record<Locale, RegExp> = {
  de: /\b(buch|bücher|buches|lese|lesen|gelesen|roman|autor|autorin|literatur|verlag|bibliothek)\b/i,
  es: /\b(libro|libros|leo|leer|leído|leída|lectura|novela|autor|autora|literatura|editorial|biblioteca)\b/i,
  en: /\b(book|books|reading|read|novel|author|writer|literature|publisher|library)\b/i,
};

/** Prefijo del código ISO que tiene que traer el estado para ese idioma. */
const LANGUAGE_PREFIX: Record<Locale, string> = { de: "de", es: "es", en: "en" };

/** Un estado más viejo que esto ya no se pulsa: llegaría tarde y raro. */
const MAX_AGE_DAYS = 7;
/** Tolerancia con relojes adelantados. */
const MAX_FUTURE_MINUTES = 60;
/** Texto mínimo tras quitar el HTML: «#Bücher 📚» no es una publicación. */
const MIN_TEXT = 60;
/** Una cuenta con cuatro publicaciones y un enlace es un anuncio, no alguien. */
const MIN_STATUSES = 10;

const TRUTHY = new Set(["1", "on", "true", "yes", "sí", "si"]);

export type LikeConfig = MastodonConfig & {
  /** Tope de «me gusta» en las últimas 24 h. */
  perDay: number;
  /** Minutos mínimos entre dos pulsaciones. */
  minGapMinutes: number;
  /** Etiquetas propias; `null` deja las de cada idioma. */
  tags: string[] | null;
};

function clamp(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseTags(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const tags = raw
    .split(/[,\s]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  return tags.length > 0 ? tags : null;
}

/**
 * Configuración de los «me gusta», o `null` si están apagados.
 *
 * Se apoya en `mastodonConfig()`: sin token ni instancia https no hay nada que
 * hacer. `MASTODON_LIKES=on` es obligatorio a propósito.
 */
export function likesConfig(
  env: Record<string, string | undefined> = process.env,
): LikeConfig | null {
  const base = mastodonConfig(env);
  if (!base) return null;
  if (!TRUTHY.has((env.MASTODON_LIKES ?? "").trim().toLowerCase())) return null;
  const perDay = clamp(env.MASTODON_LIKES_PER_DAY, 8, 0, 40);
  // Un 0 explícito es «no des ninguno», no «usa el valor por defecto».
  if (perDay === 0) return null;
  return {
    ...base,
    perDay,
    minGapMinutes: clamp(env.MASTODON_LIKES_MIN_GAP_MINUTES, 25, 5, 24 * 60),
    tags: parseTags(env.MASTODON_LIKES_TAGS),
  };
}

export type MastodonStatus = {
  id: string;
  url: string | null;
  /** Texto sin HTML, que es lo que se mira para decidir. */
  text: string;
  language: string | null;
  createdAt: string;
  visibility: string;
  isReblog: boolean;
  favourited: boolean;
  sensitive: boolean;
  account: { id: string; acct: string; bot: boolean; statuses: number };
};

type RawStatus = {
  id?: string;
  url?: string | null;
  content?: string;
  language?: string | null;
  created_at?: string;
  visibility?: string;
  reblog?: unknown;
  favourited?: boolean;
  sensitive?: boolean;
  account?: {
    id?: string;
    acct?: string;
    username?: string;
    bot?: boolean;
    statuses_count?: number;
  };
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Texto plano de un estado: Mastodon devuelve el contenido en HTML. */
export function statusText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return ENTITIES[body.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza lo que devuelve la API. Devuelve `null` si no es un estado usable. */
export function toStatus(raw: RawStatus): MastodonStatus | null {
  const id = raw.id?.trim();
  const acct = raw.account?.acct?.trim() ?? raw.account?.username?.trim();
  if (!id || !acct) return null;
  const html = raw.content ?? "";
  return {
    id,
    url: raw.url ?? null,
    text: statusText(html),
    language: raw.language ? raw.language.toLowerCase() : null,
    createdAt: raw.created_at ?? "",
    visibility: raw.visibility ?? "public",
    isReblog: Boolean(raw.reblog),
    favourited: Boolean(raw.favourited),
    sensitive: Boolean(raw.sensitive),
    account: {
      id: raw.account?.id ?? "",
      acct,
      bot: Boolean(raw.account?.bot),
      statuses: raw.account?.statuses_count ?? 0,
    },
  };
}

export type Rejection =
  | "es un boost"
  | "no es público"
  | "está marcado como sensible"
  | "ya le gusta"
  | "ya se pulsó"
  | "es otro bot"
  | "es nuestro propio estado"
  | "cuenta sin recorrido"
  | "ya le gustó a esa cuenta hoy"
  | "texto demasiado corto"
  | "no habla de libros"
  | "demasiado antiguo"
  | "otro idioma";

export type LikeableCheck = { ok: true } | { ok: false; reason: Rejection };

/**
 * ¿Merece esta publicación un «me gusta»? Cada motivo de descarte tiene nombre
 * propio para poder leerlo en los registros y en las pruebas.
 */
export function likeableStatus(
  status: MastodonStatus,
  options: {
    locale: Locale;
    now?: Date;
    /** Cuenta del bot: nunca se pulsa a sí mismo. */
    myAccountId?: string | null;
    /** Cuentas a las que ya se pulsó en las últimas 24 h. */
    accountsLiked?: Set<string>;
    /** Estados ya pulsados alguna vez (memoria del bot). */
    statusesLiked?: Set<string>;
  },
): LikeableCheck {
  const now = options.now ?? new Date();
  if (status.isReblog) return { ok: false, reason: "es un boost" };
  if (status.visibility !== "public" && status.visibility !== "unlisted") {
    return { ok: false, reason: "no es público" };
  }
  if (status.sensitive) return { ok: false, reason: "está marcado como sensible" };
  if (status.favourited) return { ok: false, reason: "ya le gusta" };
  if (options.statusesLiked?.has(status.id)) return { ok: false, reason: "ya se pulsó" };
  if (status.account.bot) return { ok: false, reason: "es otro bot" };
  if (options.myAccountId && status.account.id === options.myAccountId) {
    return { ok: false, reason: "es nuestro propio estado" };
  }
  if (status.account.statuses < MIN_STATUSES) return { ok: false, reason: "cuenta sin recorrido" };
  if (options.accountsLiked?.has(status.account.acct.toLowerCase())) {
    return { ok: false, reason: "ya le gustó a esa cuenta hoy" };
  }
  if (status.text.length < MIN_TEXT) return { ok: false, reason: "texto demasiado corto" };
  if (!BOOK_WORDS[options.locale].test(status.text)) {
    return { ok: false, reason: "no habla de libros" };
  }
  const created = Date.parse(status.createdAt);
  if (!Number.isFinite(created)) return { ok: false, reason: "demasiado antiguo" };
  const ageMs = now.getTime() - created;
  if (ageMs > MAX_AGE_DAYS * 86_400_000) return { ok: false, reason: "demasiado antiguo" };
  if (ageMs < -MAX_FUTURE_MINUTES * 60_000) return { ok: false, reason: "demasiado antiguo" };
  const language = (status.language ?? "").toLowerCase();
  if (!language.startsWith(LANGUAGE_PREFIX[options.locale])) {
    return { ok: false, reason: "otro idioma" };
  }
  return { ok: true };
}

export type TimelinePage =
  | { ok: true; statuses: MastodonStatus[] }
  | { ok: false; error: string; retryable: boolean };

/**
 * Línea de tiempo de una etiqueta (`local=false`: también lo remoto).
 *
 * Se pide **sin token a propósito**: las líneas de tiempo de etiquetas son
 * públicas y así el bot no necesita `read:statuses` —solo el permiso de pulsar
 * (`write:favourites`)—. Si una instancia privada lo rechazara, el fallo se
 * queda en «no había nada» y no se pulsa nada.
 */
export async function tagTimeline(
  config: MastodonConfig,
  tag: string,
  options: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<TimelinePage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 20;
  const url = `${config.instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}&local=false`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return {
        ok: false,
        error: payload?.error ?? `HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    const raw = (await response.json().catch(() => null)) as RawStatus[] | null;
    if (!Array.isArray(raw)) return { ok: false, error: "respuesta inesperada", retryable: true };
    return {
      ok: true,
      statuses: raw.map(toStatus).filter((status): status is MastodonStatus => status !== null),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "sin conexión",
      retryable: true,
    };
  }
}

export type ActionResult = { ok: true } | { ok: false; error: string; retryable: boolean };

/** Pulsa el corazón de un estado (`POST /api/v1/statuses/:id/favourite`). */
export async function favouriteStatus(
  config: MastodonConfig,
  statusId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ActionResult> {
  try {
    const response = await fetchImpl(
      `${config.instance}/api/v1/statuses/${encodeURIComponent(statusId)}/favourite`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: payload?.error ?? `HTTP ${response.status}`,
      // Un 404 (estado borrado) o un 401 (token revocado) no mejoran solos.
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

/** Quién es el bot, para no pulsar sus propios estados. */
export async function botAccount(
  config: MastodonConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; id: string; acct: string } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(`${config.instance}/api/v1/accounts/verify_credentials`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(8000),
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      acct?: string;
      username?: string;
      error?: string;
    } | null;
    if (!response.ok || !payload?.id) {
      return { ok: false, error: payload?.error ?? `HTTP ${response.status}` };
    }
    return { ok: true, id: payload.id, acct: payload.acct ?? payload.username ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "sin conexión" };
  }
}

/* ------------------------------ memoria ---------------------------------- */

/** «Me gusta» dados en la ventana de horas indicada (24 por defecto). */
export function likeCountSince(hours = 24, network = SOCIAL_NETWORK): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total FROM social_likes
        WHERE network = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .get(network, `-${hours} hours`) as { total: number };
  return row.total;
}

/** Cuentas ya pulsadas en la ventana: una por cuenta y día. */
export function accountsLikedSince(hours = 24, network = SOCIAL_NETWORK): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT account_acct FROM social_likes
        WHERE network = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .all(network, `-${hours} hours`) as { account_acct: string }[];
  return new Set(rows.map((row) => row.account_acct.toLowerCase()));
}

export function lastLikeAt(network = SOCIAL_NETWORK): Date | null {  const row = getDb()
    .prepare("SELECT created_at FROM social_likes WHERE network = ? ORDER BY created_at DESC LIMIT 1")
    .get(network) as { created_at: string } | undefined;
  if (!row) return null;
  const date = new Date(row.created_at);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Estados ya pulsados: el bot no repite aunque Mastodon ya no los muestre. */
export function likedStatusIds(days = 180, network = SOCIAL_NETWORK): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT status_id FROM social_likes
        WHERE network = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .all(network, `-${days} days`) as { status_id: string }[];
  return new Set(rows.map((row) => row.status_id));
}

/** Apunta un estado pulsado. `false` si ya estaba (el índice único manda). */
export function recordLike(input: {
  statusId: string;
  accountAcct: string;
  url?: string | null;
  tag?: string | null;
  locale?: Locale | null;
  network?: string;
}): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO social_likes
         (id, network, status_id, account_acct, status_url, tag, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .run(
      `lik_${randomUUID()}`,
      input.network ?? SOCIAL_NETWORK,
      input.statusId,
      input.accountAcct,
      input.url ?? null,
      input.tag ?? null,
      input.locale ?? null,
    );
  return result.changes > 0;
}

export function recentLikes(limit = 10): {
  status_id: string;
  account_acct: string;
  status_url: string | null;
  tag: string | null;
  locale: string | null;
  created_at: string;
}[] {
  return getDb()
    .prepare(
      `SELECT status_id, account_acct, status_url, tag, locale, created_at
         FROM social_likes ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as {
    status_id: string;
    account_acct: string;
    status_url: string | null;
    tag: string | null;
    locale: string | null;
    created_at: string;
  }[];
}

/** Borra el historial antiguo: solo sirve para no repetir estados recientes. */
export function purgeSocialLikes(days = 180): number {
  return getDb()
    .prepare(
      "DELETE FROM social_likes WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)",
    )
    .run(`-${days} days`).changes;
}

/* ------------------------------ decisión --------------------------------- */

/**
 * Etiquetas de esta pasada, barajadas de forma **estable por día**: así el mismo
 * día se reparten entre todas y no siempre se mira la primera.
 */
export function tagsForRun(
  config: LikeConfig,
  now: Date,
  maxTags = 3,
): { tag: string; locale: Locale }[] {
  const day = dayKey(now);
  const candidates: { tag: string; locale: Locale }[] = [];
  for (const locale of Object.keys(LIKE_TAGS) as Locale[]) {
    const tags = config.tags ?? LIKE_TAGS[locale];
    for (const tag of tags) candidates.push({ tag, locale });
  }
  return candidates
    .sort((a, b) => variantIndex(`${a.tag}|${day}`, 1_000) - variantIndex(`${b.tag}|${day}`, 1_000))
    .slice(0, Math.max(1, maxTags));
}

export type LikeOutcome = {
  liked: boolean;
  reason: string;
  status?: { id: string; url: string | null; account: string; tag: string; locale: Locale };
};

/**
 * Una pasada del bot de «me gusta». Silencioso: nunca lanza.
 *
 * `dryRun` recorre todo el camino (etiquetas, filtros, elección) y se para antes
 * de pulsar: es lo que usa el script para enseñar qué haría.
 */
export async function processLikes(
  options: {
    config?: LikeConfig | null;
    fetchImpl?: typeof fetch;
    now?: Date;
    dryRun?: boolean;
    maxTags?: number;
  } = {},
): Promise<LikeOutcome> {
  const config = options.config === undefined ? likesConfig() : options.config;
  if (!config) return { liked: false, reason: "el bot de «me gusta» está apagado" };
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;

  const done = likeCountSince();
  if (done >= config.perDay) {
    return { liked: false, reason: `ya lleva ${done} en 24 h (tope ${config.perDay})` };
  }
  const last = lastLikeAt();
  if (last) {
    const minutes = (now.getTime() - last.getTime()) / 60_000;
    if (minutes < config.minGapMinutes) {
      const wait = Math.ceil(config.minGapMinutes - minutes);
      return { liked: false, reason: `descanso: faltan ${wait} min para el siguiente` };
    }
  }

  const me = await botAccount(config, fetchImpl);
  if (!me.ok) return { liked: false, reason: `no se pudo comprobar la cuenta: ${me.error}` };
  const accountsLiked = accountsLikedSince();
  const statusesLiked = likedStatusIds();

  for (const { tag, locale } of tagsForRun(config, now, options.maxTags ?? 3)) {
    const page = await tagTimeline(config, tag, { fetchImpl });
    if (!page.ok) {
      // Un 429 o una instancia caída paran la pasada; un 404 de etiqueta no.
      if (page.retryable) return { liked: false, reason: `la instancia no responde: ${page.error}` };
      continue;
    }
    const candidates = page.statuses.filter(
      (status) =>
        likeableStatus(status, {
          locale,
          now,
          myAccountId: me.id,
          accountsLiked,
          statusesLiked,
        }).ok,
    );
    if (candidates.length === 0) continue;

    // Elección estable dentro del día: lo que enseña el script es lo que se
    // publica, igual que con los avisos de libros.
    const pick = candidates[variantIndex(`${tag}|${dayKey(now)}`, candidates.length)]!;
    const chosen = {
      id: pick.id,
      url: pick.url,
      account: pick.account.acct,
      tag,
      locale,
    };
    if (options.dryRun) {
      return { liked: false, reason: "simulación: no se ha pulsado nada", status: chosen };
    }
    const result = await favouriteStatus(config, pick.id, fetchImpl);
    if (!result.ok) {
      // El error típico de una instalación nueva: el token no lleva
      // `write:favourites`, y Mastodon lo llama «outside the authorized scopes».
      const pista = /scope/i.test(result.error)
        ? " (al token le falta el permiso write:favourites)"
        : "";
      return {
        liked: false,
        reason: `no se pudo dar «me gusta»: ${result.error}${pista}`,
        status: chosen,
      };
    }
    recordLike({
      statusId: pick.id,
      accountAcct: pick.account.acct,
      url: pick.url,
      tag,
      locale,
    });
    return { liked: true, reason: "me gusta dado", status: chosen };
  }

  return { liked: false, reason: "no había nada que mereciera un «me gusta»" };
}
