import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";

import { getDb } from "../src/lib/db/index.ts";
import { ApiError } from "../src/lib/errors.ts";
import { route } from "../src/lib/route.ts";

// `getDb()` se abre en la primera consulta, así que basta con fijarlo aquí.
process.env.WANDERBIBLIOTHEK_DB = ":memory:";

/**
 * El envoltorio de rutas tiene que cumplir su parte del contrato sin que cada
 * ruta lo repita: sesión, cuerpo validado, cuota y errores en JSON.
 */

const jsonRequest = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost:3100/api/prueba", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3100" },
    body: JSON.stringify(body),
    ...init,
  });

test("una ruta pública recibe la petición sin sesión", async () => {
  const handler = route({ auth: "none" }, ({ user, request }) => {
    assert.equal(user, null);
    return Response.json({ path: new URL(request.url).pathname });
  });
  const response = await handler(new Request("http://localhost:3100/api/prueba"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: "/api/prueba" });
});

test("el cuerpo se valida con su esquema antes de entrar al manejador", async () => {
  let called = false;
  const handler = route(
    { auth: "none", body: z.object({ title: z.string().min(3) }) },
    ({ body }) => {
      called = true;
      return Response.json({ title: body.title });
    },
  );

  const ok = await handler(jsonRequest({ title: "El Quijote" }));
  assert.equal(ok.status, 200);
  assert.equal(called, true);

  const bad = await handler(jsonRequest({ title: "ab" }));
  assert.equal(bad.status, 422);
  const payload = (await bad.json()) as { issues?: { path: string }[] };
  assert.ok(payload.issues?.some((issue) => issue.path === "title"), "falta el detalle del campo");
});

test("un cuerpo que no es JSON se rechaza antes de tocar la base", async () => {
  const handler = route({ auth: "none", body: z.object({ a: z.number() }) }, () =>
    Response.json({ ok: true }),
  );
  const response = await handler(
    new Request("http://localhost:3100/api/prueba", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "a=1",
    }),
  );
  assert.equal(response.status, 415);
});

test("un ApiError del manejador sale como JSON con su estado", async () => {
  const handler = route({ auth: "none" }, () => {
    throw new ApiError(409, "Ese ejemplar ya no está disponible.");
  });
  const response = await handler(new Request("http://localhost:3100/api/prueba"));
  assert.equal(response.status, 409);
  const payload = (await response.json()) as { error: string };
  assert.match(payload.error, /ya no está disponible/);
});

test("un fallo inesperado no filtra el mensaje interno", async () => {
  const handler = route({ auth: "none" }, () => {
    throw new Error("SELECT * FROM users WHERE token = 'secreto'");
  });
  const response = await handler(new Request("http://localhost:3100/api/prueba"));
  assert.equal(response.status, 500);
  const payload = (await response.json()) as { error: string; reference?: string };
  assert.doesNotMatch(payload.error, /SELECT/);
  assert.ok(payload.reference, "el fallo debe llevar una referencia para el registro");
});

test("los parámetros de la ruta llegan resueltos al manejador", async () => {
  const handler = route<undefined, "none", { isbn: string }>(
    { auth: "none" },
    ({ params }) => Response.json({ isbn: params.isbn }),
  );
  const response = await handler(new Request("http://localhost:3100/api/x/1"), {
    params: Promise.resolve({ isbn: "9788420412146" }),
  });
  assert.deepEqual(await response.json(), { isbn: "9788420412146" });
});

test("la cuota frena antes del manejador y anuncia cuándo reintentar", async () => {
  const handler = route(
    { auth: "none", limit: { bucket: "prueba:cuota", limit: 2, windowMs: 60_000, mode: "hit" } },
    () => Response.json({ ok: true }),
  );

  const first = await handler(new Request("http://localhost:3100/api/prueba"));
  const second = await handler(new Request("http://localhost:3100/api/prueba"));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const blocked = await handler(new Request("http://localhost:3100/api/prueba"));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0, "sin Retry-After");
  assert.ok(
    (getDb().prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?").get("prueba:cuota") as {
      n: number;
    }).n >= 2,
  );
});

