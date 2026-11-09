import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import { handleApiError, readJson } from "../src/lib/api.ts";
import { ApiError } from "../src/lib/errors.ts";
import {
  recordRequest,
  requestIdFrom,
  sanitizeRequestId,
} from "../src/lib/observability.ts";

/**
 * Caminos de error de la capa HTTP.
 *
 * Son los que casi nunca se recorren a mano y los que deciden si un fallo se
 * ve como un JSON con un id o como un 500 sin cuerpo: `readJson` (415, 413,
 * 400), `handleApiError` (422/429/500 y los errores de control de Next) y la
 * descarga de portadas, donde todo fallo del proveedor debe quedarse en «no hay
 * imagen» en vez de romper la ficha.
 */

/* ------------------------------- id de petición ---------------------------- */

test("un id de fuera solo se acepta si es inocuo", () => {
  assert.equal(sanitizeRequestId("abc12345"), "abc12345");
  assert.equal(sanitizeRequestId("a1b2-c3d4.e5_f6"), "a1b2-c3d4.e5_f6");
  assert.equal(sanitizeRequestId("  abc12345  "), "abc12345");
  // Demasiado corto, con espacios, saltos de línea o longitud desmedida.
  assert.equal(sanitizeRequestId("corto"), null);
  assert.equal(sanitizeRequestId("con espacio aqui"), null);
  assert.equal(sanitizeRequestId("linea\nnueva"), null);
  assert.equal(sanitizeRequestId("a".repeat(65)), null);
  assert.equal(sanitizeRequestId(""), null);
  assert.equal(sanitizeRequestId(null), null);
});

test("el id del proxy se conserva y, si no hay, se genera uno", () => {
  const withHeader = requestIdFrom(new Headers({ "x-request-id": "proxy-000123" }));
  assert.equal(withHeader, "proxy-000123");

  const generated = requestIdFrom(new Headers());
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(generated, requestIdFrom(new Headers()), "cada petición, un id");
});

test("cada petición deja una línea de registro con su id", () => {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn };
  console.log = (line: string) => void lines.push(line);
  console.warn = (line: string) => void lines.push(line);
  try {
    recordRequest({ id: "abc12345", method: "GET", path: "/api/lists", status: 200, ms: 3.44 });
    recordRequest({ id: "abc12346", method: "POST", path: "/api/lists", status: 429, ms: 812 });
  } finally {
    console.log = original.log;
    console.warn = original.warn;
  }

  assert.equal(lines.length, 2);
  const fast = JSON.parse(lines[0]!.replace("[req] ", "")) as Record<string, unknown>;
  assert.equal(fast.id, "abc12345");
  assert.equal(fast.status, 200);
  assert.equal(fast.ms, 3.4);
  assert.equal(fast.level, "info");
  assert.equal(fast.slow, undefined);

  const slow = JSON.parse(lines[1]!.replace("[req] ", "")) as Record<string, unknown>;
  assert.equal(slow.level, "warn");
  assert.equal(slow.slow, true);
  assert.equal(slow.status, 429);
});

/* ---------------------------------- cuerpo --------------------------------- */

const jsonPost = (body: string, contentType = "application/json") =>
  new Request("http://localhost:3100/api/prueba", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });

test("un cuerpo que no es JSON se rechaza con 415", async () => {
  await assert.rejects(
    () => readJson(jsonPost("a=1", "application/x-www-form-urlencoded")),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 415);
      assert.match(error.message, /application\/json/);
      return true;
    },
  );
});

test("el tope de cuerpo se aplica con y sin content-length", async () => {
  const declared = new Request("http://localhost:3100/api/prueba", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(200 * 1024) },
    body: "{}",
  });
  await assert.rejects(() => readJson(declared), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 413);
    return true;
  });

  // Sin cabecera: se corta mientras se lee, no después de tenerlo en memoria.
  const streamed = jsonPost(JSON.stringify({ relleno: "x".repeat(80 * 1024) }));
  await assert.rejects(() => readJson(streamed), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 413);
    return true;
  });
});

