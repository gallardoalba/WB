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
  return /^(\d{9}[\dX]|\d{13})$/.test(isbn);
}

export function coverFromIsbn(isbn: string | null): string | null {
  if (!isbn || !isValidIsbn(isbn)) return null;
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

export function toneForId(id: string): (typeof TONES)[number] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100000;
  }
  return TONES[hash % TONES.length];
}

const DATE_FORMATTERS = {
  es: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Berlin" }),
  de: new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "Europe/Berlin" }),
} as const;

/** Deterministic date label so server and client render the same text. */
export function formatWhen(isoDate: string, locale: "es" | "de" = "es"): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return DATE_FORMATTERS[locale].format(date);
}

export function formatDistance(distanceKm: number | null, locale: "es" | "de" = "es"): string {
  // Sin ciudad conocida no se inventa una distancia.
  if (distanceKm === null) return locale === "de" ? "Ohne Angabe" : "Sin distancia";
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
} as const;

/**
 * Etiqueta del encuentro: la fecha concreta manda; si no hay, se muestra la
 * cadencia libre que escribió el club («último martes, 19:00»).
 */
export function formatMeeting(meetsAt: string, meetsOn: string, locale: "es" | "de" = "es"): string {
  if (meetsAt) {
    const date = new Date(meetsAt);
    if (!Number.isNaN(date.getTime())) return MEETING_FORMATTERS[locale].format(date);
  }
  return meetsOn;
}