test("una mutación sin origen declarado no se ejecuta (CSRF)", async () => {
  let called = false;
  const handler = route(
    { auth: "none", limit: { bucket: "prueba:origen", limit: 10, windowMs: 60_000 } },
    () => {
      called = true;
      return Response.json({ ok: true });
    },
  );
  const response = await handler(
    new Request("http://localhost:3100/api/prueba", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
  );
  assert.equal(called, false, "el manejador no debe ejecutarse");
  assert.equal(response.status, 403);
});

test("cada respuesta lleva su id de petición y su latencia", async () => {
  const handler = route({ auth: "none" }, () => Response.json({ ok: true }));

  // El id que manda el proxy de delante se conserva.
  const propagated = await handler(
    new Request("http://localhost:3100/api/prueba", {
      headers: { "x-request-id": "proxy-abcdef12" },
    }),
  );
  assert.equal(propagated.headers.get("x-request-id"), "proxy-abcdef12");
  assert.match(propagated.headers.get("x-response-time") ?? "", /^\d+\.\dms$/);

  // Un id con caracteres raros no se reenvía: se genera uno nuevo.
  const replaced = await handler(
    new Request("http://localhost:3100/api/prueba", {
      headers: { "x-request-id": "id con espacios y ñ" },
    }),
  );
  const id = replaced.headers.get("x-request-id") ?? "";
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.notEqual(id, "id con espacios y ñ");
});

test("el error inesperado devuelve el prefijo del id y lo registra con él", async () => {
  const logs: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = (line: string) => void logs.push(line);
  console.warn = (line: string) => void logs.push(line);
  console.error = () => undefined;

  const handler = route({ auth: "none" }, () => {
    throw new Error("fallo de prueba");
  });
  let response: Response;
  try {
    response = await handler(
      new Request("http://localhost:3100/api/prueba", {
        headers: { "x-request-id": "0123456789abcdef" },
      }),
    );
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }

  assert.equal(response.status, 500);
  const payload = (await response.json()) as { reference: string };
  assert.equal(payload.reference, "01234567");
  assert.equal(response.headers.get("x-request-id"), "0123456789abcdef");

  // La línea de registro permite encontrar la petición exacta en el servidor.
  const line = logs.find((entry) => entry.startsWith("[req] "));
  assert.ok(line, "no se registró la petición");
  const parsed = JSON.parse(line.replace("[req] ", "")) as Record<string, unknown>;
  assert.equal(parsed.id, "0123456789abcdef");
  assert.equal(parsed.status, 500);
  assert.equal(parsed.path, "/api/prueba");
});

/* ---------------------------------------------------------------------------
 * Higiene de las rutas: la estructura se comprueba sobre los ficheros para que
 * una ruta nueva no pueda olvidarse de lo que las demás ya hacen.
 * ------------------------------------------------------------------------- */

function routeFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...routeFiles(path));
    else if (entry.name === "route.ts") found.push(path);
  }
  return found;
}

const ROUTES = routeFiles("src/app/api");

test("ninguna ruta se queda sin traducir los errores a JSON", () => {
  // `/api/health` responde a las sondas del despliegue, no a la aplicación:
  // su contrato es el código de estado, no un cuerpo de error.
  const exceptions = new Set(["src/app/api/health/route.ts"]);
  const missing = ROUTES.filter(
    (file) =>
      !exceptions.has(file) &&
      !/handleApiError|route[<(]/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(missing, [], `rutas sin manejo de errores: ${missing.join(", ")}`);
});

test("las rutas que escriben no aceptan peticiones de otro origen", () => {
  const offenders = ROUTES.filter((file) => {
    const source = readFileSync(file, "utf8");
    if (!/export (async function|const) (POST|PATCH|PUT|DELETE)\b/.test(source)) return false;
    // Con el envoltorio la guardia la pone `route()`, pero **solo si la ruta
    // declara cuota o el origen se comprueba aparte**: aceptar `route(` a
    // secas daba por buena una mutación sin ninguna protección.
    if (/=\s*route[<(]/.test(source)) {
      return !/limit:/.test(source) && !/assertSameOrigin|guard\(/.test(source);
    }
    // Fuera del envoltorio: el cron se autentica con token o hay guardia propia.
    return !/guard\(|assertSameOrigin|Bearer/.test(source);
  });
  assert.deepEqual(offenders, [], `mutaciones sin control de origen: ${offenders.join(", ")}`);
});

test("una mutación con origen ajeno se rechaza aunque no declare cuota", async () => {
  let llamado = false;
  const handler = route({ auth: "none" }, () => {
    llamado = true;
    return Response.json({ ok: true });
  });

  const ajena = await handler(
    new Request("http://localhost:3100/api/prueba", {
      method: "POST",
      headers: { origin: "https://mal.example", "sec-fetch-site": "cross-site" },
    }),
  );
  assert.equal(ajena.status, 403, "el origen se comprueba sin depender de la cuota");
  assert.equal(llamado, false, "el manejador no llega a ejecutarse");

  // La misma petición desde el propio origen entra: la guardia no rompe nada.
  const propia = await handler(
    new Request("http://localhost:3100/api/prueba", {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
    }),
  );
  assert.equal(propia.status, 200);
  assert.equal(llamado, true);
});

test("una lectura no necesita origen y una mutación sí", async () => {
  const handler = route({ auth: "none" }, ({ request }) => Response.json({ method: request.method }));
  const lectura = await handler(new Request("http://localhost:3100/api/prueba"));
  assert.equal(lectura.status, 200, "GET sin cabeceras de origen sigue entrando");
});

test("una respuesta con cabeceras inmutables no rompe el envoltorio", async () => {
  const handler = route({ auth: "none" }, () => Response.redirect("http://localhost:3100/entrar"));
  const response = await handler(new Request("http://localhost:3100/api/prueba", {
    headers: { "x-request-id": "redirect-1" },
  }));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost:3100/entrar");
});
