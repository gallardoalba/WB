import type { Locale } from "./locale";
import { normalizeText } from "./text";

export type City = { name: string; lat: number; lng: number };

/**
 * Ciudades con coordenadas reales (GeoNames vía Open-Meteo) para calcular
 * distancias.
 *
 * La plataforma se dirige a toda Europa y hoy la lista es de ciudades alemanas:
 * son los ejemplares que hay. La lista es cerrada para poder calcular distancias
 * y validar; crece añadiendo filas.
 */
export const CITIES: City[] = [
  { name: "Aachen", lat: 50.7766, lng: 6.0834 }, { name: "Aalen", lat: 48.8378, lng: 10.0933 },
  { name: "Albstadt", lat: 48.2164, lng: 9.026 }, { name: "Baden-Baden", lat: 48.7606, lng: 8.2398 },
  { name: "Bamberg", lat: 49.8987, lng: 10.9007 }, { name: "Bayreuth", lat: 49.9478, lng: 11.5789 },
  { name: "Berlin", lat: 52.5244, lng: 13.4105 }, { name: "Bielefeld", lat: 52.0333, lng: 8.5333 },
  { name: "Bochum", lat: 51.4817, lng: 7.2165 }, { name: "Bonn", lat: 50.7344, lng: 7.0955 },
  { name: "Braunschweig", lat: 52.2659, lng: 10.5267 }, { name: "Bremen", lat: 53.0758, lng: 8.8072 },
  { name: "Bremerhaven", lat: 53.5536, lng: 8.5755 }, { name: "Böblingen", lat: 48.6821, lng: 9.0117 },
  { name: "Calw", lat: 48.7142, lng: 8.7403 }, { name: "Celle", lat: 52.6226, lng: 10.0805 },
  { name: "Chemnitz", lat: 50.8357, lng: 12.9292 }, { name: "Cottbus", lat: 51.7577, lng: 14.3289 },
  { name: "Crailsheim", lat: 49.1344, lng: 10.0719 }, { name: "Darmstadt", lat: 49.8717, lng: 8.6503 },
  { name: "Delmenhorst", lat: 53.0511, lng: 8.6309 }, { name: "Dessau-Roßlau", lat: 51.8386, lng: 12.2455 },
  { name: "Dortmund", lat: 51.5149, lng: 7.466 }, { name: "Dresden", lat: 51.0509, lng: 13.7383 },
  { name: "Duisburg", lat: 51.4325, lng: 6.7652 }, { name: "Düsseldorf", lat: 51.2232, lng: 6.7793 },
  { name: "Erfurt", lat: 50.9773, lng: 11.0354 }, { name: "Erlangen", lat: 49.591, lng: 11.0078 },
  { name: "Essen", lat: 51.4566, lng: 7.0123 }, { name: "Esslingen am Neckar", lat: 48.7396, lng: 9.3047 },
  { name: "Flensburg", lat: 54.788, lng: 9.4372 }, { name: "Frankfurt am Main", lat: 50.1155, lng: 8.6842 },
  { name: "Freiburg im Breisgau", lat: 47.9959, lng: 7.8522 }, { name: "Friedrichshafen", lat: 47.6569, lng: 9.4755 },
  { name: "Fulda", lat: 50.5516, lng: 9.6752 }, { name: "Gelsenkirchen", lat: 51.5051, lng: 7.0965 },
  { name: "Gera", lat: 50.8803, lng: 12.0819 }, { name: "Greifswald", lat: 54.0891, lng: 13.4024 },
  { name: "Göppingen", lat: 48.7035, lng: 9.6521 }, { name: "Görlitz", lat: 51.1552, lng: 14.9885 },
  { name: "Göttingen", lat: 51.5344, lng: 9.9323 }, { name: "Gütersloh", lat: 51.9069, lng: 8.3785 },
  { name: "Hagen", lat: 51.3608, lng: 7.4717 }, { name: "Halle (Saale)", lat: 51.4816, lng: 11.9795 },
  { name: "Hamburg", lat: 53.5507, lng: 9.993 }, { name: "Hamm", lat: 51.6803, lng: 7.8209 },
  { name: "Hanau", lat: 50.1342, lng: 8.9142 }, { name: "Hannover", lat: 52.3705, lng: 9.7332 },
  { name: "Heidelberg", lat: 49.4077, lng: 8.6908 }, { name: "Heidenheim an der Brenz", lat: 48.678, lng: 10.1516 },
  { name: "Heilbronn", lat: 49.1399, lng: 9.2205 }, { name: "Hildesheim", lat: 52.1508, lng: 9.9511 },
  { name: "Ingolstadt", lat: 48.7651, lng: 11.4237 }, { name: "Iserlohn", lat: 51.3755, lng: 7.7028 },
  { name: "Jena", lat: 50.9288, lng: 11.5899 }, { name: "Kaiserslautern", lat: 49.443, lng: 7.7716 },
  { name: "Karlsruhe", lat: 49.0094, lng: 8.4044 }, { name: "Kassel", lat: 51.3167, lng: 9.5 },
  { name: "Kempten", lat: 47.7267, lng: 10.3139 }, { name: "Kiel", lat: 54.3213, lng: 10.1349 },
  { name: "Koblenz", lat: 50.3536, lng: 7.5788 }, { name: "Konstanz", lat: 47.6603, lng: 9.1758 },
  { name: "Krefeld", lat: 51.3364, lng: 6.5538 }, { name: "Köln", lat: 50.9333, lng: 6.95 },
  { name: "Landshut", lat: 48.5296, lng: 12.1618 }, { name: "Leipzig", lat: 51.3396, lng: 12.3713 },
  { name: "Leverkusen", lat: 51.0303, lng: 6.9843 }, { name: "Ludwigsburg", lat: 48.8973, lng: 9.1916 },
  { name: "Ludwigshafen am Rhein", lat: 49.4812, lng: 8.4464 }, { name: "Lörrach", lat: 47.615, lng: 7.6646 },
  { name: "Lübeck", lat: 53.8689, lng: 10.6873 }, { name: "Lüdenscheid", lat: 51.2198, lng: 7.6273 },
  { name: "Lüneburg", lat: 53.2512, lng: 10.4155 }, { name: "Magdeburg", lat: 52.1313, lng: 11.6319 },
  { name: "Mainz", lat: 49.9819, lng: 8.2801 }, { name: "Mannheim", lat: 49.4891, lng: 8.4669 },
  { name: "Marburg", lat: 50.809, lng: 8.7707 }, { name: "Memmingen", lat: 47.9837, lng: 10.1853 },
  { name: "Mönchengladbach", lat: 51.1854, lng: 6.4417 }, { name: "Mülheim an der Ruhr", lat: 51.4275, lng: 6.8829 },
  { name: "München", lat: 48.1374, lng: 11.5755 }, { name: "Münster", lat: 51.9624, lng: 7.6257 },
  { name: "Neu-Ulm", lat: 48.3928, lng: 10.0111 }, { name: "Neubrandenburg", lat: 53.5573, lng: 13.261 },
  { name: "Neuss", lat: 51.1981, lng: 6.685 }, { name: "Norderstedt", lat: 53.7018, lng: 9.9933 },
  { name: "Nürnberg", lat: 49.4542, lng: 11.0775 }, { name: "Oberhausen", lat: 51.4781, lng: 6.8625 },
  { name: "Offenburg", lat: 48.4738, lng: 7.945 }, { name: "Oldenburg", lat: 53.1404, lng: 8.2148 },
  { name: "Osnabrück", lat: 52.2741, lng: 8.0506 }, { name: "Passau", lat: 48.5665, lng: 13.4312 },
  { name: "Pforzheim", lat: 48.8844, lng: 8.6989 }, { name: "Potsdam", lat: 52.3989, lng: 13.0657 },
  { name: "Ravensburg", lat: 47.782, lng: 9.6106 }, { name: "Regensburg", lat: 49.0151, lng: 12.1016 },
  { name: "Reutlingen", lat: 48.4914, lng: 9.2043 }, { name: "Rosenheim", lat: 47.8564, lng: 12.1225 },
  { name: "Rostock", lat: 54.0887, lng: 12.1405 }, { name: "Rottweil", lat: 48.1678, lng: 8.6272 },
  { name: "Saarbrücken", lat: 49.2326, lng: 7.0098 }, { name: "Schwerin", lat: 53.6294, lng: 11.4132 },
  { name: "Schwäbisch Gmünd", lat: 48.7995, lng: 9.7981 }, { name: "Schwäbisch Hall", lat: 49.1113, lng: 9.7391 },
  { name: "Siegen", lat: 50.8748, lng: 8.0243 }, { name: "Sindelfingen", lat: 48.7, lng: 9.0167 },
  { name: "Stralsund", lat: 54.3091, lng: 13.0818 }, { name: "Stuttgart", lat: 48.7823, lng: 9.177 },
  { name: "Trier", lat: 49.7557, lng: 6.6394 }, { name: "Tübingen", lat: 48.5227, lng: 9.0522 },
  { name: "Ulm", lat: 48.3984, lng: 9.9916 }, { name: "Velbert", lat: 51.3354, lng: 7.0435 },
  { name: "Viersen", lat: 51.2544, lng: 6.3944 }, { name: "Villingen-Schwenningen", lat: 48.0623, lng: 8.4936 },
  { name: "Weimar", lat: 50.9803, lng: 11.329 }, { name: "Wiesbaden", lat: 50.086, lng: 8.2444 },
  { name: "Wilhelmshaven", lat: 53.5476, lng: 8.1039 }, { name: "Witten", lat: 51.4436, lng: 7.3526 },
  { name: "Wolfsburg", lat: 52.4236, lng: 10.776 }, { name: "Worms", lat: 49.6328, lng: 8.3592 },
  { name: "Wuppertal", lat: 51.2563, lng: 7.1482 }, { name: "Würzburg", lat: 49.7939, lng: 9.9512 },
  { name: "Zwickau", lat: 50.7272, lng: 12.4884 },
];

