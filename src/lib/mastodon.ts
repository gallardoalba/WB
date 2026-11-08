/**
 * Bot de Mastodon: publica un aviso cada vez que una obra entra en el catálogo.
 *
 * Seis decisiones que explican el resto del fichero:
 *
 * - **Registro sobrio.** Sin emoji, sin exclamaciones y sin superlativos: una
 *   frase enunciativa, el enlace y tres etiquetas. Es la voz de una biblioteca,
 *   no la de una promoción.
 * - **Cincuenta formulaciones por idioma** y **etiquetas variables**. Un perfil
 *   que repite la misma frase y las mismas tres etiquetas parece un robot. La
 *   variante se elige con el id de la obra, así que el mismo libro siempre se
 *   anuncia igual y lo que se ve en la cola es lo que se publica.
 * - **Cola en la base, no una llamada suelta.** Publicar un libro no puede
 *   depender de que mastodon.social conteste ahora: si falla, el post se pierde
 *   y nadie se entera. Se encola (`social_outbox`) y lo intenta el `after()` de
 *   la petición y, si queda algo, el cron de mantenimiento.
 * - **Un post por obra, no por ejemplar.** Si tres personas ponen el mismo
 *   libro, el perfil no repite el aviso: la tabla tiene una clave única por red
 *   y obra y el segundo `INSERT` se descarta.
 * - **Nada de datos personales.** Título, autoría, portada y enlace. Ni ciudad,
 *   ni nombre de quien publica: la ciudad está en la ficha y quien quiera verla
 *   entra.
 *
 * El idioma del aviso es el del ejemplar; «Otro» y «No especificado» caen al
 * alemán, que es el idioma de la casa. Sin `MASTODON_TOKEN` no hay bot: no se
 * encola nada y el proceso queda apagado.
 */
import { randomUUID } from "node:crypto";

import { toJpeg } from "./cover-convert";
import { getCover, readUploadedCover, uploadedCoverPath } from "./covers";
import { getDb } from "./db";
import { DEFAULT_LOCALE, localePath, type Locale } from "./locale";
import { siteUrl } from "./site";

/** Red social del post. La tabla admite más; hoy solo hay esta. */
export const SOCIAL_NETWORK = "mastodon";

/** Un estado de Mastodon admite 500 caracteres. */
export const STATUS_LIMIT = 500;

/** Mastodon corta las descripciones de medios a 1500 caracteres. */
const ALT_LIMIT = 1500;

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

/** De 22:00 a 09:00 (hora de Berlín) el bot no publica nada. */
export const QUIET_FROM_HOUR = 22;
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
 * 22:00 y las 09:00 (hora de Berlín, la del servicio) no salen avisos ni «me
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
export type Lead = (title: string, author: string) => string;

