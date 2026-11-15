/**
 * Bot de Mastodon: publica un aviso cada vez que una obra entra en el catálogo.
 *
 * Seis decisiones que explican el resto del fichero:
 *
 * - **Registro sobrio.** Sin emoji, sin exclamaciones y sin superlativos: una
 *   frase enunciativa, el enlace y tres etiquetas. Es la voz de una biblioteca,
 *   no la de una promoción.
 * - **Cien formulaciones** y **etiquetas variables**. Un perfil que repite la
 *   misma frase y las mismas tres etiquetas parece un robot. La variante se
 *   elige con el id de la obra, así que el mismo libro siempre se anuncia igual
 *   y lo que se ve en la cola es lo que se publica. Las etiquetas combinan la
 *   casa, el tema del libro (sus etiquetas o su categoría) y la lectura.
 * - **Cola en la base, no una llamada suelta.** Publicar un libro no puede
 *   depender de que mastodon.social conteste ahora: si falla, el post se pierde
 *   y nadie se entera. Se encola (`social_outbox`) y lo intenta el `after()` de
 *   la petición y, si queda algo, el cron de mantenimiento.
 * - **Un post por obra, no por ejemplar.** Si tres personas ponen el mismo
 *   libro, el perfil no repite el aviso: la tabla tiene una clave única por red
 *   y obra y el segundo `INSERT` se descarta.
 * - **Nunca dos avisos seguidos.** Antes de publicar se mira la última entrada
 *   del perfil: si también es del bot, el aviso espera a que la cuenta publique
 *   otra cosa. Así el perfil no encadena avisos automáticos.
 * - **Nada de datos personales.** Título, autoría, portada y enlace. Ni ciudad,
 *   ni nombre de quien publica: la ciudad está en la ficha y quien quiera verla
 *   entra.
 *
 * **Siempre en alemán.** El perfil se dirige al público alemán, así que el aviso
 * no cambia de idioma con el ejemplar: la frase, las etiquetas y el texto
 * alternativo de la portada salen en alemán. Sin `MASTODON_TOKEN` no hay bot: no
 * se encola nada y el proceso queda apagado.
 */
import { randomUUID } from "node:crypto";

import { toJpeg } from "./cover-convert";
import { readUploadedCover, uploadedCoverPath } from "./covers";
import { getDb, type Db } from "./db";
import { composeStatus, coverAlt, workUrl } from "./mastodon-post";
import { siteUrl } from "./site";

export {
  ANNOUNCE_REF,
  composeStatus,
  coverAlt,
  hashtagsFor,
  leadVariants,
  readingTags,
  STATUS_LIMIT,
  subjectHashtags,
  variantIndex,
  workUrl,
} from "./mastodon-post";
export type { Lead, PostInput } from "./mastodon-post";

/** Red social del post. La tabla admite más; hoy solo hay esta. */
export const SOCIAL_NETWORK = "mastodon";
/** Minutos que una fila puede estar «en envío» antes de darla por abandonada. */
const CLAIM_SECONDS = 5 * 60;
/** Tiempo máximo de cada consulta de lectura del perfil antes de publicar. */
const PROFILE_TIMEOUT_MS = 8_000;

/** Intentos antes de dar un post por perdido. */
const MAX_ATTEMPTS = 5;

/**
 * Zona horaria que decide qué es «hoy» para el tope diario.
 *
 * El servidor puede estar en UTC y la base guarda instantes en UTC, pero quien
 * publica vive en Alemania: con la medianoche UTC, un libro de las 00:30 de
 * Múnich contaría como del día anterior.
 */
const DAY_TIME_ZONE = "Europe/Berlin";

/** Día (AAAA-MM-DD) al que pertenece un instante, en la zona de la casa. */
export function dayKey(now: Date = new Date(), timeZone = DAY_TIME_ZONE): string {
  // `en-CA` da el formato ISO que se puede comparar como texto.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Hora del día (0–23) en la zona de la casa. */
export function hourKey(now: Date = new Date(), timeZone = DAY_TIME_ZONE): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now),
  );
}

/** Fuera de las 09:00–20:00 (hora de Berlín) el bot no publica nada. */
export const QUIET_FROM_HOUR = 20;
export const QUIET_UNTIL_HOUR = 9;

/**
 * Ventana de silencio, `MASTODON_QUIET_HOURS="22-9"`.
 *
 * Con `off` se desactiva. Sirve para moverla (por ejemplo `23-8`) sin tocar
 * código, y las pruebas la apagan para no depender de la hora a la que se
 * ejecuten. Una banda que no cruza la medianoche (`1-5`) también vale.
 */
