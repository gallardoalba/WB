import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy.ts";

/**
 * El idioma se guarda en una cookie al navegar, y **solo** al navegar.
 *
 * Next pide precargas de las rutas que hay en pantalla y un `fetch` del cliente
 * también pasa por el proxy; si cualquiera de los dos guardase el idioma, el que
 * la persona acaba de elegir se revertía a la siguiente precarga. Aquí se
 * comprueba la puerta —qué peticiones cuentan como navegación— sin depender de
 * que el navegador de las pruebas se comporte igual.
 */

const COOKIE = "wanderbibliothek-locale=";

function pide(ruta: string, cabeceras: Record<string, string> = {}) {
  return proxy(new NextRequest(new URL(ruta, "https://wanderbibliothek.org"), { headers: cabeceras }));
}

/** Idioma que la respuesta deja guardado, o `null` si no toca la cookie. */
function idiomaGuardado(respuesta: Response): string | null {
  const cookie = respuesta.headers.getSetCookie().find((parte) => parte.startsWith(COOKIE));
  return cookie ? cookie.slice(COOKIE.length, COOKIE.length + 2) : null;
}

test("navegar a /de/werk guarda el alemán", () => {
  const respuesta = pide("/de/werk", { "sec-fetch-mode": "navigate" });
  assert.equal(respuesta.status, 308);
  assert.equal(idiomaGuardado(respuesta), "de");
});

test("un fetch del cliente no toca el idioma", () => {
  assert.equal(idiomaGuardado(pide("/de/werk", { "sec-fetch-mode": "cors" })), null);
});

test("sin Sec-Fetch-Mode manda lo que se pide", () => {
  // Los navegadores anteriores a 2023 no mandan la cabecera: una precarga pide
  // `*/*` y una navegación pide HTML.
  const precarga = { accept: "*/*" };
  assert.equal(idiomaGuardado(pide("/de/werk", precarga)), null);
  const documento = { accept: "text/html,application/xhtml+xml" };
  assert.equal(idiomaGuardado(pide("/de/werk", documento)), "de");
});

test("el enlace del correo guarda el idioma y limpia la query", () => {
  const respuesta = pide("/?lang=es", { "sec-fetch-mode": "navigate" });
  assert.equal(respuesta.status, 307);
  const destino = new URL(respuesta.headers.get("location") ?? "", "https://wanderbibliothek.org");
  assert.equal(destino.search, "");
  assert.equal(idiomaGuardado(respuesta), "es");
});
