import { connection } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    const db = getDb();
    const { value } = db.prepare("SELECT 1 AS value").get() as { value: number };
    return Response.json(
      // Sin datos de proceso: el estado de salud no es el sitio para contar
      // cuánto lleva vivo el servicio ni cuántas veces se ha reiniciado.
      { status: "ok", database: value === 1 ? "ok" : "unknown" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health] base de datos no disponible", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