function bandaSilencio(): [number, number] | null {
  const crudo = process.env.MASTODON_QUIET_HOURS?.trim().toLowerCase();
  if (crudo === "off") return null;
  if (!crudo) return [QUIET_FROM_HOUR, QUIET_UNTIL_HOUR];
  const partes = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(crudo);
  if (!partes) return [QUIET_FROM_HOUR, QUIET_UNTIL_HOUR];
  const desde = Number(partes[1]);
  const hasta = Number(partes[2]);
  if (desde > 23 || hasta > 24) return [QUIET_FROM_HOUR, QUIET_UNTIL_HOUR];
  return [desde, hasta];
}

/**
 * ¿Estamos en la ventana de silencio?
 *
 * Un catálogo que anuncia libros a las tres de la mañana se lee como un robot
 * descontrolado, y quien lo sigue se despierta con notificaciones. Entre las
 * 20:00 y las 09:00 (hora de Berlín, la del servicio) no salen avisos ni «me
 * gusta»: lo que vence se queda en cola y se publica al abrirse la ventana.
 */
export function enHorarioSilencioso(now: Date = new Date(), timeZone = DAY_TIME_ZONE): boolean {
  const banda = bandaSilencio();
  if (!banda) return false;
  const [desde, hasta] = banda;
  if (desde === hasta) return false;
  const hora = hourKey(now, timeZone);
  return desde < hasta ? hora >= desde && hora < hasta : hora >= desde || hora < hasta;
}

/**
 * El instante en que toca publicar algo que vencía en horario de silencio: el
 * primero permitido a partir de `desde`.
 *
 * Se avanza a pasos de un minuto en vez de sumar horas: en los cambios de
 * horario de verano, sumar milisegundos no cae a la misma hora local.
 */
export function fueraDeSilencio(desde: Date, timeZone = DAY_TIME_ZONE): Date {
  const paso = new Date(desde);
  const limite = desde.getTime() + 36 * 60 * 60 * 1000;
  while (enHorarioSilencioso(paso, timeZone) && paso.getTime() < limite) {
    paso.setTime(paso.getTime() + 60 * 1000);
  }
  return paso;
}

/** Minutos que dura la ventana de publicación (de 09:00 a 20:00). */
const VENTANA_MINUTOS = (QUIET_FROM_HOUR - QUIET_UNTIL_HOUR) * 60;

/** Cuánto va Berlín por delante de UTC en ese instante, en minutos. */
function desfaseBerlinMinutos(instante: Date): number {
  // Se trunca al minuto: con segundos, la resta no da un número entero de
  // minutos y el redondeo se comía un minuto entero (09:01 en vez de 09:00).
  const base = new Date(Math.floor(instante.getTime() / 60_000) * 60_000);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(base);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)!.value);
  const comoUtc = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour") % 24,
    valor("minute"),
  );
  return Math.round((comoUtc - base.getTime()) / 60_000);
}

/**
 * Las 09:00 de Berlín del día de `ahora`.
 *
 * Hace falta para repartir los avisos dentro de la ventana, y no vale sumar
 * horas a UTC: en el cambio de horario de verano Berlín no está a la misma
 * distancia.
 */
export function inicioDeVentana(ahora: Date): Date {
  const desfase = desfaseBerlinMinutos(ahora);
  const pared = new Date(ahora.getTime() + desfase * 60_000);
  const inicio = Date.UTC(
    pared.getUTCFullYear(),
    pared.getUTCMonth(),
    pared.getUTCDate(),
    QUIET_UNTIL_HOUR,
  );
  return new Date(inicio - desfase * 60_000);
}

/**
 * Momento del día en que sale el aviso: al azar entre las 09:00 y las 20:00.
 *
 * Se deriva del id de la fila y del día, así que el cron —que pasa cada quince
 * minutos— no cambia de idea en cada vuelta, y cada jornada toca una hora
 * distinta. Publicar siempre a las 09:00 en punto parecía un despertador.
 */
