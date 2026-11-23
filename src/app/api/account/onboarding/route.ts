import { json } from "@/lib/api";
import { dismissOnboardingChecklist } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Cierra la lista de primeros pasos en la cuenta.
 *
 * Antes solo se guardaba en `localStorage`, así que la tarjeta reaparecía al
 * entrar desde otro navegador o al limpiar los datos del sitio.
 */
export const POST = route(
  { limit: { bucket: "account:onboarding", limit: 60, windowMs: 60 * 60 * 1000 } },
  ({ user }) => {
    dismissOnboardingChecklist(user.id);
    return json({ ok: true });
  },
);
