/**
 * Endpoint del cron de mantenimiento.
 *
 * El timer dispara cada 15 minutos (4 pasadas por hora) y el endpoint se
 * protege con un limitador propio. Ese límite llegó a ser 6/h: cualquier
 * despliegue o prueba manual que llamara a mano dejaba la siguiente pasada sin
 * ejecutar (429) y la unidad de systemd aparecía como `failed` sin que nada
 * estuviera roto. Aquí se fija que el margen cubre de sobra el ritmo real y que
 * el token sigue siendo obligatorio.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";
process.env.MAINTENANCE_TOKEN = "token-de-prueba";

let POST: (request: Request) => Promise<Response>;

before(async () => {
  // Se importa después de fijar el entorno: el módulo lee `MAINTENANCE_TOKEN`
  // en cada llamada, pero la base se abre al importar.
  ({ POST } = await import("../src/app/api/cron/maintenance/route.ts"));
});

const llamada = (token = "token-de-prueba") =>
  POST(
    new Request("http://localhost:3000/api/cron/maintenance", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
  );

test("sin el token correcto no se ejecuta nada", async () => {
  const response = await llamada("otro-token");
  assert.equal(response.status, 401);
});

test("ocho pasadas seguidas no se topan con el limitador", async () => {
  const codigos: number[] = [];
  for (let pasada = 0; pasada < 8; pasada += 1) {
    codigos.push((await llamada()).status);
  }
  assert.deepEqual(
    codigos,
    Array.from({ length: 8 }, () => 200),
    "el doble del ritmo del timer tiene que caber en la ventana",
  );
});