export function momentoDelAviso(semilla: string, ahora: Date): Date {
  let hash = 2166136261;
  for (const caracter of `${semilla}:${dayKey(ahora)}`) {
    hash ^= caracter.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  const minutos = (hash >>> 0) % VENTANA_MINUTOS;
  return new Date(inicioDeVentana(ahora).getTime() + minutos * 60_000);
}

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
 * Espera a que la portada subida a mano esté en disco.
 *
 * El aviso se encola en el `after()` de la misma petición que crea el ejemplar,
 * y el navegador sube la imagen **después** de recibir el id del libro. Generar
 * la tarjeta en ese instante daba un post sin portada aunque el ejemplar la
 * tuviera (pasó con «Iluminaciones», que además no tiene ISBN). Se sondea el
 * fichero —una lectura barata— en vez de pedir la portada por ISBN en cada
 * vuelta, que golpearía Open Library.
 *
 * Sin `timeoutMs` no espera: sirve para el caso de que la portada ya esté.
 * Devuelve si al final había portada subida.
 */
export async function esperarPortadaSubida(
  bookId: string,
  timeoutMs = 6_000,
  intervaloMs = 250,
): Promise<boolean> {
  // Un id que no puede tener portada subida (patrón inválido) no se espera: el
  // sondeo nunca la encontraría.
  if (!uploadedCoverPath(bookId)) return false;
  const limite = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    if (readUploadedCover(bookId)) return true;
    if (Date.now() >= limite) return false;
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
}

/**
 * Portada de la obra: la que subió quien publica el ejemplar.
 *
 * Antes había un segundo camino que la descargaba del ISBN; ya no existe, así
 * que un aviso de una obra sin portada subida sale solo con texto.
 */
export async function coverForBook(
  bookId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  return readUploadedCover(bookId);
}

/**
 * Imagen que se adjunta al aviso: la tarjeta que genera el sitio (portada
 * enmarcada sobre el verde de la casa, 1200×630) y, si esa no se puede pintar,
 * la portada suelta.
 *
 * La tarjeta se pide por HTTP al propio sitio porque la genera `next/og` en una
 * ruta; cuando falla se sigue adelante con la portada, que es mejor que dejar el
 * aviso sin imagen. En los dos casos se acaba en JPG: un PNG de 1200×630 con una
 * foto dentro pesa el triple.
 */
export async function mediaForPost(
  base: string,
  bookId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const url = `${base.replace(/\/+$/, "")}/api/og/werk/${bookId}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const png = Buffer.from(await response.arrayBuffer());
      return { data: toJpeg(png), contentType: "image/jpeg" };
    }
  } catch {
    // Sin tarjeta se intenta la portada; ver abajo.
  }
  return coverForBook(bookId);
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
  /** Quien publica el ejemplar: sostiene el tope de un aviso por persona y día. */
  ownerId?: string | null;
  /** Día del aviso; se calcula al encolar y sirve para el tope diario. */
  day?: string | null;
  /** Cuándo toca publicarlo. Sin valor, ya (el cron solo mira lo que está vencido). */
  nextAttemptAt?: Date | null;
  /**
   * Instante de referencia. Las pruebas lo fijan para no depender del reloj;
   * el servicio usa el del proceso. Sin él, una fila encolada con una fecha
   * simulada se quedaría programada en el futuro real y nadie la recogería.
   */
  now?: Date;
}): string | null {
  const id = `soc_${randomUUID()}`;
  const ahora = input.now ?? new Date();
  const cuando = (input.nextAttemptAt ?? ahora).toISOString();
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO social_outbox
         (id, network, subject, body, status, attempts, next_attempt_at, created_at,
          media_id, owner_id, day)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.network ?? SOCIAL_NETWORK,
      input.bookId,
      input.text,
      cuando,
      ahora.toISOString(),
      input.mediaId ?? null,
      input.ownerId ?? null,
      input.day ?? null,
    );
  return result.changes > 0 ? id : null;
}

/** Separación mínima entre dos avisos encolados: un día. */
export const SOCIAL_GAP_MIN_MS = 24 * 60 * 60 * 1000;
/** Separación máxima: la misma, porque el bot anuncia **un libro al día**. */
export const SOCIAL_GAP_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * Banda de separación, en minutos: `MASTODON_GAP_MINUTES="1440"`.
 *
 * Existe para poder hacer una prueba real desde la web sin esperar el turno:
 * con `0` no hay espera, cada obra se anuncia en el acto y el tope de un aviso
 * al día y la pausa entre avisos del bot quedan desactivados. Un valor raro se
 * ignora en vez de dejar la cola parada.
 */
function bandaSeparacion(): [number, number] {
  const porDefecto: [number, number] = [
    SOCIAL_GAP_MIN_MS / 60_000,
    SOCIAL_GAP_MAX_MS / 60_000,
  ];
  const crudo = process.env.MASTODON_GAP_MINUTES?.trim();
  if (!crudo) return porDefecto;
  const partes = /^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/.exec(crudo);
  if (!partes) return porDefecto;
  const min = Number(partes[1]);
  const max = partes[2] === undefined ? min : Number(partes[2]);
  return max < min ? [max, min] : [min, max];
}

/**
 * Separación aleatoria entre dos avisos: un día por defecto.
 *
 * Quien cataloga diez libros de una sentada no debe convertir su cuenta en un
 * aluvión para quien la sigue: el bot anuncia uno al día y el resto espera a su
 * jornada. La banda se puede acortar para una prueba (`MASTODON_GAP_MINUTES`),
 * y el azar se inyecta en las pruebas para que no dependan del reloj.
 */
export function separacionAviso(random: () => number = Math.random): number {
  const [min, max] = bandaSeparacion();
  return min * 60_000 + Math.round(random() * (max - min) * 60_000);
}

/**
 * Cuándo salió (o va a salir) el último aviso de la cuenta.
 *
 * Cuenta también los ya enviados: si solo se miraran los pendientes, la segunda
 * obra publicada diez segundos después de la primera volvería a salir en el acto
 * y la tanda de veinte se publicaría de golpe.
 */
function ultimoAvisoProgramado(): Date | null {
  const row = getDb()
    .prepare(
      // Las filas «en envío» no cuentan: su `next_attempt_at` es la caducidad de
      // la reclamación (cinco minutos), no el turno del aviso, y sumarla movía
      // la tanda entera cinco minutos hacia atrás en cada envío.
      `SELECT MAX(CASE WHEN status = 'sending' THEN NULL
                       ELSE COALESCE(sent_at, next_attempt_at, created_at) END) AS enviado,
              MAX(CASE WHEN status = 'pending' THEN next_attempt_at END) AS previsto
         FROM social_outbox WHERE network = ?`,
    )
    .get(SOCIAL_NETWORK) as { enviado: string | null; previsto: string | null } | undefined;
  const marcas = [row?.enviado, row?.previsto]
    .filter((valor): valor is string => Boolean(valor))
    .map((valor) => new Date(valor).getTime())
    .filter((valor) => Number.isFinite(valor));
  return marcas.length > 0 ? new Date(Math.max(...marcas)) : null;
}

/**
 * ¿Ya salió un aviso hoy (hora de Berlín)?
 *
 * El tope es de uno al día y se mira el `sent_at` real, no el día del encolado:
 * una fila encolada ayer y publicada hoy ocupa la jornada de hoy. La comparación
 * va con `dayKey` porque el instante guardado está en UTC y en Berlín puede ser
 * ya otro día.
 */
function yaPublicadoHoy(ahora: Date): boolean {
  const row = getDb()
    .prepare(
      `SELECT sent_at FROM social_outbox
        WHERE network = ? AND status = 'sent' AND sent_at IS NOT NULL
        ORDER BY sent_at DESC LIMIT 1`,
    )
    .get(SOCIAL_NETWORK) as { sent_at: string } | undefined;
  if (!row) return false;
  const enviado = new Date(row.sent_at);
  if (Number.isNaN(enviado.getTime())) return false;
  return dayKey(enviado) === dayKey(ahora);
}

/** ¿Hay algún aviso enviado con su id de Mastodon, para poder compararlo? */
function hayAvisosEnviados(): boolean {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM social_outbox
          WHERE network = ? AND status = 'sent' AND external_id IS NOT NULL
          LIMIT 1`,
      )
      .get(SOCIAL_NETWORK),
  );
}

