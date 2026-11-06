/**
 * Ciudad que se guarda en la base.
 *
 * Traduce lo que escribe una persona al nombre con el que OpenStreetMap conoce
 * la ciudad (para que «Munich» y «München» no sean dos sitios distintos). Si el
 * geocodificador no responde, se guarda lo escrito: un corte de red no debe
 * impedir registrarse. Si responde y no conoce la ciudad, el error se explica.
 */
import { ApiError } from "./errors";
import { resolveCity } from "./geocode";

export async function cityName(raw: string): Promise<string> {
  const lookup = await resolveCity(raw);
  if (lookup.status === "found") return lookup.name;
  if (lookup.status === "unavailable") {
    console.warn(
      "[cities] no se pudo comprobar la ciudad con OpenStreetMap; se guarda tal cual:",
      raw,
    );
    return raw.trim();
  }
  throw new ApiError(422, "No encontramos esa ciudad. Revisa cómo se escribe.");
}