/**
 * Ámbito de la plataforma, en cada idioma. La plataforma se dirige a toda
 * Europa; el catálogo de ciudades tiene hoy las alemanas porque es de donde
 * salen los ejemplares reales (GeoNames vía Open-Meteo). Añadir un país es añadir
 * filas a `CITIES`, que es la lista cerrada con la que se calculan distancias y
 * se valida la ciudad de cada persona.
 */
export const COUNTRY_NAMES = {
  es: "Europa",
  de: "Europa",
  en: "Europe",
} as const;

/** Compatibilidad con textos que aún no pasan por el diccionario. */
export const REGION = COUNTRY_NAMES.es;

export function regionName(locale: Locale): string {
  return COUNTRY_NAMES[locale];
}

const INDEX = new Map(CITIES.map((item) => [normalizeText(item.name), item]));

/** Devuelve la ciudad conocida que corresponde a ese texto, si la hay. */
export function findCity(value: string | null | undefined): City | null {
  if (!value) return null;
  return INDEX.get(normalizeText(value)) ?? null;
}

/** True cuando el texto es una de las ciudades admitidas. */
export function isKnownCity(value: string): boolean {
  return INDEX.has(normalizeText(value));
}

/** Distancia en kilómetros entre dos coordenadas (haversine). */
export function distanceKm(a: City, b: City): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * earthRadiusKm * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Matriz completa de distancias entre ciudades de la región. */
export function cityDistances(): { from: string; to: string; km: number }[] {
  const rows: { from: string; to: string; km: number }[] = [];
  for (const from of CITIES) {
    for (const to of CITIES) {
      rows.push({ from: from.name, to: to.name, km: distanceKm(from, to) });
    }
  }
  return rows;
}