/**
 * ¿La última entrada del perfil es también un aviso del bot?
 *
 * La cuenta puede llevar otras cosas además del bot (posts a mano, boosts). Si
 * lo último que hay es un aviso de libro, el bot espera: no encadena dos
 * entradas propias y deja que la cuenta publique otra cosa primero.
 *
 * Devuelve `true` si es del bot, `false` si hay otro contenido y `null` si no
 * se pudo comprobar (sin red, token sin `read:accounts`, instancia caída). Ante
 * la duda no se publica: el cron volverá a preguntar en la pasada siguiente.
 */
async function ultimaEntradaEsDelBot(
  config: MastodonConfig,
  fetchImpl: typeof fetch,
): Promise<boolean | null> {
  // Sin ningún aviso enviado no hay nada que comparar: se ahorra la consulta.
  if (!hayAvisosEnviados()) return false;
  try {
    const yo = await fetchImpl(`${config.instance}/api/v1/accounts/verify_credentials`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!yo.ok) return null;
    const cuenta = (await yo.json().catch(() => null)) as { id?: string } | null;
    if (!cuenta?.id) return null;
    const respuesta = await fetchImpl(
      `${config.instance}/api/v1/accounts/${encodeURIComponent(cuenta.id)}/statuses?limit=1`,
      {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
      },
    );
    if (!respuesta.ok) return null;
    const estados = (await respuesta.json().catch(() => null)) as { id?: string }[] | null;
    if (!Array.isArray(estados)) return null;
    const ultimo = estados[0]?.id;
    if (!ultimo) return false;
    return Boolean(
      getDb()
        .prepare(
          `SELECT 1 FROM social_outbox
            WHERE network = ? AND external_id = ?
            LIMIT 1`,
        )
        .get(SOCIAL_NETWORK, String(ultimo)),
    );
  } catch {
    return null;
  }
}

