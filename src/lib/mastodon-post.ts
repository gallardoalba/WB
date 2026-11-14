/**
 * Composición del aviso de Mastodon: texto, etiquetas y enlace.
 *
 * Vive aparte del bot (`mastodon.ts`) para que también lo use la migración que
 * reescribe los avisos que ya esperan en la cola: así no hay dependencias
 * circulares con la base de datos. Aquí no se lee la base ni se sale a la red;
 * todo entra como datos y el resultado es determinista.
 *
 * **Siempre en alemán.** El perfil se dirige al público alemán, así que el aviso
 * no cambia de idioma con el ejemplar.
 */
import type { Category, Tag } from "./domain";

/** Un estado de Mastodon admite 500 caracteres. */
export const STATUS_LIMIT = 500;

/** Mastodon corta las descripciones de medios a 1500 caracteres. */
const ALT_LIMIT = 1500;

/** Una forma de empezar el aviso. Recibe el título y la autoría ya limpios. */
export type Lead = (title: string, author: string) => string;

/**
 * Voz del bot: cien formulaciones enunciativas, siempre en alemán.
 *
 * No vive en `i18n.ts` porque el diccionario es de **interfaz** y esto es
 * contenido con marcadores: aquí se compone una frase con el título y la
 * autoría, igual que `technical.ts` compone su documentación.
 *
 * Reglas de estilo, para que las cien suenen a la misma voz:
 *
 * - Una sola frase, enunciativa y seria, sin emoji ni exclamaciones.
 * - Nada de superlativos ni de promesas que la plataforma no hace: el texto dice
 *   lo único cierto, que ese libro está y puede leerse.
 * - Comillas tipográficas alemanas («„X“»).
 * - «Bestand», «Katalog», «Regal», «Verzeichnis» y «Sammlung» se alternan como
 *   sinónimos de biblioteca; no se habla de comprar ni de vender.
 */
