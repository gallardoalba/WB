import { DEFAULT_LOCALE, localeTag, type Locale } from "./locale";

const TONES = ["sage", "ochre"] as const;

/** Lowercases and strips diacritics so "Martínez" matches "martinez". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when every token of the query appears in the haystack, ignoring case and accents. */
export function matchesQuery(haystack: string, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  const normalizedHaystack = normalizeText(haystack);
  return normalizedQuery.split(" ").every((token) => normalizedHaystack.includes(token));
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function normalizeIsbn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
  return cleaned.length === 0 ? null : cleaned;
}

export function isValidIsbn(isbn: string): boolean {
  if (/^\d{13}$/.test(isbn)) {
    // ISBN-13: los 12 primeros dígitos pesan 1 y 3 alternos; el último cuadra.
    let sum = 0;
    for (let index = 0; index < 12; index += 1) {
      sum += Number(isbn[index]) * (index % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10 === Number(isbn[12]);
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    // ISBN-10: pesos 10…2 y módulo 11 (la X vale 10).
    let sum = 0;
    for (let index = 0; index < 9; index += 1) {
      sum += Number(isbn[index]) * (10 - index);
    }
    sum += isbn[9] === "X" ? 10 : Number(isbn[9]);
    return sum % 11 === 0;
  }
  return false;
}

export function coverFromIsbn(isbn: string | null): string | null {
  if (!isbn || !isValidIsbn(isbn)) return null;
  // Se pide a la propia aplicación, que la trae y la cachea en disco: así el
  // navegador no abre una conexión con Open Library (que vería su IP y el ISBN).
  return `/api/cover/${isbn}`;
}

/**
 * Corrige portadas guardadas con la URL externa de versiones anteriores.
 * Se aplica al leer, no solo al migrar: así ningún dato viejo puede volver a
 * romper la política de imágenes.
 */
export function normalizeCoverUrl(coverUrl: string | null, isbn: string | null): string | null {
  if (!coverUrl || coverUrl.startsWith("https://covers.openlibrary.org/")) {
    return coverFromIsbn(isbn);
  }
  return coverUrl;
}

export function toneForId(id: string): (typeof TONES)[number] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100000;
  }
  return TONES[hash % TONES.length];
}

/** Número con el formato del idioma (1.234 en español, 1.234 en alemán). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale)).format(value);
}

const DATE_FORMATTERS = {
  es: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Berlin" }),
  de: new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "Europe/Berlin" }),
  en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Berlin" }),
} as const;

/** Deterministic date label so server and client render the same text. */
export function formatWhen(
  isoDate: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return DATE_FORMATTERS[locale].format(date);
}

export function formatDistance(
  distanceKm: number | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  // Sin ciudad conocida no se inventa una distancia.
  if (distanceKm === null) {
    if (locale === "de") return "Ohne Angabe";
    if (locale === "en") return "No distance";
    return "Sin distancia";
  }
  return `${distanceKm.toFixed(1).replace(".", ",")} km`;
}

const MEETING_FORMATTERS = {
  es: new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }),
  de: new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }),
  en: new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }),
} as const;

/**
 * Etiqueta del encuentro: la fecha concreta manda; si no hay, se muestra la
 * cadencia libre que escribió el club («último martes, 19:00»).
 */
export function formatMeeting(
  meetsAt: string,
  meetsOn: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (meetsAt) {
    const date = new Date(meetsAt);
    if (!Number.isNaN(date.getTime())) return MEETING_FORMATTERS[locale].format(date);
  }
  return meetsOn;
}
