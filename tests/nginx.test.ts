/**
 * Invariantes del vhost de producción (`deploy/nginx.conf`).
 *
 * Aquí no hay nginx: lo que se comprueba es lo que se puede romper sin que
 * nadie lo note hasta que un servidor recibe tráfico. Las tres trampas que
 * cubre este fichero: una caché de imágenes que sirve WebP a quien pidió JPEG,
 * un `add_header` dentro de un `location` que borra los del servidor, y una
 * llave que abre caché sin definir la zona.
 *
 * `nginx -t` sigue siendo el que valida el fichero; esto solo evita los fallos
 * de diseño que la sintaxis no ve.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../deploy/nginx.conf", import.meta.url), "utf8");

/** Cuerpo de un bloque `location <patrón> { … }`, con las llaves contadas. */
function location(pattern: string): string | null {
  const start = source.indexOf(`location ${pattern} {`);
  if (start < 0) return null;
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

test("la zona de caché de imágenes se declara antes de usarse", () => {
  const zone = source.indexOf("proxy_cache_path /var/cache/nginx/wb_images");
  const firstUse = source.indexOf("proxy_cache wb_images;");

  assert.ok(zone >= 0, "falta proxy_cache_path");
  assert.match(source, /keys_zone=wb_images:16m/);
  assert.ok(firstUse > zone, "la zona se usa antes de declararla");
});

test("las imágenes optimizadas se cachean separando el formato negociado", () => {
  const image = location("^~ /_next/image");
  assert.ok(image, "falta la ubicación /_next/image");
  assert.match(image, /proxy_cache wb_images;/);
  // `Vary: Accept` no lo mira la caché de nginx: si el formato no entra en la
  // clave, el WebP guardado para un navegador se sirve a quien pidió JPEG.
  assert.match(image, /proxy_cache_key "[^"]*\$wb_image_format"/);
  assert.match(source, /map \$http_accept \$wb_image_format \{[\s\S]*image\/webp[\s\S]*image\/avif/);
});

test("las portadas originales también se cachean, sin tocar las escrituras", () => {
  const covers = location("^~ /api/cover/");
  assert.ok(covers, "falta la ubicación /api/cover/");
  assert.match(covers, /proxy_cache wb_images;/);
  // nginx solo cachea GET/HEAD; se deja escrito para que no se «arregle» con
  // `proxy_cache_methods` y se cacheen los PUT de subida.
  assert.doesNotMatch(covers, /proxy_cache_methods/);
  assert.match(covers, /client_max_body_size 8m;/);
});

test("las ubicaciones con caché repiten las cabeceras del servidor", () => {
  // Un `add_header` dentro de un `location` sustituye a los del `server`: si se
  // añade `X-Cache-Status` sin repetir `Alt-Svc`, HTTP/3 deja de anunciarse en
  // esas respuestas sin que falle nada.
  for (const pattern of ["^~ /_next/image", "^~ /api/cover/"]) {
    const block = location(pattern);
    assert.ok(block);
    assert.match(block, /add_header X-Cache-Status \$upstream_cache_status always;/);
    assert.match(block, /add_header Alt-Svc /);
  }
});
