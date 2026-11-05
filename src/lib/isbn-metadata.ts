import { BOOK_LANGUAGES } from "./domain";

/**
 * Datos de una edición a partir del ISBN.
 *
 * Al publicar el título y la autoría no se escriben a mano: los pone el ISBN.
 * Para eso hay que cubrir el mercado real de la aplicación (Alemania) y no solo
 * el catálogo internacional:
 *
 * - **DNB** (Deutsche Nationalbibliothek, SRU): conoce todo lo publicado en
 *   Alemania, con título, autoría, idioma y clasificación DDC. Open Library no
 *   tiene casi ningún libro alemán.
 * - **Open Library**: cubre el resto, aporta los temas de la obra y el
 *   identificador de obra (`/works/OL…W`), que permite agrupar ediciones.
 *
 * Se consultan en paralelo y se combinan: el título, la autoría y el idioma de
 * la DNB mandan cuando existen (son los de la edición registrada en Alemania) y
 * Open Library rellena lo que falte. `null` significa «no hay datos», nunca
 * «los datos están mal».
 *
 * Las peticiones las hace el servidor: el navegador no habla con terceros.
 */

export type IsbnMetadata = {
  title: string;
  authors: string[];
  /** Idioma de la edición, ya mapeado a `BOOK_LANGUAGES`. */
  language: string | null;
  /** Categoría principal deducida de la clasificación, si se puede. */
  category: string | null;
  /** Etiquetas temáticas sugeridas (tres como máximo). */
  tags: string[];
  publisher: string | null;
  year: string | null;
  /** Obra de Open Library: agrupa ediciones que son el mismo libro. */
  workId: string | null;
  /** De dónde salió el dato, para poder explicarlo en la interfaz. */
  source: "dnb" | "openlibrary" | "dnb+openlibrary";
};

/** Un fallo del proveedor no puede retrasar el formulario. */
const TIMEOUT_MS = 5_000;
/** Las fichas bibliográficas cambian poco. */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Un «no está» se recuerda menos: los catálogos crecen. */
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

type CacheEntry = { value: IsbnMetadata | null; expires: number };

const cache = new Map<string, CacheEntry>();

function readCache(isbn: string): CacheEntry | undefined {
  const hit = cache.get(isbn);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(isbn);
    return undefined;
  }
  return hit;
}

function writeCache(isbn: string, value: IsbnMetadata | null): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(isbn, { value, expires: Date.now() + (value ? TTL_MS : MISS_TTL_MS) });
}

/** Lo ya consultado, sin red: el alta de la publicación lo reaprovecha. */
export function cachedIsbnMetadata(isbn: string): IsbnMetadata | null {
  return readCache(isbn)?.value ?? null;
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "Wanderbibliothek/1.0 (datos de libros)", accept },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/* --------------------------------- idioma -------------------------------- */

/** Códigos MARC/ISO 639-2 y de dos letras que usan los catálogos. */
const LANGUAGE_CODES: Record<string, string> = {
  ger: "Alemán",
  deu: "Alemán",
  de: "Alemán",
  spa: "Español",
  esp: "Español",
  es: "Español",
  eng: "Inglés",
  en: "Inglés",
};

/** Devuelve el idioma de `BOOK_LANGUAGES` o `null` si no hay ninguno. */
export function languageFromCodes(codes: readonly string[]): string | null {
  for (const code of codes) {
    const mapped = LANGUAGE_CODES[code.toLowerCase().trim()];
    if (mapped && (BOOK_LANGUAGES as readonly string[]).includes(mapped)) return mapped;
  }
  // Hay un idioma, pero no es uno de los que ofrece el formulario.
  return codes.length > 0 ? "Otro" : null;
}

/* -------------------------------- categoría ------------------------------ */

type Rule = { category: string; ddc: number[]; words: string[] };

/**
 * Clasificación por DDC (lo que usa la DNB) y por palabras clave de los temas
 * (lo que usa Open Library). El orden importa: biografías y ficción van antes
 * porque una novela histórica también dice «History».
 */
