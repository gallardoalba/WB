import { json } from "@/lib/api";
import { listDisclosures } from "@/lib/repo";
import { deviceIdSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Lo que alguien ha revelado a quien modera el club.
 *
 * Solo lo ve un moderador y solo lo suyo: cada revelación viene con el sobre
 * cifrado para **este** dispositivo, así que el servidor sigue sin poder leer
 * nada. El texto se abre en el navegador de quien modera.
 */
export const GET = route<undefined, "user", { clubId: string }>(
  {},
  ({ request, params, user }) => {
    const device = new URL(request.url).searchParams.get("device");
    if (!device) {
      return json({ disclosures: [], needsDevice: true }, 200);
    }
    const disclosures = listDisclosures(params.clubId, user.id, deviceIdSchema.parse(device));
    return json({ disclosures, needsDevice: false }, 200, { "cache-control": "no-store" });
  },
);