/**
 * Voz del bot por idioma: cincuenta formulaciones enunciativas.
 *
 * No vive en `i18n.ts` porque el diccionario es de **interfaz** y esto es
 * contenido con marcadores: aquí se compone una frase con el título y la
 * autoría, igual que `technical.ts` compone su documentación por idioma.
 *
 * Reglas de estilo, para que las cincuenta suenen a la misma voz:
 *
 * - Una sola frase, enunciativa, sin emoji ni exclamaciones.
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
    (title, author) => `Heute im Katalog: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} ist eingezogen.`,
    (title, author) => `Ein neuer Titel im Regal: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} wartet auf eine Leserin oder einen Leser.`,
    (title, author) => `Verfügbar ab heute: „${title}“ von ${author}.`,
    (title, author) => `Frisch im Katalog: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} lässt sich ab heute ausleihen.`,
    (title, author) => `Das Regal hat Zuwachs: „${title}“ von ${author}.`,
    (title, author) => `Von Hand zu Hand: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author}, neu im gemeinsamen Bestand.`,
    (title, author) => `Aufgenommen: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} ist jetzt verfügbar.`,
    (title, author) => `Ein Buch mehr auf dem Regal: „${title}“ von ${author}.`,
    (title, author) => `Der gemeinsame Bestand wächst: „${title}“ von ${author}.`,
    (title, author) => `Heute eingestellt: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} sucht ein neues Zuhause.`,
    (title, author) => `„${title}“ von ${author}, ab heute im Bestand.`,
    (title, author) => `Neu im Verzeichnis: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} ist da.`,
    (title, author) => `Wieder ein Buch, das weiterreisen möchte: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} bereichert den Bestand.`,
    (title, author) => `Eintrag ergänzt: „${title}“ von ${author}.`,
    (title, author) => `Lesen und weitergeben: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} steht bereit.`,
    (title, author) => `Das Verzeichnis wächst: „${title}“ von ${author}.`,
    (title, author) => `Neu eingetragen und zu haben: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} gehört ab jetzt dazu.`,
    (title, author) => `Ein Werk mehr im Katalog: „${title}“ von ${author}.`,
    (title, author) => `„${title}“ von ${author} ist eingetroffen und wartet.`,
    (title, author) => `Im Bestand seit heute: „${title}“ von ${author}.`,
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
    (title, author) => `Hoy entra en la estantería: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, ya está disponible.`,
    (title, author) => `Un libro más en la estantería: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, espera a su próxima lectura.`,
    (title, author) => `Sumamos «${title}», de ${author}, al catálogo.`,
    (title, author) => `«${title}», de ${author}, se une al catálogo.`,
    (title, author) => `Disponible para intercambio: «${title}», de ${author}.`,
    (title, author) => `La estantería recibe «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, disponible desde hoy.`,
    (title, author) => `Nueva incorporación: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, encuentra su lugar en la estantería.`,
    (title, author) => `Otro título disponible: «${title}», de ${author}.`,
    (title, author) => `El catálogo se amplía con «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, entra en circulación.`,
    (title, author) => `Acaba de registrarse: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, listo para su próximo lector.`,
    (title, author) => `Se añade «${title}», de ${author}, al fondo.`,
    (title, author) => `«${title}», de ${author}, ya puede solicitarse.`,
    (title, author) => `Un título más para compartir: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, pasa a estar disponible.`,
    (title, author) => `El fondo bibliográfico crece: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, disponible en la estantería.`,
    (title, author) => `Registro nuevo: «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, aguarda nuevas lecturas.`,
    (title, author) => `Incorporamos «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, disponible desde este momento.`,
    (title, author) => `La comunidad suma «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, en el catálogo desde hoy.`,
    (title, author) => `Se estrena en la estantería «${title}», de ${author}.`,
    (title, author) => `«${title}», de ${author}, a disposición de los lectores.`,
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
    (title, author) => `“${title}” by ${author} has arrived on the shelf.`,
    (title, author) => `A further title is available: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is now available.`,
    (title, author) => `The shelf receives “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} takes its place on the shelf.`,
    (title, author) => `Just added: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is ready for its next reader.`,
    (title, author) => `The collection grows: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author}, available from this moment.`,
    (title, author) => `Another title to share: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} enters circulation.`,
    (title, author) => `The library gains “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is now part of the shared library.`,
    (title, author) => `Posted today: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} can now be requested.`,
    (title, author) => `One more book on the shelf: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is waiting to be read.`,
    (title, author) => `A new arrival: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author}, now listed in the catalogue.`,
    (title, author) => `The catalogue expands with “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} joins the shared shelf.`,
    (title, author) => `Available for exchange: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is at the readers' disposal.`,
    (title, author) => `Newly registered: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} becomes available today.`,
    (title, author) => `The collection welcomes “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author}, from one reader to the next.`,
    (title, author) => `Listed in the catalogue: “${title}” by ${author}.`,
    (title, author) => `“${title}” by ${author} is ready to travel.`,
    (title, author) => `“${title}” by ${author} is now on the shared shelf.`,
  ],
};

/**
 * Etiquetas disponibles por idioma. La primera es la de la casa y va siempre;
 * de las demás se eligen dos, de modo que la combinación cambia de un libro a
 * otro sin salirse nunca de etiquetas que se usan de verdad.
 */
