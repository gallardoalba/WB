/**
 * Comprobación de la ciudad contra OpenStreetMap (Nominatim).
 *
 * La ciudad es texto libre: se acepta lo que escribe la persona y se contrasta
 * con el mapa. Lo que se fija aquí:
 *
 * - una ciudad del catálogo se reconoce sin red,
 * - la respuesta se lee por campos (ciudad, villa, municipio…) y no por el
 *   nombre del resultado, que puede ser una calle,
 * - la misma búsqueda no se repite (caché),
 * - si el servicio no responde, el alta no se bloquea: se devuelve
 *   «no disponible» y quien llama decide.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { cityFromNominatim, resolveCity } from "../src/lib/geocode.ts";

type Llamada = { url: URL };

/** Sustituye `fetch` durante la prueba y devuelve las URLs pedidas. */
async function conFetch<T>(responder: () => Response, run: (calls: Llamada[]) => Promise<T>): Promise<T> {
  const calls: Llamada[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push({ url: new URL(String(input)) });
    return responder();
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const nominatim = (payload: unknown) => () =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("de la respuesta de Nominatim se usa el núcleo de población", () => {
  assert.equal(
    cityFromNominatim([{ address: { city: "  Barcelona  " } }]),
    "Barcelona",
    "se recorta el espacio sobrante",
  );
  assert.equal(cityFromNominatim([{ address: { town: "Girona" } }]), "Girona");
  assert.equal(cityFromNominatim([{ address: { village: "Calella" } }]), "Calella");
  assert.equal(cityFromNominatim([{ address: { municipality: "El Vendrell" } }]), "El Vendrell");
  assert.equal(cityFromNominatim([{ address: { hamlet: "La Beguda" } }]), "La Beguda");

  // Un resultado sin dirección sigue valiendo si trae nombre propio.
  assert.equal(cityFromNominatim([{ name: "Cádiz" }]), "Cádiz");

  for (const payload of [null, undefined, [], "texto", 42, [null], [{}], [{ address: {} }]]) {
    assert.equal(cityFromNominatim(payload), null, `${JSON.stringify(payload)} no es una ciudad`);
  }
  // Un campo vacío no se toma por nombre: se sigue mirando el siguiente.
  assert.equal(
    cityFromNominatim([{ address: { city: "   ", town: "Sitges" } }]),
    "Sitges",
  );
});

test("sin texto no se pregunta a nadie", async () => {
  await conFetch(nominatim([]), async (calls) => {
    assert.deepEqual(await resolveCity("   "), { status: "unknown" });
    assert.deepEqual(await resolveCity(""), { status: "unknown" });
    assert.equal(calls.length, 0);
  });
});

test("una ciudad del catálogo se reconoce sin salir a la red", async () => {
  await conFetch(nominatim([]), async (calls) => {
    // El índice ignora mayúsculas y acentos.
    assert.deepEqual(await resolveCity("  stuttgart "), { status: "found", name: "Stuttgart" });
    assert.equal(calls.length, 0, "las ciudades conocidas no necesitan Nominatim");
  });
});

test("una ciudad nueva se busca una sola vez y queda en caché", async () => {
  await conFetch(nominatim([{ address: { city: "Barcelona" } }]), async (calls) => {
    assert.deepEqual(await resolveCity("Barcelona"), { status: "found", name: "Barcelona" });
    assert.equal(calls.length, 1);

    const url = calls[0]!.url;
    assert.equal(url.origin + url.pathname, "https://nominatim.openstreetmap.org/search");
    assert.equal(url.searchParams.get("q"), "Barcelona");
    assert.equal(url.searchParams.get("format"), "jsonv2");
    assert.equal(url.searchParams.get("addressdetails"), "1");
    assert.equal(url.searchParams.get("limit"), "1");
    assert.match(url.searchParams.get("countrycodes") ?? "", /\b(es|de|fr)\b/);

    // Misma ciudad escrita de otra forma: sale de la caché, sin otra petición.
    assert.deepEqual(await resolveCity("  barcelona "), { status: "found", name: "Barcelona" });
    assert.equal(calls.length, 1, "la caché evita repetir la consulta");
  });
});

test("una respuesta vacía es «no existe», no un fallo de red", async () => {
  await conFetch(nominatim([]), async () => {
    assert.deepEqual(await resolveCity("Ciudad Inexistente"), { status: "unknown" });
  });
});

test("un servicio caído o una respuesta ilegible no bloquean el alta", async () => {
  // Error HTTP: mantenimiento, cuota…
  await conFetch(() => new Response("{}", { status: 503 }), async () => {
    assert.deepEqual(await resolveCity("Lisboa"), { status: "unavailable" });
  });
  // Error de red (DNS, timeout…).
  await conFetch(
    () => {
      throw new Error("ECONNREFUSED");
    },
    async () => {
      assert.deepEqual(await resolveCity("Porto"), { status: "unavailable" });
    },
  );
  // 200 con HTML (portal cautivo): `json()` falla y tampoco se bloquea.
  await conFetch(() => new Response("<html>captcha</html>", { status: 200 }), async () => {
    assert.deepEqual(await resolveCity("Roma"), { status: "unavailable" });
  });
});
