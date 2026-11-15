import { connection } from "next/server";

import { handleApiError } from "@/lib/api";
import { REPOSITORY } from "@/lib/brand";
import { readBuildInfo } from "@/lib/build-info";

/**
 * Qué commit y qué imagen dice estar sirviendo esta instancia.
 *
 * Es público y no lleva nada de nadie: solo el identificador del código. Lo
 * consulta quien quiere contrastar el despliegue con el repositorio y lo puede
 * leer cualquier verificador sin sesión.
 */
export async function GET() {
  try {
    // Saca la ruta del prerender: el valor depende del entorno del proceso y no
    // debe quedar congelado en el build. Fuera de una petición (pruebas) no hay
    // nada que esperar.
    try {
      await connection();
    } catch {
      // Fuera de una petición (pruebas, scripts): no hay render que aplazar.
    }

    const info = readBuildInfo();
    return Response.json(
      {
        ...info,
        repository: REPOSITORY,
        /** Dónde está el código exacto que se está sirviendo, si se conoce. */
        sourceUrl: info.commit ? `${REPOSITORY}/tree/${info.commit}` : null,
      },
      {
        // Cambia solo al desplegar: un minuto de caché ahorra consultas sin
        // ocultar una versión nueva durante mucho tiempo.
        headers: { "cache-control": "public, max-age=60" },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
