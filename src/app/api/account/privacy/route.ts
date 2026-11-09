import { json } from "@/lib/api";
import { setUserPrivacy } from "@/lib/repo";
import { route } from "@/lib/route";
import { privacySchema } from "@/lib/validation";

/**
 * Preferencias de visibilidad de la cuenta: quién ve el perfil y la ciudad, con
 * qué firma se publican reseñas y comentarios, y quién puede escribir.
 *
 * Se guardan en la cuenta (no en el navegador) porque el servidor es quien
 * decide qué se muestra en cada superficie.
 */
export const POST = route(
  {
    body: privacySchema,
    limit: { bucket: "account:privacy", limit: 60, windowMs: 60 * 60 * 1000 },
  },
  ({ user, body }) => {
    setUserPrivacy(user.id, body);
    return json({ ok: true });
  },
);