const LEADS: Lead[] = [
  (title, author) => `Neu im gemeinsamen Regal: „${title}“ von ${author}.`,
  (title, author) => `Soeben eingetroffen: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist ab heute im Katalog.`,
  (title, author) => `Der Katalog wächst um „${title}“ von ${author}.`,
  (title, author) => `Neu aufgenommen: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} steht jetzt im Regal.`,
  (title, author) => `Ab heute verfügbar: „${title}“ von ${author}.`,
  (title, author) => `Eingestellt und zur Weitergabe freigegeben: „${title}“ von ${author}.`,
  (title, author) => `Dem gemeinsamen Regal hinzugefügt: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} sucht neue Leserinnen und Leser.`,
  (title, author) => `Ein weiteres Buch im Regal: „${title}“ von ${author}.`,
  (title, author) => `Neu in der Wanderbibliothek: „${title}“ von ${author}.`,
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
  (title, author) => `Neu im Katalog: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} lässt sich ab heute weitergeben.`,
  (title, author) => `Das Regal hat Zuwachs: „${title}“ von ${author}.`,
  (title, author) => `Von Hand zu Hand: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author}, neu im gemeinsamen Bestand.`,
  (title, author) => `Aufgenommen: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist jetzt verfügbar.`,
  (title, author) => `Ein Buch mehr im Regal: „${title}“ von ${author}.`,
  (title, author) => `Der gemeinsame Bestand wächst: „${title}“ von ${author}.`,
  (title, author) => `Heute eingestellt: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist für die nächste Leserschaft bereit.`,
  (title, author) => `„${title}“ von ${author}, ab heute im Bestand.`,
  (title, author) => `Neu im Verzeichnis: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist im Bestand angekommen.`,
  (title, author) => `Ein weiteres Buch für das gemeinsame Regal: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} bereichert den Bestand.`,
  (title, author) => `Eintrag ergänzt: „${title}“ von ${author}.`,
  (title, author) => `Lesen und weitergeben: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} steht bereit.`,
  (title, author) => `Das Verzeichnis wächst: „${title}“ von ${author}.`,
  (title, author) => `Neu eingetragen: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist jetzt Teil der Sammlung.`,
  (title, author) => `Ein Werk mehr im Katalog: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist eingetroffen und wartet.`,
  (title, author) => `Im Bestand seit heute: „${title}“ von ${author}.`,
  (title, author) => `Neu verzeichnet: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} wurde in den Katalog aufgenommen.`,
  (title, author) => `Der Katalog verzeichnet jetzt „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist ab sofort im Bestand zu finden.`,
  (title, author) => `Das gemeinsame Regal erhält „${title}“ von ${author}.`,
  (title, author) => `Mit „${title}“ von ${author} wächst der Bestand.`,
  (title, author) => `„${title}“ von ${author} kann ab heute weitergegeben werden.`,
  (title, author) => `Ein weiterer Titel wartet im Regal: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist in den Bestand eingegangen.`,
  (title, author) => `Der Bestand umfasst jetzt auch „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} steht für neue Leserinnen und Leser bereit.`,
  (title, author) => `Im gemeinsamen Regal findet sich jetzt „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} wurde heute aufgenommen.`,
  (title, author) => `Zur Weitergabe verfügbar: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ergänzt den Katalog.`,
  (title, author) => `Neu im Verzeichnis der Wanderbibliothek: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist ab heute Teil des Bestands.`,
  (title, author) => `Der Katalog nennt einen neuen Titel: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} bereichert das gemeinsame Regal.`,
  (title, author) => `Ab heute im gemeinsamen Bestand: „${title}“ von ${author}.`,
  (title, author) => `Ein neuer Band im Regal: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} steht im Katalog.`,
  (title, author) => `Der Bestand hat einen neuen Eintrag: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist ab sofort verfügbar.`,
  (title, author) => `Neu auf dem Regal der Wanderbibliothek: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} wurde eingetragen.`,
  (title, author) => `Zum Tausch freigegeben: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist im Katalog verzeichnet.`,
  (title, author) => `Das Regal der Gemeinschaft wächst um „${title}“ von ${author}.`,
  (title, author) => `Neu eingestellt im Regal: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} wurde in die Wanderbibliothek eingetragen.`,
  (title, author) => `Der Katalog führt jetzt „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist bereit für die nächste Leserschaft.`,
  (title, author) => `Ein neues Werk im Bestand: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} gehört von nun an zum Bestand.`,
  (title, author) => `Seit heute im Katalog: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist ein neuer Titel im gemeinsamen Regal.`,
  (title, author) => `Der Bestand wurde um „${title}“ von ${author} erweitert.`,
  (title, author) => `Neu im gemeinsamen Katalog: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ergänzt die Sammlung.`,
  (title, author) => `Das gemeinsame Regal umfasst nun „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} lässt sich ab heute weiterreichen.`,
  (title, author) => `Die Wanderbibliothek verzeichnet „${title}“ von ${author}.`,
  (title, author) => `Der Katalog wurde um „${title}“ von ${author} ergänzt.`,
  (title, author) => `„${title}“ von ${author} ist ab jetzt im gemeinsamen Regal.`,
  (title, author) => `Ein Titel mehr im Verzeichnis: „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} ist neu im Bestand.`,
  (title, author) => `Das Verzeichnis führt „${title}“ von ${author}.`,
  (title, author) => `„${title}“ von ${author} steht zur Weitergabe bereit.`,
  (title, author) => `„${title}“ von ${author} ist ab heute im gemeinsamen Katalog.`,
];

/** La etiqueta de la casa: va siempre, y la primera. */
const BRAND_TAG = "Wanderbibliothek";

/**
 * Etiquetas de lectura y biblioteca. Describen el uso del libro —leer,
 * prestar, intercambiar, recomendar—, no su venta: ni librerías ni tiendas.
 */
const READING_TAGS = [
  "Bücher",
  "Lesen",
  "Lesekreis",
  "Bibliothek",
  "Büchertausch",
  "Buchtipp",
];

/**
 * Cada etiqueta temática del catálogo, en su forma alemana para el fediverso.
 *
 * Se mantiene el nombre propio del área de conocimiento («Philosophie»,
 * «Geschichte», …), que es lo que se sigue en Mastodon para descubrir lecturas.
 */
const SUBJECT_HASHTAGS: Record<Tag, string> = {
  Historia: "Geschichte",
  Filosofía: "Philosophie",
  Ensayo: "Essay",
  Literatura: "Literatur",
  Lengua: "Sprache",
  Arte: "Kunst",
  Música: "Musik",
  Religión: "Religion",
  Poesía: "Lyrik",
  Teatro: "Theater",
  Clásicos: "Klassiker",
  Narrativa: "Belletristik",
  Divulgación: "Sachbuch",
  Física: "Physik",
  Química: "Chemie",
  Biología: "Biologie",
  Matemáticas: "Mathematik",
  Astronomía: "Astronomie",
  Medicina: "Medizin",
  Informática: "Informatik",
  Ingeniería: "Technik",
  Sociología: "Soziologie",
  Política: "Politik",
  Economía: "Wirtschaft",
  Derecho: "Recht",
  Antropología: "Anthropologie",
  Psicología: "Psychologie",
  Educación: "Bildung",
};