/** `MASTODON_GAP_MINUTES=0` es la prueba real: sin espera, sin tope diario ni pausa entre avisos. */
function sinEspera(): boolean {
  const [, max] = bandaSeparacion();
  return max === 0;
}

/**
 * Sube la imagen del aviso **justo antes de publicarlo**.
 *
 * No se sube al encolar porque un aviso puede esperar días en la cola (uno al
 * día) y Mastodon descarta los medios que no se adjuntan en 24 horas: el post saldría sin portada o fallaría. El id queda
 * anotado en la fila para que un reintento adjunte la misma imagen en vez de
 * subir otra.
 */
async function asegurarMedio(
  config: MastodonConfig,
  row: { id: string; subject: string; media_id: string | null },
  fetchImpl: typeof fetch,
): Promise<string | null> {
  if (row.media_id) return row.media_id;
  try {
    const book = getDb()
      .prepare("SELECT title, author FROM books WHERE id = ?")
      .get(row.subject) as { title: string; author: string } | undefined;
    if (!book) return null;
    const media = await mediaForPost(siteUrl(), row.subject, fetchImpl);
    if (!media) return null;
    const subida = await uploadMedia(
      config,
      {
        data: media.data,
        contentType: media.contentType,
        description: coverAlt(book.title, book.author),
      },
      fetchImpl,
    );
    if (!subida.ok) return null;
    getDb()
      .prepare("UPDATE social_outbox SET media_id = ? WHERE id = ?")
      .run(subida.id, row.id);
    return subida.id;
  } catch {
    // Sin imagen se publica igual: el aviso es lo importante.
    return null;
  }
}

/**
 * Reclama las filas que este worker va a publicar.
 *
 * El estado pasa a `sending` en la misma transacción que elige las filas, así
 * que un envío manual y el cron no publican el mismo aviso a la vez. Una
 * reclamación abandonada vuelve a `pending` pasados cinco minutos. La
 * `Idempotency-Key` sigue siendo la última red si el proceso muere justo
 * después de publicar.
 */
function claimPosts(
  db: Db,
  ahora: Date,
  limit: number,
  only: string | null,
  /**
   * Suelta la fila aunque su turno no haya vencido. Solo para la vía manual
   * (`--ahora`): el cron tiene que seguir respetando la separación entre avisos
   * para que la cuenta no parezca un robot.
   */
  force: boolean,
): {
  id: string;
  subject: string;
  body: string;
  attempts: number;
  media_id: string | null;
}[] {
  const ahoraIso = ahora.toISOString();
  const expira = new Date(ahora.getTime() + CLAIM_SECONDS * 1000).toISOString();
  return db.transaction(() => {
    db.prepare(
      `UPDATE social_outbox SET status = 'pending'
        WHERE status = 'sending' AND next_attempt_at <= ?`,
    ).run(ahoraIso);
    const rows = db
      .prepare(
        `SELECT id, subject, body, attempts, media_id
           FROM social_outbox
          WHERE network = ? AND status = 'pending'
            AND (? = 1 OR next_attempt_at <= ?)
            AND (? IS NULL OR id = ?)
          ORDER BY created_at ASC
          LIMIT ?`,
      )
      .all(
        SOCIAL_NETWORK,
        force ? 1 : 0,
        ahoraIso,
        only,
        only,
        limit,
      ) as {
      id: string;
      subject: string;
      body: string;
      attempts: number;
      media_id: string | null;
    }[];
    const claim = db.prepare(
      `UPDATE social_outbox SET status = 'sending', next_attempt_at = ?
        WHERE id = ? AND status = 'pending'`,
    );
    return rows.filter((row) => claim.run(expira, row.id).changes === 1);
  })();
}

/**
 * ¿Sigue habiendo algo que anunciar?
 *
 * Una fila puede esperar días (el bot anuncia uno al día) y en ese tiempo la
 * tiempo el ejemplar se puede pausar, retirar o moderar. Si ya no queda ninguna
 * copia viva, `/werk/<obra>` deja de ofrecer el libro y el aviso mandaría a la
 * gente a una página sin nada que pedir.
 *
 * Si la obra no está en `books` se publica igual: ningún camino del código
 * borra libros, así que un subject sin fila es un dato que falta (importación a
 * medias, prueba) y no una retirada.
 */
