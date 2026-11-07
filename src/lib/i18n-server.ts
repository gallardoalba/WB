import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, matchLocale, type Locale } from "./locale";

/**
 * Idioma de la petición.
 *
 * Manda la URL cuando lleva prefijo (`/es/…`, `/en/…`): es lo que permite que
 * Google indexe cada idioma en su propia dirección. Después la cookie del
 * selector; si no hay —primera visita, otro navegador, un enlace abierto desde
 * el correo— se usa el que pida el navegador (`Accept-Language`), y si tampoco
 * hay ninguno de los tres, el alemán. Antes cualquier visita sin cookie caía al
 * alemán, así que quien tenía el navegador en castellano se registraba en
 * alemán y recibía los correos en alemán aunque luego cambiara el selector.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const forced = matchLocale((await headers()).get(LOCALE_HEADER));
    if (forced) return forced;
    const store = await cookies();
    const chosen = matchLocale(store.get(LOCALE_COOKIE)?.value);
    if (chosen) return chosen;
    return matchLocale((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
