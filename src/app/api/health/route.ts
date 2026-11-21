import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { route } from "@/lib/route";
import { hasClientIp } from "@/lib/throttle";

export const GET = route({ auth: "none" }, async () => {
  await connection();
  try {
    const db = getDb();
    const { value } = db.prepare("SELECT 1 AS value").get() as { value: number };
    return Response.json(
      // Sin datos de proceso: el estado de salud no es el sitio para contar
      // cuánto lleva vivo el servicio ni cuántas veces se ha reiniciado.
      //
      // `proxy` sí importa: sin `TRUST_PROXY=1` las cuotas por IP se degradan a
      // una global y ese despliegue «funciona» sin proteger nada. Antes solo se
      // avisaba por consola; aquí lo ve quien mire la sonda.
      {
        status: "ok",
        database: value === 1 ? "ok" : "unknown",
        proxy: hasClientIp() ? "trusted" : "direct",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health] base de datos no disponible", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
});