function sinEjemplaresVivos(subject: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM books WHERE id = @book) AS obra,
              (SELECT COUNT(*) FROM listings
                WHERE book_id = @book AND status <> 'removed') AS vivas`,
    )
    .get({ book: subject }) as { obra: number; vivas: number };
  return row.obra > 0 && row.vivas === 0;
}

/**
 * Intenta entregar los avisos pendientes. Silencioso: nunca lanza.
 *
 * `only` limita el intento a una fila concreta (la que acaba de encolar quien
 * publica), de modo que un atraso en la cola no retrasa el aviso de hoy.
 */
/**
 * ¿Esta obra tiene un aviso esperando turno? Devuelve el id de la fila, o
 * `null` si no hay nada que adelantar. Lo usa el script manual (`--ahora`):
 * adelantar un turno es tocar la cola, no volver a encolar.
 */
export function pendingPostFor(bookId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM social_outbox
        WHERE network = ? AND subject = ? AND status IN ('pending', 'sending')
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(SOCIAL_NETWORK, bookId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Texto del aviso tal y como está la obra **en el momento de publicar**.
 *
 * El cuerpo se componía al encolar, y una fila puede esperar días (el bot
 * anuncia uno al día): si mientras tanto se corrige el título o el
 * autor, el aviso salía con el dato viejo mientras la tarjeta —que se pinta al
 * publicar— ya llevaba el nuevo. Se recompone con los datos actuales y solo se
 * cae al cuerpo guardado si la obra ya no existe (entonces el aviso ni se
 * publica, lo corta `sinEjemplaresVivos`).
 *
 * `seed` sigue siendo el id: la formulación elegida no cambia entre el encolado
 * y el envío, solo los datos que se insertan en ella.
 */
function textoDelAviso(subject: string, guardado: string): string {
  const book = getDb()
    .prepare("SELECT title, author FROM books WHERE id = ?")
    .get(subject) as { title: string; author: string } | undefined;
  if (!book) return guardado;
  return composeStatus({
    title: book.title,
    author: book.author,
    url: workUrl(siteUrl(), subject),
    seed: subject,
    ...subjectsForBook(subject),
  });
}

export async function processSocialOutbox(
  options: {
    limit?: number;
    only?: string;
    config?: MastodonConfig | null;
    fetchImpl?: typeof fetch;
    /** Instante de referencia (las pruebas lo fijan; el servicio usa el reloj). */
    now?: Date;
    /**
     * Publica esa fila ya: ni turno ni horario de silencio. Es la vía manual de
     * la administración (`npm run mastodon:test -- --ahora <obra>`) para sacar
     * un aviso concreto sin esperar a que le toque; exige `only`, para que el
     * cron no pueda saltarse la separación entre avisos por descuido.
     */
    force?: boolean;
  } = {},
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const config = options.config === undefined ? mastodonConfig() : options.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 3;
  const force = Boolean(options.force && options.only);
  if (!config) return { sent: 0, failed: 0, skipped: true };
  // El mismo instante para decidir qué está vencido y para anotar el envío:
  // si se mezclara con el reloj de SQLite, una prueba con fecha simulada no
  // recogería lo que ella misma acaba de encolar.
  const ahora = options.now ?? new Date();
  // De noche no se publica nada: lo que vence se queda en cola y sale al
  // abrirse la ventana (el cron pasará a las 09:00 y lo verá vencido). La vía
  // manual sí puede: quien la usa lo pide a propósito.
  if (!force && enHorarioSilencioso(ahora)) {
    return { sent: 0, failed: 0, skipped: true };
  }
  // Un libro al día: si el aviso de hoy ya salió, lo que vence se queda en cola
  // para mañana. La vía manual (`force`) y la prueba con `MASTODON_GAP_MINUTES=0`
  // se lo saltan a propósito.
  if (!force && !sinEspera() && yaPublicadoHoy(ahora)) {
    return { sent: 0, failed: 0, skipped: true };
  }
  const db = getDb();
  if (!force && !sinEspera()) {
    // La fila más antigua vencida es la que saldría. Si no hay ninguna, no hay
    // nada que consultar ni que publicar.
    const siguiente = db
      .prepare(
        `SELECT id FROM social_outbox
          WHERE network = ? AND status = 'pending' AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC, created_at ASC LIMIT 1`,
      )
      .get(SOCIAL_NETWORK, ahora.toISOString()) as { id: string } | undefined;
    if (!siguiente) return { sent: 0, failed: 0, skipped: true };
    // No dos avisos del bot seguidos: si la última entrada del perfil también
    // es suya, se espera a que la cuenta publique otra cosa. Ante la duda (la
    // instancia no contesta, al token le falta un permiso) tampoco se publica.
    if ((await ultimaEntradaEsDelBot(config, fetchImpl)) !== false) {
      return { sent: 0, failed: 0, skipped: true };
    }
    // La hora del aviso se sortea cada día dentro de la ventana: si a la fila
    // que toca le ha caído más tarde, el cron espera en vez de publicar a las
    // 09:00 en punto. La vía manual (`only`) y la prueba con
    // `MASTODON_GAP_MINUTES=0` no esperan.
    if (!options.only && momentoDelAviso(siguiente.id, ahora) > ahora) {
      return { sent: 0, failed: 0, skipped: true };
    }
  }
  // Con el tope activo se reclama **una** fila por pasada: si se reclamaran
  // varias, el bucle las publicaría todas en el mismo minuto y el tope no
  // serviría de nada. Las demás quedan pendientes para los días siguientes.
  const cuantas = force || sinEspera() ? limit : 1;
  const rows = claimPosts(db, ahora, cuantas, options.only ?? null, force);

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    // La obra se retiró mientras esperaba su turno: no se anuncia una página
    // sin ejemplares. La fila queda cerrada con el motivo, no reintentando.
    if (sinEjemplaresVivos(row.subject)) {
      db.prepare(
        "UPDATE social_outbox SET status = 'failed', last_error = ? WHERE id = ?",
      ).run("La obra ya no tiene ejemplares: no se anuncia.", row.id);
      failed += 1;
      continue;
    }
    const mediaId = await asegurarMedio(config, row, fetchImpl);
    const result = await postStatus(config, textoDelAviso(row.subject, row.body), row.id, {
      mediaIds: mediaId ? [mediaId] : [],
      fetchImpl,
    });
    if (result.ok) {
      db.prepare(
        `UPDATE social_outbox
            SET status = 'sent', external_id = ?, external_url = ?,
                last_error = NULL, sent_at = ?
          WHERE id = ?`,
      ).run(result.id, result.url || null, ahora.toISOString(), row.id);
      sent += 1;
      continue;
    }
    const attempts = row.attempts + 1;
    const finalFailure = attempts >= MAX_ATTEMPTS || !result.retryable;
    const delaySeconds = Math.min(3600, 2 ** attempts * 60);
    const reintento = new Date(ahora.getTime() + delaySeconds * 1000).toISOString();
    db.prepare(
      `UPDATE social_outbox
          SET attempts = ?, status = ?, last_error = ?, next_attempt_at = ?
        WHERE id = ?`,
    ).run(
      attempts,
      finalFailure ? "failed" : "pending",
      // El error de Mastodon se guarda tal cual: es lo que se mira cuando un
      // post no sale («Text exceeds 500 characters», «Invalid access token»).
      result.error.slice(0, 300),
      reintento,
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
 *
 * Solo la administración anuncia: el perfil del bot cuenta lo que cataloga el
 * equipo, no lo que ofrece la comunidad. Sin `isAdmin` no se encola nada.
 *
 * Con `ownerId`, además, solo se anuncia **un libro por persona y día**: quien
 * cataloga su estantería de una sentada no convierte el perfil en una lista de
 * la compra. Se publica el primero y los demás se quedan sin aviso.
 */
/**
 * Tema del libro para las etiquetas del aviso: la categoría y las etiquetas
 * curadas que haya puesto quien publica.
 *
 * La obra puede no estar todavía en la base (el alta se prueba con ids
 * inventados) o no traer etiquetas; en ese caso queda la categoría y, si
 * tampoco hay, la composición usa dos etiquetas de lectura.
 */
export function subjectsForBook(bookId: string): { category: string | null; tags: string[] } {
  const book = getDb()
    .prepare("SELECT category FROM books WHERE id = ?")
    .get(bookId) as { category: string } | undefined;
  const tags = getDb()
    .prepare(
      `SELECT DISTINCT lt.tag FROM listing_tags lt
         JOIN listings l ON l.id = lt.listing_id
        WHERE l.book_id = ?
        ORDER BY lt.tag`,
    )
    .all(bookId) as { tag: string }[];
  return { category: book?.category ?? null, tags: tags.map((row) => row.tag) };
}

export async function announceBook(input: {
  bookId: string;
  title: string;
  author: string;
  base: string;
  /**
   * Quien publica tiene que ser administración: es la única puerta de entrada a
   * la cola. Va como dato obligatorio (y no como opcional) para que una llamada
   * nueva no se cuele por olvido: sin él, `announceBook` no hace nada.
   */
  isAdmin: boolean;
  /** Quien publica el ejemplar. Sin él no se aplica el tope diario. */
  ownerId?: string | null;
  /**
   * El formulario sube una portada justo después de crear el ejemplar: el
   * aviso tiene que esperarla o la tarjeta se pinta sin ella.
   */
  esperarPortada?: boolean;
  /**
   * Sin tope de un aviso al día (solo para la administración, que cataloga
   * fondos enteros). El tope existe para no inundar la instancia desde una
   * cuenta cualquiera.
   */
  sinTopeDiario?: boolean;
  /** Instante del aviso; las pruebas lo fijan para no depender del reloj. */
  now?: Date;
}): Promise<{ queued: boolean; sent: boolean; media: boolean }> {
  try {
    // Primera puerta, antes de mirar el token o esperar la portada: una cuenta
    // de la comunidad no llega a la cola ni deja trabajo a medias.
    if (!input.isAdmin) return { queued: false, sent: false, media: false };
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

    // Si la obra ya tiene aviso, se sale antes de subir nada: una imagen subida
    // y nunca adjunta se queda huérfana en la biblioteca de medios de la cuenta.
    const already = getDb()
      .prepare("SELECT 1 FROM social_outbox WHERE network = ? AND subject = ?")
      .get(SOCIAL_NETWORK, input.bookId);
    if (already) return { queued: false, sent: false, media: false };

    // Un aviso por persona y día: el primero que llegue es el que se publica.
    // La administración queda fuera (cataloga fondos enteros y cada obra nueva
    // merece su aviso), pero la clave única por obra sigue impidiendo repetir.
    const day = dayKey(input.now ?? new Date());
    if (input.ownerId && !input.sinTopeDiario) {
      const today = getDb()
        .prepare("SELECT 1 FROM social_outbox WHERE network = ? AND owner_id = ? AND day = ?")
        .get(SOCIAL_NETWORK, input.ownerId, day);
      if (today) return { queued: false, sent: false, media: false };
    }

    const text = composeStatus({
      title: input.title,
      author: input.author,
      url: workUrl(input.base, input.bookId),
      seed: input.bookId,
      ...subjectsForBook(input.bookId),
    });

    // ¿La obra tiene ISBN? Entonces hay portada de respaldo (Open Library) y no
    // merece la pena esperar a la subida tanto como cuando no la hay.
    if (input.esperarPortada) {
      const fila = getDb()
        .prepare("SELECT isbn FROM books WHERE id = ?")
        .get(input.bookId) as { isbn: string | null } | undefined;
      // Si el formulario sube una portada, el aviso tiene que esperarla: la
      // petición de subida sale **después** de crear el ejemplar y sin esta
      // espera la tarjeta se pinta sin ella (pasó con «Iluminaciones»).
      await esperarPortadaSubida(input.bookId, fila?.isbn ? 1_500 : 6_000);
    }

    // La imagen **no** se sube aquí: un aviso puede esperar días en la cola y
    // Mastodon borra los medios sin adjuntar en 24 h. La sube `asegurarMedio`
    // justo antes de publicarlo (ver `processSocialOutbox`).

    // Un aviso detrás de otro, pero no a la vez: quien publica diez libros de una
    // sentada tiene su primer aviso en el acto y los demás en cola, uno por día
    // (`separacionAviso`). Así el catálogo crece sin que la cuenta parezca un
    // robot que escupe veinte posts seguidos.
    // El tope es de la cuenta, no de la persona: da igual quién haya publicado
    // hoy, el siguiente aviso espera a la jornada siguiente.
    const anterior = ultimoAvisoProgramado();
    const ahora = input.now ?? new Date();
    // El turno es el de la jornada siguiente. La hora exacta **no** se fija
    // aquí: el cron la sortea dentro de la ventana (`momentoDelAviso`), así que
    // solo se marca el día, a las 09:00, y el aviso espera su minuto.
    const candidato = anterior ? anterior.getTime() + separacionAviso() : 0;
    const turno =
      anterior && candidato > ahora.getTime() ? inicioDeVentana(new Date(candidato)) : null;
    const cuando = turno ?? (enHorarioSilencioso(ahora) ? fueraDeSilencio(ahora) : null);

    const id = enqueuePost({
      bookId: input.bookId,
      text,
      ownerId: input.ownerId,
      day,
      nextAttemptAt: cuando,
      now: ahora,
    });
    if (!id) return { queued: false, sent: false, media: false };
    // Con turno futuro no se intenta: lo soltará el cron cuando venza.
    if (!cuando) {
      // Se intenta esa fila y no la más antigua: un atraso en la cola (la
      // instancia caída ayer) no puede retrasar el aviso de hoy.
      const { sent } = await processSocialOutbox({ limit: 1, only: id, config, now: ahora });
      const fila = getDb()
        .prepare("SELECT media_id FROM social_outbox WHERE id = ?")
        .get(id) as { media_id: string | null } | undefined;
      return { queued: true, sent: sent > 0, media: Boolean(fila?.media_id) };
    }
    return { queued: true, sent: false, media: false };
  } catch {
    // Un fallo aquí no puede dejar a medias la publicación: la cola se queda
    // pendiente y el cron lo reintenta.
    return { queued: false, sent: false, media: false };
  }
}