const CATEGORY_RULES: Rule[] = [
  {
    category: "Biografías",
    ddc: [920, 921, 922, 923, 929],
    words: ["biograph", "autobiograph", "memoir", "erinnerung", "tagebuch"],
  },
  {
    category: "Ficción",
    ddc: [830, 840, 850, 860, 870, 880, 890, 810, 820],
    words: [
      "belletristik",
      "fiction",
      "novel",
      "roman",
      "erzählung",
      "poetry",
      "lyrik",
      "drama",
      "krimi",
      "thriller",
      "fantasy",
      "literatur",
      "literature",
    ],
  },
  {
    category: "Ciencias y técnica",
    ddc: [500, 510, 520, 530, 540, 550, 570, 580, 590, 600, 610, 620, 630, 640, 660, 670, 680, 690],
    words: [
      "science",
      "physics",
      "chemistry",
      "biology",
      "mathematics",
      "computer",
      "medicine",
      "engineering",
      "technology",
      "naturwissenschaft",
      "physik",
      "chemie",
      "biologie",
      "mathematik",
      "medizin",
      "informatik",
    ],
  },
  {
    category: "Sociedad y política",
    ddc: [300, 301, 302, 303, 304, 305, 306, 307, 310, 320, 330, 340, 350, 360, 370, 380, 390],
    words: [
      "sociology",
      "politics",
      "economics",
      "law",
      "education",
      "social science",
      "mental health",
      "soziologie",
      "politik",
      "wirtschaft",
      "recht",
      "pädagogik",
      "psycholog",
    ],
  },
  {
    category: "Humanidades",
    ddc: [
      100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270,
      280, 290, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 700, 710, 720, 730, 740, 750,
      760, 770, 780, 790, 900, 910, 930, 940, 950, 960, 970, 980, 990,
    ],
    words: [
      "history",
      "philosophy",
      "religion",
      "language",
      "linguistics",
      "art",
      "music",
      "architecture",
      "geschichte",
      "philosophie",
      "sprache",
      "kunst",
      "musik",
    ],
  },
];

function ddcOf(subject: string): number | null {
  const match = subject.match(/^(\d{3})/);
  return match ? Number(match[1]) : null;
}

/** ¿La DDC cae dentro de alguna de las clases de la regla? */
function ddcMatches(ddc: number, allowed: readonly number[]): boolean {
  return allowed.some((entry) => ddc >= entry && ddc < entry + 10);
}

/** Deduce la categoría principal a partir de los temas del catálogo. */
export function categoryFromSubjects(subjects: readonly string[]): string | null {
  const normalized = subjects.map((subject) => subject.toLowerCase());
  const ddCs = normalized.map(ddcOf).filter((value): value is number => value !== null);

  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((word) => normalized.some((subject) => subject.includes(word)))) {
      return rule.category;
    }
    if (ddCs.some((ddc) => ddcMatches(ddc, rule.ddc))) return rule.category;
  }
  return null;
}

/* -------------------------------- etiquetas ------------------------------ */

/** Temas del catálogo → etiquetas de la aplicación. */
const TAG_KEYWORDS: { tag: string; words: string[] }[] = [
  { tag: "Historia", words: ["history", "geschichte", "historisch"] },
  { tag: "Filosofía", words: ["philosoph", "ethik", "ethics"] },
  { tag: "Religión", words: ["religion", "theolog", "bibel", "christentum", "islam"] },
  { tag: "Lengua", words: ["language", "linguistic", "sprache", "grammatik"] },
  { tag: "Arte", words: ["art", "kunst", "malerei", "photograph"] },
  { tag: "Música", words: ["music", "musik"] },
  { tag: "Poesía", words: ["poetry", "poesie", "lyrik", "gedicht"] },
  { tag: "Teatro", words: ["drama", "theater", "theatre"] },
  { tag: "Clásicos", words: ["classic", "klassiker"] },
  { tag: "Narrativa", words: ["fiction", "novel", "roman", "erzählung"] },
  { tag: "Divulgación", words: ["popular science", "sachbuch"] },
  { tag: "Física", words: ["physics", "physik"] },
  { tag: "Química", words: ["chemistry", "chemie"] },
  { tag: "Biología", words: ["biology", "biologie", "natur"] },
  { tag: "Matemáticas", words: ["mathematic", "mathematik"] },
  { tag: "Astronomía", words: ["astronom", "astrophysik"] },
  { tag: "Medicina", words: ["medicine", "medizin", "gesundheit"] },
  { tag: "Informática", words: ["computer", "informatik", "software"] },
  { tag: "Ingeniería", words: ["engineering", "technik", "ingenieur"] },
  { tag: "Sociología", words: ["sociolog", "soziolog", "gesellschaft"] },
  { tag: "Política", words: ["politic", "politik"] },
  { tag: "Economía", words: ["econom", "wirtschaft", "business", "finance"] },
  { tag: "Derecho", words: ["law", "recht", "jura"] },
  { tag: "Antropología", words: ["anthropolog"] },
  { tag: "Psicología", words: ["psycholog"] },
  { tag: "Educación", words: ["education", "pädagog", "bildung", "schule"] },
  { tag: "Ensayo", words: ["essay", "essays"] },
];