const TAG_POOLS: Record<Locale, string[]> = {
  de: ["Wanderbibliothek", "Bücher", "Büchertausch", "Lesen", "Bibliothek", "Literatur", "Buch"],
  es: ["Wanderbibliothek", "Libros", "IntercambioDeLibros", "Lectura", "Biblioteca", "Literatura", "Libro"],
  en: ["Wanderbibliothek", "Books", "BookSwap", "Reading", "Library", "Literature", "Bookstodon"],
};

/** Texto alternativo de la portada: lo lee quien no ve la imagen. */
const ALT: Record<Locale, (title: string, author: string) => string> = {
  de: (title, author) => `Buchcover von „${title}“ von ${author}`,
  es: (title, author) => `Portada de «${title}» de ${author}`,
  en: (title, author) => `Cover of “${title}” by ${author}`,
};

/**
 * Elige una entrada con un hash del id de la obra.
 *
 * Determinista a propósito: el mismo libro da siempre el mismo texto, así que lo
 * que se ve en la cola es lo que se publica y un reintento no cambia el aviso.
 * El segundo argumento («sal») separa los sorteos: la frase y las etiquetas de
 * un mismo libro no van correlacionadas.
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

/** Las formulaciones de un idioma (las del idioma base si no lo hay). */
export function leadVariants(locale: Locale): Lead[] {
  return LEADS[locale] ?? LEADS[DEFAULT_LOCALE];
}

/** Las etiquetas entre las que se elige, con la de la casa siempre delante. */
export function tagPool(locale: Locale): string[] {
  return TAG_POOLS[locale] ?? TAG_POOLS[DEFAULT_LOCALE];
}

/**
 * Tres etiquetas: la de la casa y dos más del fondo, elegidas con el id de la
 * obra. Dos libros seguidos no repiten combinación, y el reparto es amplio
 * (seis candidatas, dos sin repetir: quince parejas posibles por idioma).
 */
export function hashtagsFor(locale: Locale, seed: string): string[] {
  const [brand, ...rest] = tagPool(locale);
  const first = variantIndex(`${seed}|tag-a`, rest.length);
  const secondRaw = variantIndex(`${seed}|tag-b`, rest.length - 1);
  // Se salta la elegida para que nunca coincidan.
  const second = secondRaw >= first ? secondRaw + 1 : secondRaw;
  return [brand ?? "Wanderbibliothek", rest[first] ?? rest[0]!, rest[second] ?? rest[0]!];
}

