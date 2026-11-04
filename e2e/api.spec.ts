import { expect, test } from "@playwright/test";

/**
 * Pruebas de los route handlers contra el servidor real: cubren la capa que
 * queda entre el navegador y el repositorio (guard, CSRF, zod, sesión), que los
 * tests de `tests/` no pueden ejercitar porque `next/headers` necesita una
 * petición de verdad.
 */

const DEMO = { email: "ana@book2peer.test", password: "demo1234" };

test("las mutaciones exigen JSON", async ({ request }) => {
  const response = await request.post("/api/auth/login", {
    headers: { "content-type": "text/plain" },
    data: "email=ana@book2peer.test&password=demo1234",
  });
  expect(response.status()).toBe(415);
});

test("las mutaciones con origen ajeno se rechazan (CSRF)", async ({ request }) => {
  const response = await request.post("/api/auth/login", {
    headers: { origin: "https://mal.example" },
    data: DEMO,
  });
  expect(response.status()).toBe(403);
});

test("el login falla con un mensaje genérico y sin filtrar la cuenta", async ({ request }) => {
  // Correo inexistente para no gastar la cuota de una cuenta demo.
  const unknown = await request.post("/api/auth/login", {
    data: { email: `nadie-${Date.now()}@example.test`, password: "lo-que-sea" },
  });
  expect(unknown.status()).toBe(401);
  const body = await unknown.json();
  expect(body.error).toBeTruthy();
  expect(JSON.stringify(body)).not.toMatch(/demo1234|no existe/i);
});

test("las rutas privadas piden sesión", async ({ request }) => {
  expect((await request.get("/api/requests")).status()).toBe(401);
  expect((await request.get("/api/account/export")).status()).toBe(401);
});

test("la administración exige rol y la sesión da acceso al resto", async ({ request }) => {
  const login = await request.post("/api/auth/login", { data: DEMO });
  expect(login.status()).toBe(200);

  const requests = await request.get("/api/requests");
  expect(requests.status()).toBe(200);
  expect(Array.isArray((await requests.json()).requests)).toBe(true);

  // Ana no es administradora.
  expect((await request.get("/api/admin/reports")).status()).toBe(403);
});

test("un cuerpo inválido devuelve 422 con el formato de errores", async ({ request }) => {
  await request.post("/api/auth/login", { data: DEMO });
  const response = await request.post("/api/listings", { data: { title: "" } });
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(typeof body.error).toBe("string");
  expect(Array.isArray(body.issues)).toBe(true);
});
