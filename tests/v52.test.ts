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