/** Etiquetas sugeridas, recortadas a las que admite la categoría. */
export function tagsFromSubjects(
  subjects: readonly string[],
  allowed: readonly string[],
  limit = 3,
): string[] {
  const normalized = subjects.map((subject) => subject.toLowerCase());
  const found: string[] = [];
  for (const { tag, words } of TAG_KEYWORDS) {
    if (found.length >= limit) break;
    if (!allowed.includes(tag)) continue;
    if (words.some((word) => normalized.some((subject) => subject.includes(word)))) found.push(tag);
  }
  return found;
}

/* ----------------------------------- DNB --------------------------------- */

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * La DNB escribe «[Título original] ; Título : subtítulo / mención de
 * responsabilidad». Se queda el título de la edición, sin el original, sin la
 * mención de responsabilidad y con el subtítulo si lo hay.
 */
export function parseDnbTitle(raw: string): { title: string; subtitle: string | null } {
  let text = decode(raw);
  const slash = text.lastIndexOf(" / ");
  if (slash > 3) text = text.slice(0, slash);
  const parallel = text.lastIndexOf(" ; ");
  if (parallel > 0) text = text.slice(parallel + 3);
  const parts = text.split(" : ");
  const title = (parts[0] ?? "").trim();
  const subtitle = parts.slice(1).join(" : ").trim();
  return { title, subtitle: subtitle || null };
}

/** «Emcke, Carolin [Verfasser]» → «Carolin Emcke». Traductores fuera. */
export function parseDnbCreator(raw: string): string | null {
  const plain = decode(raw);
  const role = plain.replace(/\[[^\]]*\]/g, "").trim();
  if (!role) return null;
  const roles = plain.match(/\[[^\]]*\]/g)?.join(" ").toLowerCase() ?? "";
  if (/übersetzer|translator|illustrator|herausgeber|editor/.test(roles) && !/verfasser|author/.test(roles)) {
    return null;
  }
  const [last, first] = role.split(",").map((part) => part.trim());
  if (!last) return null;
  return first ? `${first} ${last}` : last;
}

type PartialMetadata = {
  title?: string | null;
  authors?: string[];
  languages?: string[];
  subjects?: string[];
  publisher?: string | null;
  year?: string | null;
  workId?: string | null;
};

async function fromDnb(isbn: string): Promise<PartialMetadata | null> {
  const query = encodeURIComponent(`ISBN=${isbn}`);
  const xml = await fetchText(
    `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=${query}&recordSchema=oai_dc&maximumRecords=1`,
    "application/xml",
  );
  if (!xml || !xml.includes("<numberOfRecords>1</numberOfRecords>")) return null;
  const titleTag = xml.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
  if (!titleTag) return null;
  const { title, subtitle } = parseDnbTitle(titleTag[1] ?? "");
  if (!title) return null;
  const creators = [...xml.matchAll(/<dc:creator>([\s\S]*?)<\/dc:creator>/g)]
    .map((match) => parseDnbCreator(match[1] ?? ""))
    .filter((name): name is string => Boolean(name));
  const languages = [...xml.matchAll(/<dc:language>([\s\S]*?)<\/dc:language>/g)].map((match) =>
    decode(match[1] ?? ""),
  );
  const publisher = xml.match(/<dc:publisher>([\s\S]*?)<\/dc:publisher>/);
  const date = xml.match(/<dc:date>([\s\S]*?)<\/dc:date>/);
  const subjects = [...xml.matchAll(/<dc:subject>([\s\S]*?)<\/dc:subject>/g)].map((match) =>
    decode(match[1] ?? ""),
  );
  const rawPublisher = publisher ? decode(publisher[1] ?? "") : "";
  // «Frankfurt am Main : S. Fischer» → «S. Fischer».
  const publisherName = rawPublisher.includes(" : ")
    ? rawPublisher.split(" : ").slice(1).join(" : ")
    : rawPublisher;
  return {
    // Un subtítulo largo suele ser texto promocional («…: Roman - »Eine
    // witzige Heldenreise««): se queda fuera para no ensuciar la ficha.
    title: subtitle && subtitle.length <= 70 ? `${title}: ${subtitle}` : title,
    authors: creators.slice(0, 3),
    languages,
    subjects,
    publisher: publisherName || null,
    year: date ? decode(date[1] ?? "") : null,
  };
}

/* ------------------------------ Open Library ----------------------------- */

