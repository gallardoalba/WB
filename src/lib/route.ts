import type { z } from "zod";

import { handleApiError, readJson } from "./api";
import type { SessionUser } from "./domain";
import { recordRequest, requestIdFrom, REQUEST_ID_HEADER } from "./observability";
import { clientKey, guard, hasClientIp, hit } from "./throttle";

/**
 * Envoltorio de rutas de API.
 *
 * Cada ruta repetía el mismo ceremonial: `try { … } catch { handleApiError }`
 * más la guardia de sesión, la de origen y la cuota. Olvidarse de una pieza no
 * rompe la compilación, así que el fallo llegaba a producción (una ruta sin
 * `try` devuelve un 500 sin cuerpo JSON; una sin `guard` acepta peticiones
 * cross-site). Aquí la ceremonia se hace una sola vez y el manejador se queda
 * con lo que de verdad importa.
 *
 * Uso típico:
 *
 * ```ts
 * export const POST = route(
 *   { body: readingListSchema, limit: { bucket: "list:create", limit: 12, windowMs: DIA } },
 *   ({ user, body }) => json({ list: createReadingList(user.id, body) }, 201),
 * );
 * ```
 */

const DAY = 24 * 60 * 60 * 1000;

export const DIA = DAY;

type Cuota = {
  bucket: string;
  limit: number;
  windowMs: number;
  /** Cuenta por usuario (por defecto) o por IP. */
  by?: "user" | "ip";
  /**
   * `guard` (por defecto en mutaciones) exige mismo origen; `hit` solo cuenta.
   * Usa `"hit"` para lecturas.
   */
  mode?: "guard" | "hit";
};

type Opciones<S extends z.ZodType | undefined> = {
  /** `"none"` no consulta la sesión (salud, ISBN, portadas). */
  auth?: "user" | "optional" | "admin" | "none";
  /** Cuerpo JSON validado antes de entrar al manejador. */
  body?: S;
  /** Cuota aplicada antes del manejador. */
  limit?: Cuota;
};

/** El usuario llega resuelto: `SessionUser` si se exige, `null` si no. */
type UsuarioDe<A> = A extends "none"
  ? null
  : A extends "optional"
    ? SessionUser | null
    : SessionUser;

type CuerpoDe<S> = S extends z.ZodType ? z.infer<S> : undefined;

type Contexto<A, S, P> = {
  request: Request;
  params: P;
  user: UsuarioDe<A>;
  body: CuerpoDe<S>;
};

type Manejador<A, S, P> = (contexto: Contexto<A, S, P>) => Promise<Response> | Response;

export function route<
  S extends z.ZodType | undefined = undefined,
  A extends "user" | "optional" | "admin" | "none" = "user",
  P = undefined,
>(options: Opciones<S> & { auth?: A }, handler: Manejador<A, S, P>) {
  return async function handler_for_next(
    request: Request,
    // Next tipa el segmento como `Promise<{}>` en las rutas sin parámetros y
    // como `Promise<{ id: string }>` en las dinámicas: aquí se acepta cualquiera
    // y el tipo real lo pone el genérico de cada ruta.
    segment?: { params: Promise<unknown> },
  ): Promise<Response> {
    const started = performance.now();
    const id = requestIdFrom(request.headers);
    let response: Response;
    try {
      const params = (segment ? await segment.params : undefined) as P;

      let user: UsuarioDe<A>;
      if ((options.auth ?? "user") === "none") {
        user = null as UsuarioDe<A>;
      } else {
        // `admin` se comprueba en el manejador con `requireAdmin()` cuando la
        // ruta necesita el segundo factor; aquí solo se exige sesión.
        // La carga es perezosa porque `auth.ts` está marcado `server-only` y el
        // envoltorio también se usa en pruebas fuera del servidor de Next.
        const { getSessionUser, requireUser } = await import("./auth");
        user = (
          options.auth === "optional" ? await getSessionUser() : await requireUser()
        ) as UsuarioDe<A>;
      }

      if (options.limit) {
        const by = options.limit.by ?? "user";
        // Sin proxy declarado la IP no es fiable: se cae a una cuota global.
        const key =
          by === "ip"
            ? hasClientIp()
              ? clientKey(request)
              : "all"
            : ((user as SessionUser | null)?.id ?? "anon");
        const cuota = {
          bucket: options.limit.bucket,
          key,
          limit: options.limit.limit,
          windowMs: options.limit.windowMs,
        };
        if ((options.limit.mode ?? "guard") === "hit") hit(cuota);
        else guard(request, cuota);
      }

      const body = (
        options.body ? options.body.parse(await readJson(request)) : undefined
      ) as CuerpoDe<S>;

      response = await handler({ request, params, user, body });
    } catch (error) {
      response = await handleApiError(error, { requestId: id });
    }

    // El id y la latencia acompañan a la respuesta: quien reporte un fallo
    // puede copiarlos de la pestaña de red y buscarlos en el registro. Hay
    // respuestas con cabeceras inmutables (`Response.redirect`), y ahí no se
    // puede añadir nada: se registra igual y se devuelve tal cual.
    try {
      response.headers.set(REQUEST_ID_HEADER, id);
      response.headers.set("x-response-time", `${(performance.now() - started).toFixed(1)}ms`);
    } catch {
      // Cabeceras de solo lectura: el id sigue en la línea de registro.
    }
    recordRequest({
      id,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      ms: performance.now() - started,
    });
    return response;
  };
}
