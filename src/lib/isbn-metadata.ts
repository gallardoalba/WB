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
  /** Colección de la editorial («Rororo 22530»), si la edición está en una. */
  series: string | null;
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

/**
 * La DNB entrega el MARC21 en UTF-8, pero las comillas bibliográficas alemanas
 * viajan como referencias numéricas de Windows-1252 (`&#152;` = „, `&#156;` =
 * “). No se pueden descodificar como Unicode: U+0098 es un carácter de control.
 */
function decode(value: string): string {
  return value
    .replace(/&#152;/g, "„")
    .replace(/&#156;/g, "“")
    .replace(/&#150;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** «„Der eindimensionale Mensch“» → «Der eindimensionale Mensch». */
export function stripQuotes(value: string): string {
  const limpio = value
    // Las comillas bibliográficas alemanas no son parte del título ni del
    // sello: la DNB las pone para delimitar el nombre, no para citarlo.
    .replace(/[„“‚‘«»]/g, "")
    .trim();
  // Las comillas rectas solo se quitan si envuelven **todo** el valor. Antes se
  // borraba la última aunque cerrara una cita dentro del texto, y
  // «El "Quijote"» acababa como «El "Quijote».
  return /^"[\s\S]*"$/.test(limpio) ? limpio.slice(1, -1).trim() : limpio;
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
  series?: string | null;
  workId?: string | null;
};

type MarcSubfield = { code: string; value: string };
type MarcField = { tag: string; subfields: MarcSubfield[] };

/** Campos `<datafield tag="NNN">` de un registro MARC21-xml, ya descodificados. */
export function marcFields(xml: string): MarcField[] {
  const fields: MarcField[] = [];
  for (const field of xml.matchAll(/<datafield tag="(\d{3})"[^>]*>([\s\S]*?)<\/datafield>/g)) {
    const subfields = [
      ...(field[2] ?? "").matchAll(/<subfield code="([^"]*)">([\s\S]*?)<\/subfield>/g),
    ].map((subfield) => ({ code: subfield[1] ?? "", value: decode(subfield[2] ?? "") }));
    fields.push({ tag: field[1] ?? "", subfields });
  }
  return fields;
}

function subfieldsOf(fields: readonly MarcField[], tag: string, code: string): string[] {
  return fields
    .filter((field) => field.tag === tag)
    .flatMap((field) => field.subfields.filter((sub) => sub.code === code).map((sub) => sub.value))
    .map(stripQuotes)
    .filter(Boolean);
}

function firstSubfield(fields: readonly MarcField[], tag: string, code: string): string | null {
  return subfieldsOf(fields, tag, code)[0] ?? null;
}

/**
 * Registro MARC21 de la DNB → ficha de la edición.
 *
 * MARC da el título y el subtítulo por separado (245 $a/$b), la mención de
 * editorial y año (264 $a/$b/$c), la colección con su número (490/830 $a/$v)
 * y la clasificación DDC (082/083), que es de donde sale el género. Antes se
 * leía `oai_dc`, que no tiene Reihe: la colección se perdía.
 */
export function parseMarcRecord(xml: string): PartialMetadata | null {
  const fields = marcFields(xml);
  const title = firstSubfield(fields, "245", "a");
  if (!title) return null;

  const subtitle = firstSubfield(fields, "245", "b");
  const creators = [
    ...new Set(
      fields
        .filter((field) => field.tag === "100" || field.tag === "700")
        .map((field) => {
          const name = field.subfields.find((sub) => sub.code === "a")?.value ?? "";
          const role = field.subfields.find((sub) => sub.code === "e")?.value ?? "";
          return name ? stripQuotes(`${name}${role ? ` [${role}]` : ""}`) : "";
        })
        .map(parseDnbCreator)
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  const publisher = firstSubfield(fields, "264", "b");
  const rawYear = firstSubfield(fields, "264", "c");
  const seriesName = firstSubfield(fields, "490", "a") ?? firstSubfield(fields, "830", "a");
  const seriesNumber = firstSubfield(fields, "490", "v") ?? firstSubfield(fields, "830", "v");

  // 082/083 traen la DDC («301»), 650/689 las materias: las dos alimentan la
  // misma deducción de categoría y etiquetas que ya existía. La Sachgruppe de
  // la DNB (`689 $A`) dice si es ficción incluso cuando no hay DDC.
  const sachgruppen = fields
    .filter((field) => field.tag === "689")
    .flatMap((field) => field.subfields.filter((sub) => sub.code === "A").map((sub) => sub.value));
  const subjects = [
    ...subfieldsOf(fields, "082", "a"),
    ...subfieldsOf(fields, "083", "a"),
    ...subfieldsOf(fields, "650", "a"),
    ...subfieldsOf(fields, "689", "a"),
    ...(sachgruppen.includes("f") ? ["Belletristik"] : []),
  ];

  return {
    // Un subtítulo largo suele ser texto promocional: se queda fuera para no
    // ensuciar la ficha.
    title: subtitle && subtitle.length <= 70 ? `${title}: ${subtitle}` : title,
    authors: creators.slice(0, 3),
    languages: subfieldsOf(fields, "041", "a"),
    subjects,
    publisher,
    year: rawYear ? (rawYear.match(/\d{4}/)?.[0] ?? rawYear) : null,
    series: seriesName ? (seriesNumber ? `${seriesName} ${seriesNumber}` : seriesName) : null,
  };
}

async function fromDnb(isbn: string): Promise<PartialMetadata | null> {
  const query = encodeURIComponent(`ISBN=${isbn}`);
  const xml = await fetchText(
    `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=${query}&recordSchema=MARC21-xml&maximumRecords=1`,
    "application/xml",
  );
  if (!xml || !xml.includes("<numberOfRecords>1</numberOfRecords>")) return null;
  return parseMarcRecord(xml);
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
    // La Reihe solo la da un catálogo nacional: Open Library no la modela.
    series: dnb?.series ?? null,
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