type OpenLibraryBook = {
  title?: unknown;
  subtitle?: unknown;
  authors?: { name?: unknown }[];
  subjects?: { name?: unknown }[];
  publishers?: { name?: unknown }[];
  publish_date?: unknown;
};

async function fromOpenLibrary(isbn: string): Promise<PartialMetadata | null> {
  const [data, edition] = await Promise.all([
    fetchText(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      "application/json",
    ),
    fetchText(`https://openlibrary.org/isbn/${isbn}.json`, "application/json"),
  ]);

  let book: OpenLibraryBook | null = null;
  if (data) {
    try {
      const parsed = JSON.parse(data) as Record<string, OpenLibraryBook | undefined>;
      book = parsed[`ISBN:${isbn}`] ?? null;
    } catch {
      book = null;
    }
  }

  let languages: string[] = [];
  let workId: string | null = null;
  let editionSubtitle: string | null = null;
  if (edition) {
    try {
      const parsed = JSON.parse(edition) as {
        subtitle?: unknown;
        languages?: { key?: unknown }[];
        works?: { key?: unknown }[];
      };
      editionSubtitle = typeof parsed.subtitle === "string" ? parsed.subtitle : null;
      languages = (parsed.languages ?? [])
        .map((entry) => (typeof entry.key === "string" ? (entry.key.split("/").pop() ?? "") : ""))
        .filter(Boolean);
      const work = parsed.works?.[0]?.key;
      workId = typeof work === "string" ? work : null;
    } catch {
      // Una edición sin JSON válido no aporta nada.
    }
  }

  if (!book && !workId) return null;
  const title = typeof book?.title === "string" ? book.title : null;
  const bookSubtitle =
    typeof book?.subtitle === "string" ? book.subtitle : editionSubtitle;
  const authors = (book?.authors ?? [])
    .map((author) => (typeof author.name === "string" ? author.name.trim() : ""))
    .filter(Boolean);
  return {
    title: title ? (bookSubtitle ? `${title}: ${bookSubtitle}` : title) : null,
    authors,
    languages,
    subjects: (book?.subjects ?? [])
      .map((subject) => (typeof subject.name === "string" ? subject.name : ""))
      .filter(Boolean),
    publisher:
      typeof book?.publishers?.[0]?.name === "string" ? book.publishers[0].name : null,
    year: typeof book?.publish_date === "string" ? book.publish_date : null,
    workId,
  };
}

/* --------------------------------- unión --------------------------------- */

/**
 * Combina las dos fuentes campo a campo. La DNB manda en título, autoría e
 * idioma (es la edición registrada en Alemania); Open Library aporta los temas
 * y el identificador de obra que permite agrupar ediciones.
 */
export function mergeSources(
  dnb: PartialMetadata | null,
  openLibrary: PartialMetadata | null,
  tagsFor: (category: string | null, subjects: readonly string[]) => string[],
): IsbnMetadata | null {
  const title = dnb?.title ?? openLibrary?.title ?? null;
  if (!title) return null;
  const authors = dnb?.authors?.length ? dnb.authors : (openLibrary?.authors ?? []);
  const languages = dnb?.languages?.length ? dnb.languages : (openLibrary?.languages ?? []);
  const subjects = [...(dnb?.subjects ?? []), ...(openLibrary?.subjects ?? [])];
  // La DNB cataloga profesionalmente: si clasifica, manda sobre los temas
  // abiertos de Open Library (que a veces etiquetan una traducción como
  // «Fiction» sin serlo).
  const category =
    categoryFromSubjects(dnb?.subjects ?? []) ?? categoryFromSubjects(openLibrary?.subjects ?? []);
  return {
    title,
    authors,
    language: languageFromCodes(languages),
    category,
    tags: tagsFor(category, subjects),
    publisher: dnb?.publisher ?? openLibrary?.publisher ?? null,
    year: dnb?.year ?? openLibrary?.year ?? null,
    workId: openLibrary?.workId ?? null,
    source: dnb && openLibrary ? "dnb+openlibrary" : dnb ? "dnb" : "openlibrary",
  };
}

export async function fetchIsbnMetadata(
  isbn: string,
  tagsFor: (category: string | null, subjects: readonly string[]) => string[],
): Promise<IsbnMetadata | null> {
  const cached = readCache(isbn);
  if (cached) return cached.value;

  const [dnb, openLibrary] = await Promise.all([fromDnb(isbn), fromOpenLibrary(isbn)]);
  const merged = mergeSources(dnb, openLibrary, tagsFor);
  writeCache(isbn, merged);
  return merged;
}
