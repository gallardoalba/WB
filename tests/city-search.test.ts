/**
 * Sugerencias de ciudad (OpenStreetMap/Photon).
 *
 * La ciudad se elige de una lista: estas pruebas fijan cómo se lee la respuesta
 * de Photon (solo municipios de Alemania y Austria, sin calles ni regiones), cómo se mezcla
 * con el catálogo local, que la misma búsqueda no se repite y que un servicio
 * caído no deja el campo vacío.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  citiesFromPhoton,
  localCityMatches,
  searchCities,
} from "../src/lib/city-search.ts";

/** Sustituye `fetch` durante la prueba y devuelve las URLs pedidas. */
async function conFetch<T>(
  responder: (url: URL) => Response,
  run: (calls: URL[]) => Promise<T>,
): Promise<T> {
  const calls: URL[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    return responder(url);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const photons = (features: unknown[]) => () =>
  new Response(JSON.stringify({ type: "FeatureCollection", features }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const feature = (properties: Record<string, unknown>) => ({
  type: "Feature",
  properties,
  geometry: { type: "Point", coordinates: [8.4, 49] },
});

test("de Photon solo valen municipios de Alemania y Austria", () => {
  const cities = citiesFromPhoton({
    features: [
      feature({ countrycode: "DE", osm_key: "place", osm_value: "city", name: "Karlsruhe", state: "Baden-Württemberg" }),
      // Otro país con el mismo nombre: no entra.
      feature({ countrycode: "CZ", osm_key: "place", osm_value: "city", name: "Karlsbad" }),
      feature({ countrycode: "AT", osm_key: "place", osm_value: "city", name: "Graz", state: "Steiermark" }),
      // Una calle y un estado tampoco son ciudades.
      feature({ countrycode: "DE", osm_key: "highway", osm_value: "residential", name: "Karlstraße" }),
      feature({ countrycode: "DE", osm_key: "boundary", osm_value: "administrative", name: "Baden" }),
      // Si falta el código, el nombre del país permite validar el resultado.
      feature({ country: "Deutschland", osm_key: "place", osm_value: "town", name: "Karlstadt" }),
      // Pueblos y municipios son válidos, no solo las ciudades grandes.
      feature({ countrycode: "DE", osm_key: "place", osm_value: "village", name: "Karlsdorf" }),
      // La caja de búsqueda incluye zonas vecinas: sin país no se acepta.
      feature({ osm_key: "place", osm_value: "town", name: "Karlsbad" }),
    ],
  });

  assert.deepEqual(cities, [
    { name: "Karlsruhe", region: "Baden-Württemberg" },
    { name: "Graz", region: "Steiermark" },
    { name: "Karlstadt", region: null },
    { name: "Karlsdorf", region: null },
  ]);
});

test("una respuesta ilegible no es una lista de ciudades", () => {
  for (const payload of [null, undefined, 42, "texto", {}, { features: "x" }, { features: [null, "x", {}] }]) {
    assert.deepEqual(citiesFromPhoton(payload), [], JSON.stringify(payload));
  }
  // El mismo municipio repetido no se ofrece dos veces.
  const repeated = citiesFromPhoton({
    features: [
      feature({ countrycode: "DE", osm_key: "place", osm_value: "town", name: "Neustadt" }),
      feature({ countrycode: "DE", osm_key: "place", osm_value: "town", name: "neustadt" }),
      feature({ countrycode: "AT", osm_key: "place", osm_value: "town", name: "Neustadt" }),
    ],
  });
  assert.deepEqual(repeated.map((city) => city.name), ["Neustadt", "Neustadt (AT)"]);
});

test("el catálogo local responde sin red, primero lo que empieza por lo escrito", () => {
  assert.deepEqual(localCityMatches("Karls"), [{ name: "Karlsruhe", region: null }]);
  // Se ignora mayúsculas y acentos.
  assert.deepEqual(localCityMatches("MUNCHEN"), [{ name: "München", region: null }]);
  assert.deepEqual(localCityMatches("münc"), [{ name: "München", region: null }]);
  assert.deepEqual(localCityMatches("Wien", 1), [{ name: "Wien", region: null }]);
  // Dentro del nombre también cuenta, pero detrás de los que empiezan por ahí.
  const names = localCityMatches("halle").map((city) => city.name);
  assert.equal(names[0], "Halle (Saale)");
  // Con una letra no hay nada que ofrecer.
  assert.deepEqual(localCityMatches("m"), []);
});

test("con una sola letra no se pregunta a nadie", async () => {
  await conFetch(photons([]), async (calls) => {
    assert.deepEqual(await searchCities("k"), []);
    assert.deepEqual(await searchCities("   "), []);
    assert.equal(calls.length, 0);
  });
});

test("las sugerencias juntan el catálogo y el mapa sin repetir", async () => {
  await conFetch(
    photons([
      feature({ countrycode: "DE", osm_key: "place", osm_value: "city", name: "Karlsruhe" }),
      feature({ countrycode: "DE", osm_key: "place", osm_value: "town", name: "Karlstadt" }),
      feature({ countrycode: "DE", osm_key: "place", osm_value: "town", name: "Karlsdorf-Neuthard" }),
    ]),
    async (calls) => {
      const cities = await searchCities("Karls");
      assert.deepEqual(cities, [
        // El del catálogo va primero; el mismo que llega del mapa no se repite.
        { name: "Karlsruhe", region: null },
        { name: "Karlstadt", region: null },
        { name: "Karlsdorf-Neuthard", region: null },
      ]);
      assert.equal(calls.length, 1);
      const url = calls[0]!;
      assert.equal(url.origin + url.pathname, "https://photon.komoot.io/api/");
      assert.equal(url.searchParams.get("q"), "Karls");
      assert.equal(url.searchParams.get("lang"), "de");
      assert.equal(url.searchParams.get("bbox"), "5.87,46.37,17.16,55.06");
    },
  );
});

test("la misma búsqueda no se repite y dos peticiones simultáneas comparten la consulta", async () => {
  await conFetch(photons([feature({ countrycode: "DE", osm_key: "place", osm_value: "city", name: "Rendsburg" })]), async (calls) => {
    const [first, second] = await Promise.all([searchCities("Rendsburg"), searchCities("  rendsburg ")]);
    assert.deepEqual(first, [{ name: "Rendsburg", region: null }]);
    assert.deepEqual(second, first);
    assert.equal(calls.length, 1, "las dos peticiones comparten la consulta");

    // Y la siguiente vez sale de la caché.
    assert.deepEqual(await searchCities("RENDSBURG"), first);
    assert.equal(calls.length, 1);
  });
});

test("si el mapa no responde se ofrecen los municipios conocidos", async () => {
  await conFetch(
    () => {
      throw new Error("ECONNREFUSED");
    },
    async () => {
      assert.deepEqual(await searchCities("Stuttgart"), [{ name: "Stuttgart", region: null }]);
    },
  );
  // Un error HTTP (cuota, mantenimiento) se comporta igual.
  await conFetch(() => new Response("{}", { status: 503 }), async () => {
    assert.deepEqual(await searchCities("Dresden"), [{ name: "Dresden", region: null }]);
  });
});

test("una ráfaga no deja a nadie esperando turno media hora", async () => {
  // La cola es de seis: lo que llega detrás se queda con el catálogo local en
  // vez de encadenar esperas de medio segundo.
  await conFetch(
    photons([feature({ countrycode: "DE", osm_key: "place", osm_value: "town", name: "Testort" })]),
    async (calls) => {
      const queries = ["Qa", "Qb", "Qc", "Qd", "Qe", "Qf", "Qg", "Qh", "Qi", "Qj"];
      const results = await Promise.all(queries.map((query) => searchCities(query)));
      assert.equal(results.length, queries.length);
      assert.ok(calls.length <= 6, `se hicieron ${calls.length} consultas al mapa`);
    },
  );
});
