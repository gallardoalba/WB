import { json, readJson } from "@/lib/api";
import { setUserLocale } from "@/lib/repo";
import { localeSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Guarda el idioma elegido; sin sesión el selector usa solo la cookie. */
export const POST = route(
  { limit: { bucket: "account:locale", limit: 120, windowMs: 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const { locale } = localeSchema.parse(await readJson(request));
    setUserLocale(user.id, locale);
    return json({ locale });
  },
);
