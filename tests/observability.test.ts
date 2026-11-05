import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { z } from "zod";

import { handleApiError, readJson } from "../src/lib/api.ts";
import { getCover, pruneCoverCache } from "../src/lib/covers.ts";
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

/* --------------------------------- portadas -------------------------------- */

/** PNG de mentira: solo importan la firma y el tamaño mínimo. */
function pngDe(bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes, 0x20);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return buffer;
}

function cacheNueva(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-covers-"));
  process.env.WANDERBIBLIOTHEK_COVER_CACHE = dir;
  return dir;
}

async function conFetch<T>(
  fake: (url: string) => Promise<Response>,
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return fake(String(input));
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("un ISBN inválido no llega a pedir nada al proveedor", async () => {
  cacheNueva();
  await conFetch(
    async () => new Response(new Uint8Array(pngDe(2_000))),
    async (calls) => {
      assert.equal(await getCover("../../etc/passwd"), null);
      assert.equal(await getCover("12345"), null);
      assert.deepEqual(calls, []);
    },
  );
});

test("una portada válida se guarda y la segunda visita no llama al proveedor", async () => {
  const dir = cacheNueva();
  await conFetch(
    async () => new Response(new Uint8Array(pngDe(2_000))),
    async (calls) => {
      const first = await getCover("9788420412146");
      assert.equal(first?.contentType, "image/png");
      assert.ok((first?.data.length ?? 0) >= 1_000);

      // Varias fuentes a la vez: basta con que una traiga la imagen.
      const intentos = calls.length;
      assert.ok(intentos >= 1);
      const second = await getCover("9788420412146");
      assert.equal(second?.contentType, "image/png");
      assert.equal(calls.length, intentos, "la segunda lectura sale de la caché en disco");
      assert.deepEqual(readdirSync(dir), ["9788420412146.img"]);
    },
  );
});

test("el 1×1 del proveedor no es una portada y se recuerda como ausente", async () => {
  const dir = cacheNueva();
  const tiny = Buffer.from("GIF89a" + "x".repeat(30));
  await conFetch(
    async () => new Response(new Uint8Array(tiny)),
    async (calls) => {
      assert.equal(await getCover("9788420412146"), null);
      // Cada proveedor devuelve lo mismo (el 1×1): se prueban todos y se anota
      // que ese ISBN no tiene portada en ninguno.
      assert.ok(
        readdirSync(dir).some((file) => file.endsWith(".miss")),
        "se recuerda que no hay portada",
      );
      const intentos = calls.length;
      assert.ok(intentos >= 2, "se prueba más de un proveedor");
      // La marca evita repetir la búsqueda en cada visita.
      assert.equal(await getCover("9788420412146"), null);
      assert.equal(calls.length, intentos);
    },
  );
});

test("un error del proveedor no rompe la ficha: solo no hay portada", async () => {
  cacheNueva();
  await conFetch(
    async () => new Response("no encontrado", { status: 404 }),
    async () => assert.equal(await getCover("9788420412146"), null),
  );

  cacheNueva();
  await conFetch(
    async () => {
      throw new Error("ETIMEDOUT");
    },
    async () => assert.equal(await getCover("9788433998873"), null),
  );
});

test("una respuesta demasiado grande se descarta antes de leerla entera", async () => {
  cacheNueva();
  await conFetch(
    async () =>
      new Response("x", { headers: { "content-length": String(9 * 1024 * 1024) } }),
    async () => assert.equal(await getCover("9788420412146"), null),
  );
});

test("una caché vieja se poda y la reciente se queda", () => {
  const dir = cacheNueva();
  writeFileSync(path.join(dir, "9788420412146.img"), pngDe(1_500));
  writeFileSync(path.join(dir, "9788433998873.miss"), "");
  writeFileSync(path.join(dir, "notas.txt"), "no es una portada");
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  utimesSync(path.join(dir, "9788420412146.img"), old, old);

  assert.equal(pruneCoverCache(180), 1);
  assert.deepEqual(readdirSync(dir).sort(), ["9788433998873.miss", "notas.txt"]);
  rmSync(dir, { recursive: true, force: true });
});
