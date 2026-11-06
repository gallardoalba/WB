import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Ciudades de toda Europa.
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
  assert.equal(cityFromNominatim([{ name: "", address: { country: "Frankreich" } }]), null);
});

test("Nominatim da el nombre local de la ciudad", async () => {
  const { cityFromNominatim } = await import("../src/lib/geocode.ts");
  assert.equal(
    cityFromNominatim([
      { name: "Lyon", lat: "45.7578", lon: "4.8320", address: { city: "Lyon", country_code: "fr" } },
    ]),
    "Lyon",
  );
  // Los pueblos llegan como `village` o `municipality`, no como `city`.
  assert.equal(
    cityFromNominatim([{ address: { village: "Saint-Cirq-Lapopie" }, name: "Saint-Cirq-Lapopie" }]),
    "Saint-Cirq-Lapopie",
  );
  assert.equal(
    cityFromNominatim([{ address: { municipality: "Vila Nova de Gaia" }, name: "Vila Nova de Gaia" }]),
    "Vila Nova de Gaia",
  );
  // Sin `address` se acepta el nombre propio del resultado.
  assert.equal(cityFromNominatim([{ name: "Braga" }]), "Braga");
});

test("el formulario acepta ciudades de cualquier país", async () => {
  const { registerSchema } = await import("../src/lib/validation.ts");
  const base = {
    name: "Prueba",
    email: "prueba@example.org",
    password: "una-clave-larga-9",
    ageConfirmed: true,
  };
  for (const city of ["Lyon", "Milano", "Porto", "Kraków", "zürich"]) {
    const parsed = registerSchema.parse({ ...base, city });
    assert.equal(typeof parsed.city, "string");
    assert.ok(parsed.city.length > 1, city);
  }
  // La forma sí se comprueba: ni vacío ni una letra.
  assert.throws(() => registerSchema.parse({ ...base, city: "" }));
  assert.throws(() => registerSchema.parse({ ...base, city: "x" }));
});
