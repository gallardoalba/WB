/**
 * Aviso a IndexNow (Bing, Yandex, Seznam, Naver).
 *
 * Es la vía por la que una obra recién publicada llega en horas a Bing y, con
 * él, a DuckDuckGo y Ecosia, que sirven su índice. Lo que se fija aquí:
 *
 * - el fichero de la clave se anuncia en la raíz del dominio,
 * - en desarrollo no se avisa a nadie (el host es localhost),
 * - si el buscador falla, la publicación no se entera.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { INDEXNOW_KEY, indexNowKeyLocation, notifyIndexNow } from "../src/lib/indexnow.ts";

test("la clave de IndexNow tiene la forma que admite el servicio", () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
});

test("el fichero de la clave cuelga de la raíz del dominio", () => {
  assert.equal(
    indexNowKeyLocation("https://wanderbibliothek.org"),
    `https://wanderbibliothek.org/${INDEXNOW_KEY}.txt`,
  );
  // Una barra final en la configuración no debe duplicarse.
  assert.equal(
    indexNowKeyLocation("https://wanderbibliothek.org/"),
    `https://wanderbibliothek.org/${INDEXNOW_KEY}.txt`,
  );
});

test("en desarrollo no se avisa a ningún buscador", async () => {
  assert.equal(await notifyIndexNow("http://localhost:3000", ["http://localhost:3000/werk/x"]), false);
  assert.equal(await notifyIndexNow("http://127.0.0.1:3000", ["http://127.0.0.1:3000/werk/x"]), false);
});

test("sin URLs no se hace ninguna llamada", async () => {
  assert.equal(await notifyIndexNow("https://wanderbibliothek.org", []), false);
});

test("en local no se llama a IndexNow, ni con puerto ni con IP privada", async () => {
  // `new URL("http://localhost:3000").host` es «localhost:3000»: la guardia
  // antigua comparaba contra «localhost» y acababa avisando de verdad.
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    llamadas.push(String(input));
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    for (const base of [
      "http://localhost:3000",
      "http://localhost",
      "http://127.0.0.1:3000",
      "http://127.0.0.1",
      "http://[::1]:3000",
      "http://192.168.0.11:3100",
      "http://10.0.0.5",
    ]) {
      assert.equal(await notifyIndexNow(base, [`${base}/werk/x`]), false, base);
    }
    assert.equal(llamadas.length, 0, "no se avisa al buscador desde local");

    // Un dominio público sí avisa, y sin el puerto en el campo `host`.
    const ok = await notifyIndexNow("https://wanderbibliothek.org", [
      "https://wanderbibliothek.org/werk/x",
    ]);
    assert.equal(ok, true);
    assert.equal(llamadas.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