/** Cuando el ejemplar no trae etiquetas, la categoría da el tema. */
const CATEGORY_HASHTAGS: Record<Category, string> = {
  Humanidades: "Geisteswissenschaften",
  "Ciencias y técnica": "Wissenschaft",
  "Sociedad y política": "Gesellschaft",
  Biografías: "Biografie",
  Ficción: "Belletristik",
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

/** Las formulaciones del aviso. */
export function leadVariants(): Lead[] {
  return LEADS;
}

/** Las etiquetas de lectura entre las que se elige. */
export function readingTags(): string[] {
  return READING_TAGS;
}

/** Tema del libro: sus etiquetas curadas o, si no las hay, su categoría. */
export function subjectHashtags(subjects: {
  category?: string | null;
  tags?: readonly string[];
}): string[] {
  const fromTags = (subjects.tags ?? [])
    .map((tag) => SUBJECT_HASHTAGS[tag as Tag])
    .filter((tag): tag is string => Boolean(tag));
  if (fromTags.length > 0) return fromTags;
  const fromCategory = CATEGORY_HASHTAGS[subjects.category as Category];
  return fromCategory ? [fromCategory] : [];
}

/**
 * Tres etiquetas: la de la casa, el tema del libro y una de lectura.
 *
 * Si la obra no trae tema (ni etiquetas ni categoría conocida), en su lugar
 * entran dos etiquetas de lectura distintas: el aviso nunca sale con menos de
 * tres.
 */
export function hashtagsFor(
  seed: string,
  subjects: { category?: string | null; tags?: readonly string[] } = {},
): string[] {
  const pool = readingTags();
  const first = variantIndex(`${seed}|tag-a`, pool.length);
  const subject = subjectHashtags(subjects)[0];
  if (subject) return [BRAND_TAG, subject, pool[first] ?? pool[0]!];
  const secondRaw = variantIndex(`${seed}|tag-b`, pool.length - 1);
  // Se salta la elegida para que nunca coincidan.
  const second = secondRaw >= first ? secondRaw + 1 : secondRaw;
  return [BRAND_TAG, pool[first] ?? pool[0]!, pool[second] ?? pool[0]!];
}

export type PostInput = {
  title: string;
  author: string;
  /** Enlace público a la obra. */
  url: string;
  /** Id de la obra: decide la variante del texto y las etiquetas. */
  seed: string;
  /** Categoría del libro, para el tema cuando no hay etiquetas. */
  category?: string | null;
  /** Etiquetas curadas del ejemplar (las escribe quien publica). */
  tags?: readonly string[];
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
 * **El título y la autoría se insertan tal cual.** No se traducen ni se
 * normalizan: un libro titulado en castellano, en inglés o en cualquier otra
 * lengua conserva su título original también en el alemán del aviso. Lo único
 * que se añade alrededor son las comillas tipográficas alemanas.
 *
 * El enlace y las etiquetas se reservan **antes** de cortar: es lo que no puede
 * perderse. Un título de 400 caracteres se recorta y el post sigue siendo útil.
 */
export function composeStatus(input: PostInput): string {
  const leads = leadVariants();
  const lead = leads[variantIndex(input.seed, leads.length)]!;
  const tags = hashtagsFor(input.seed, input)
    .map((tag) => `#${tag}`)
    .join(" ");
  const tail = `\n\n${input.url}\n\n${tags}`;
  const room = Math.max(1, STATUS_LIMIT - Array.from(tail).length);
  return `${truncate(lead(input.title, input.author), room)}${tail}`;
}

/** Texto alternativo de la portada, siempre en alemán. */
export function coverAlt(title: string, author: string): string {
  return truncate(`Buchcover von „${title}“ von ${author}`, ALT_LIMIT);
}

/**
 * Etiqueta del enlace de los avisos.
 *
 * Las apps del fediverso no siempre mandan `Referer` (y el navegador solo manda
 * el origen), así que sin marca es imposible saber cuántas visitas trae el bot.
 * El parámetro no cambia la página ni su canónica (`/werk/<id>`): solo deja un
 * rastro contable en el access log. Se cuenta en `deploy/informe-accesos.sh`.
 */
export const ANNOUNCE_REF = "mastodon";

/** Enlace público de la obra, con la marca del bot. */
export function workUrl(base: string, bookId: string): string {
  const url = `${base.replace(/\/+$/, "")}/werk/${bookId}`;
  return `${url}?ref=${ANNOUNCE_REF}`;
}
