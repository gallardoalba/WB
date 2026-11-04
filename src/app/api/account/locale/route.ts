import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setUserLocale } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { localeSchema } from "@/lib/validation";

/** Guarda el idioma elegido; sin sesión el selector usa solo la cookie. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "account:locale",
      key: user.id,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    const { locale } = localeSchema.parse(await readJson(request));
    setUserLocale(user.id, locale);
    return json({ locale });
  } catch (error) {
    return handleApiError(error);
  }
}