export type PostInput = {
  title: string;
  author: string;
  /** Enlace público a la obra, ya con el prefijo de idioma. */
  url: string;
  locale: Locale;
  /** Id de la obra: decide la variante del texto y las etiquetas. */
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
  const tags = hashtagsFor(locale, input.seed)
    .map((tag) => `#${tag}`)
    .join(" ");
  const tail = `\n\n${input.url}\n\n${tags}`;
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
}): string | null {
  const id = `soc_${randomUUID()}`;
  const cuando = (input.nextAttemptAt ?? new Date()).toISOString();
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO social_outbox
         (id, network, subject, body, status, attempts, next_attempt_at, created_at,
          media_id, owner_id, day)
       VALUES (?, ?, ?, ?, 'pending', 0, ?,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?)`,
    )
    .run(
      id,
      input.network ?? SOCIAL_NETWORK,
      input.bookId,
      input.text,
      cuando,
      input.mediaId ?? null,
      input.ownerId ?? null,
      input.day ?? null,
    );
  return result.changes > 0 ? id : null;
}

/** Separación mínima entre dos avisos encolados: 2 horas. */
export const SOCIAL_GAP_MIN_MS = 2 * 60 * 60 * 1000;
/** Separación máxima entre dos avisos encolados: 3 horas. */
export const SOCIAL_GAP_MAX_MS = 3 * 60 * 60 * 1000;

/**
 * Banda de separación, en minutos: `MASTODON_GAP_MINUTES="120-180"`.
 *
 * Existe para poder hacer una prueba real desde la web sin esperar el turno:
 * con `0` no hay espera y cada obra se anuncia en el acto. Un valor raro se
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
 * Separación aleatoria entre dos avisos: entre 2 y 3 horas por defecto.
 *
 * Quien cataloga diez libros de una sentada no debe convertir su cuenta en un
 * aluvión para quien la sigue, y un hueco fijo parecería programado. El azar se
 * inyecta en las pruebas para que no dependan del reloj ni de la suerte.
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
      `SELECT MAX(COALESCE(sent_at, next_attempt_at, created_at)) AS enviado,
              MAX(next_attempt_at) AS previsto
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
 * Sube la imagen del aviso **justo antes de publicarlo**.
 *
 * No se sube al encolar porque un aviso puede esperar horas o días en la cola
 * (una tanda va separada 2–3 horas) y Mastodon descarta los medios que no se
 * adjuntan en 24 horas: el post saldría sin portada o fallaría. El id queda
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
      .prepare("SELECT title, author, language FROM books WHERE id = ?")
      .get(row.subject) as
      | { title: string; author: string; language: string | null }
      | undefined;
    if (!book) return null;
    const media = await mediaForPost(siteUrl(), row.subject, fetchImpl);
    if (!media) return null;
    const locale = localeForLanguage(book.language);
    const subida = await uploadMedia(
      config,
      {
        data: media.data,
        contentType: media.contentType,
        description: coverAlt(locale, book.title, book.author),
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
    /** Instante de referencia (las pruebas lo fijan; el servicio usa el reloj). */
    now?: Date;
  } = {},
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const config = options.config === undefined ? mastodonConfig() : options.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 3;
  if (!config) return { sent: 0, failed: 0, skipped: true };
  // De noche no se publica nada: lo que vence se queda en cola y sale al
  // abrirse la ventana (el cron pasará a las 09:00 y lo verá vencido).
  if (enHorarioSilencioso(options.now ?? new Date())) {
    return { sent: 0, failed: 0, skipped: true };
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, subject, body, attempts, media_id
         FROM social_outbox
        WHERE network = ? AND status = 'pending'
          AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND (? IS NULL OR id = ?)
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(SOCIAL_NETWORK, options.only ?? null, options.only ?? null, limit) as {
    id: string;
    subject: string;
    body: string;
    attempts: number;
    media_id: string | null;
  }[];

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const mediaId = await asegurarMedio(config, row, fetchImpl);
    const result = await postStatus(config, row.body, row.id, {
      mediaIds: mediaId ? [mediaId] : [],
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
 *
 * Con `ownerId`, además, solo se anuncia **un libro por persona y día**: quien
 * cataloga su estantería de una sentada no convierte el perfil en una lista de
 * la compra. Se publica el primero y los demás se quedan sin aviso.
 */
export async function announceBook(input: {
  bookId: string;
  title: string;
  author: string;
  language?: string | null;
  base: string;
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

    const locale = localeForLanguage(input.language);
    const text = composeStatus({
      title: input.title,
      author: input.author,
      url: workUrl(input.base, input.bookId, locale),
      locale,
      seed: input.bookId,
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
    // sentada tiene su primer aviso en el acto y los demás en cola, separados
    // entre 2 y 3 horas (`separacionAviso`). Así el catálogo crece sin que la
    // cuenta parezca un robot que escupe veinte posts seguidos.
    const anterior = input.ownerId ? ultimoAvisoProgramado() : null;
    const ahora = input.now ?? new Date();
    const candidato = anterior ? anterior.getTime() + separacionAviso() : 0;
    // Ni de noche ni a las 09:00 justas si el hueco vencía de madrugada: el
    // turno se empuja hasta la primera hora permitida. Un aviso que nace de
    // madrugada se encola ya para las 09:00, sin intentar publicarlo.
    const turno =
      anterior && candidato > ahora.getTime() ? fueraDeSilencio(new Date(candidato)) : null;
    const cuando = turno ?? (enHorarioSilencioso(ahora) ? fueraDeSilencio(ahora) : null);

    const id = enqueuePost({
      bookId: input.bookId,
      text,
      ownerId: input.ownerId,
      day,
      nextAttemptAt: cuando,
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
