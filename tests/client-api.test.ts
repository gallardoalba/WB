import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { api, ClientApiError } from "../src/lib/client-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respondWith(body: unknown, status: number) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("un 422 enseña el problema concreto, no el mensaje genérico", async () => {
  respondWith(
    {
      error: "Revisa los datos del formulario.",
      issues: [
        { path: "title", message: "El título debe tener al menos 2 caracteres." },
        { path: "isbn", message: "El ISBN no es válido." },
      ],
    },
    422,
  );

  await assert.rejects(api("/api/listings", { method: "POST", body: {} }), (error: unknown) => {
    assert.ok(error instanceof ClientApiError);
    assert.equal(error.status, 422);
    // «Revisa los datos del formulario» no dice qué arreglar: el primer
    // problema concreto sí.
    assert.equal(error.message, "El título debe tener al menos 2 caracteres.");
    assert.equal(error.issues.length, 2);
    return true;
  });
});

test("sin red el mensaje es humano, no «Failed to fetch»", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  await assert.rejects(api("/api/health"), (error: unknown) => {
    assert.ok(error instanceof ClientApiError);
    assert.equal(error.status, 0);
    assert.match(error.message, /No hay conexión con el servidor/);
    return true;
  });
});

test("un 500 conserva el mensaje del servidor y su referencia", async () => {
  respondWith({ error: "Ha ocurrido un error inesperado.", reference: "abc12345" }, 500);

  await assert.rejects(api("/api/health"), (error: unknown) => {
    assert.ok(error instanceof ClientApiError);
    assert.equal(error.message, "Ha ocurrido un error inesperado.");
    assert.deepEqual(error.body, { error: "Ha ocurrido un error inesperado.", reference: "abc12345" });
    return true;
  });
});

test("un 429 sin cuerpo útil deja un mensaje accionable", async () => {
  globalThis.fetch = (async () =>
    new Response("", { status: 429, headers: { "retry-after": "60" } })) as typeof fetch;

  await assert.rejects(api("/api/auth/login", { method: "POST", body: {} }), (error: unknown) => {
    assert.ok(error instanceof ClientApiError);
    assert.equal(error.status, 429);
    assert.match(error.message, /Espera un momento/);
    return true;
  });
});
