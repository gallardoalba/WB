import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Ciudades de toda Alemania.
 *
 * La lista cerrada de municipios alemanes dejó de ser la puerta: lo que escribe
 * una persona se contrasta con OpenStreetMap. Estas pruebas cubren la parte que
 * no necesita red (el catálogo de siempre, la lectura de la respuesta de
 * Nominatim y la validación del formulario).
 */

test("las ciudades del catálogo se reconocen sin preguntar a OpenStreetMap", async () => {
  const { resolveCity } = await import("../src/lib/geocode.ts");
  // Sin acentos, en minúsculas o con el nombre exacto: siempre la misma.
  for (const written of ["München", "munchen", "MUNCHEN", "  München  "]) {
    const found = await resolveCity(written);
    assert.deepEqual(found, { status: "found", name: "München" }, written);
  }
});

test("una respuesta de Nominatim sin ciudad no vale", async () => {
  const { cityFromNominatim } = await import("../src/lib/geocode.ts");
  assert.equal(cityFromNominatim([]), null);
  assert.equal(cityFromNominatim(null), null);
  assert.equal(cityFromNominatim([{ name: "  " }]), null);
  // Un resultado que solo identifica un país o una calle no es una ciudad.
  assert.equal(cityFromNominatim([{ name: "", address: { country: "Deutschland" } }]), null);
});

test("Nominatim da el nombre local de la ciudad", async () => {
  const { cityFromNominatim } = await import("../src/lib/geocode.ts");
  assert.equal(
    cityFromNominatim([
      { name: "Freising", lat: "48.4030", lon: "11.7485", address: { city: "Freising", country_code: "de" } },
    ]),
    "Freising",
  );
  // Los pueblos llegan como `village` o `municipality`, no como `city`.
  assert.equal(
    cityFromNominatim([{ address: { village: "Spiekeroog" }, name: "Spiekeroog" }]),
    "Spiekeroog",
  );
  assert.equal(
    cityFromNominatim([{ address: { municipality: "Nordhorn" }, name: "Nordhorn" }]),
    "Nordhorn",
  );
  // Sin `address` se acepta el nombre propio del resultado.
  assert.equal(cityFromNominatim([{ name: "Rendsburg" }]), "Rendsburg");
});

test("el formulario acepta cualquier ciudad alemana", async () => {
  const { registerSchema } = await import("../src/lib/validation.ts");
  const base = {
    name: "Prueba",
    email: "prueba@example.org",
    password: "una-clave-larga-9",
    ageConfirmed: true,
  };
  for (const city of ["Rendsburg", "Cuxhaven", "Bad Tölz", "Garmisch-Partenkirchen", "Spiekeroog"]) {
    const parsed = registerSchema.parse({ ...base, city });
    assert.equal(typeof parsed.city, "string");
    assert.ok(parsed.city.length > 1, city);
  }
  // La forma sí se comprueba: ni vacío ni una letra.
  assert.throws(() => registerSchema.parse({ ...base, city: "" }));
  assert.throws(() => registerSchema.parse({ ...base, city: "x" }));
});