test("un JSON roto o vacío no llega al manejador", async () => {
  for (const body of ["{", "", "no-json"]) {
    await assert.rejects(() => readJson(jsonPost(body)), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test("un cuerpo válido se devuelve tal cual", async () => {
  assert.deepEqual(await readJson(jsonPost('{"title":"El Quijote"}')), {
    title: "El Quijote",
  });
});

/* ---------------------------------- errores -------------------------------- */

test("un ZodError sale como 422 con la ruta de cada campo", async () => {
  const schema = z.object({ title: z.string().min(3), year: z.number() });
  const result = schema.safeParse({ title: "ab" });
  assert.equal(result.success, false);

  const response = await handleApiError(result.error);
  assert.equal(response.status, 422);
  const payload = (await response.json()) as { issues: { path: string }[] };
  assert.deepEqual(
    payload.issues.map((issue) => issue.path).sort(),
    ["title", "year"],
  );
});

test("ApiError conserva estado, detalles y Retry-After", async () => {
  const limited = await handleApiError(
    new ApiError(429, "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.", {
      retryAfter: 30,
    }),
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "30");

  const detailed = await handleApiError(
    new ApiError(409, "Ese ejemplar ya no está disponible.", { details: { id: "lst_1" } }),
  );
  assert.equal(detailed.status, 409);
  assert.deepEqual((await detailed.json()) as unknown, {
    error: "Ese ejemplar ya no está disponible.",
    details: { id: "lst_1" },
  });
});

test("un fallo inesperado devuelve la referencia del id, no la traza", async () => {
  const response = await handleApiError(new Error("fallo interno con SELECT secreto"), {
    requestId: "8f14e45f-ceea-467a-9575-0f9d1e1c1b2a",
  });
  assert.equal(response.status, 500);
  const payload = (await response.json()) as { error: string; reference: string };
  assert.equal(payload.reference, "8f14e45f");
  assert.doesNotMatch(payload.error, /SELECT/);
});

test("los errores de control de Next se propagan en vez de convertirse en 500", async () => {
  for (const digest of ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "DYNAMIC_SERVER_USAGE"]) {
    await assert.rejects(
      () => handleApiError(Object.assign(new Error("control"), { digest })),
      (error: unknown) => {
        assert.equal((error as { digest: string }).digest, digest);
        return true;
      },
    );
  }
  // También el mensaje que Next lanza al tocar datos durante el prerender.
  await assert.rejects(
    () =>
      handleApiError(
        new Error("During prerendering, `cookies()` rejects when the prerender is complete."),
      ),
    /prerendering/,
  );
});

/* --------------------------- webhook de errores ---------------------------- */

test("con ERROR_WEBHOOK_URL el error se envía fuera, con token y sin bloquear", async () => {
  const { reportError } = await import("../src/lib/observability.ts");
  process.env.ERROR_WEBHOOK_URL = "https://avisos.example.test/errores";
  process.env.ERROR_WEBHOOK_TOKEN = "token-de-prueba";

  const enviados: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    enviados.push({ url: String(input), init });
    return new Response("ok");
  }) as typeof fetch;
  const consola = console.error;
  const errores: string[] = [];
  console.error = (...args: unknown[]) => errores.push(args.join(" "));

  try {
    // Un valor que no es un Error también se registra: lo que llega puede ser
    // cualquier cosa lanzada desde una ruta.
    reportError("algo raro", { reference: "abcd1234", scope: "api" });
    reportError(new Error("fallo interno"), { scope: "api" });

    // El envío es asíncrono y no se espera: se le da un turno al bucle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(enviados.length, 2, "cada error se manda al webhook");
    assert.equal(enviados[0]!.url, "https://avisos.example.test/errores");
    const cabeceras = enviados[0]!.init?.headers as Record<string, string>;
    assert.equal(cabeceras.authorization, "Bearer token-de-prueba", "lleva el token configurado");
    assert.equal(cabeceras["content-type"], "application/json");

    const cuerpo = JSON.parse(String(enviados[1]!.init?.body)) as {
      level: string;
      message: string;
      context: Record<string, unknown>;
    };
    assert.equal(cuerpo.level, "error");
    assert.equal(cuerpo.message, "fallo interno");
    assert.deepEqual(cuerpo.context, { scope: "api" });
    assert.ok(errores.some((linea) => linea.includes("fallo interno")), "también queda en consola");
  } finally {
    globalThis.fetch = original;
    console.error = consola;
    delete process.env.ERROR_WEBHOOK_URL;
    delete process.env.ERROR_WEBHOOK_TOKEN;
  }
});

test("un webhook que falla no rompe la respuesta ni ensucia el registro de errores", async () => {
  const { reportError } = await import("../src/lib/observability.ts");
  process.env.ERROR_WEBHOOK_URL = "https://avisos.example.test/roto";
  delete process.env.ERROR_WEBHOOK_TOKEN;

  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("sin red");
  }) as typeof fetch;
  const consola = { error: console.error, warn: console.warn };
  const avisos: string[] = [];
  console.error = () => undefined;
  console.warn = (...args: unknown[]) => avisos.push(args.join(" "));

  try {
    reportError(new Error("fallo con webhook roto"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(
      avisos.some((linea) => linea.includes("no se pudo enviar el error al webhook")),
      "el fallo del webhook se anota como aviso, no como error",
    );
  } finally {
    globalThis.fetch = original;
    console.error = consola.error;
    console.warn = consola.warn;
    delete process.env.ERROR_WEBHOOK_URL;
  }
});

test("lo que sale hacia el webhook va redactado: ni correos, ni tokens, ni claves", async () => {
  const { reportError, redactarTexto, redactarContexto } = await import(
    "../src/lib/observability.ts"
  );

  // Texto suelto: el correo conserva el dominio (sirve para diagnosticar) y se
  // tapa la parte que identifica a la persona.
  assert.equal(
    redactarTexto("no se pudo avisar a lectora@example.org"),
    "no se pudo avisar a l***@example.org",
  );
  assert.equal(redactarTexto("Authorization: Bearer abc.def-123"), "Authorization: Bearer [oculto]");
  assert.equal(redactarTexto("token 0123456789abcdef0123456789abcdef"), "token [token]");
  assert.ok(redactarTexto("x".repeat(500)).length <= 301, "los textos se recortan");

  // Contexto: las claves sensibles no se serializan y los objetos anidados se
  // recorren con un tope de profundidad.
  assert.deepEqual(
    redactarContexto({
      scope: "api",
      email: "lectora@example.org",
      password: "secreto",
      token: "abc",
      nested: { nota: "hola lectora@example.org", nivel: { fondo: "no llego" } },
    }),
    {
      scope: "api",
      email: "[oculto]",
      password: "[oculto]",
      token: "[oculto]",
      nested: { nota: "hola l***@example.org", nivel: "[…]" },
    },
  );

  process.env.ERROR_WEBHOOK_URL = "https://avisos.example.test/redactado";
  const enviados: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    enviados.push(String(init?.body));
    return new Response("ok");
  }) as typeof fetch;
  const consola = console.error;
  console.error = () => undefined;

  try {
    reportError(new Error("fallo al enviar a lectora@example.org"), {
      email: "lectora@example.org",
      authorization: "Bearer abc.def",
      requestId: "req_1",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(enviados.length, 1);
    assert.equal(enviados[0]!.includes("lectora@example.org"), false, "el correo no viaja entero");
    assert.equal(enviados[0]!.includes("Bearer abc.def"), false, "el token no viaja");
    assert.match(enviados[0]!, /l\*\*\*@example\.org/);
    assert.match(enviados[0]!, /req_1/, "lo que sí ayuda a diagnosticar se conserva");
  } finally {
    globalThis.fetch = original;
    console.error = consola;
    delete process.env.ERROR_WEBHOOK_URL;
  }
});

test("el journal recibe el error redactado, no el objeto original", async () => {
  const { reportError } = await import("../src/lib/observability.ts");
  delete process.env.ERROR_WEBHOOK_URL;

  const lineas: unknown[][] = [];
  const consola = console.error;
  console.error = (...args: unknown[]) => void lineas.push(args);

  try {
    const original = new Error("falló el envío a lectora@example.org");
    // Propiedad enumerable a propósito: si el objeto se volcara tal cual,
    // aparecería en la línea del journal.
    Object.defineProperty(original, "token", { value: "Bearer abc.def", enumerable: true });
    reportError(original, { email: "lectora@example.org", requestId: "req_7" });

    assert.equal(lineas.length, 1);
    const volcado = JSON.stringify(lineas[0]);
    assert.equal(volcado.includes("lectora@example.org"), false, "el correo no llega al journal");
    assert.equal(volcado.includes("Bearer abc.def"), false, "el token no llega al journal");
    assert.match(volcado, /l\*\*\*@example\.org/);

    const extra = lineas[0]![1] as { context: unknown; stack?: string };
    assert.deepEqual(extra.context, { email: "[oculto]", requestId: "req_7" });
    assert.equal(typeof extra.stack, "string", "la traza sigue ahí, pero redactada");
  } finally {
    console.error = consola;
  }
});
