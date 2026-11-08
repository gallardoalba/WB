import assert from "node:assert/strict";
import { before, test } from "node:test";

import { PNG } from "pngjs";

import { isJpeg } from "../src/lib/cover-convert.ts";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";
// El bot arranca apagado: cada prueba enciende lo que necesita.
delete process.env.MASTODON_TOKEN;
delete process.env.MASTODON_INSTANCE;
delete process.env.MASTODON_VISIBILITY;

type Mastodon = typeof import("../src/lib/mastodon.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let mastodon: Mastodon;
let dbModule: DbModule;

before(async () => {
  mastodon = await import("../src/lib/mastodon.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

/** Vacía la cola: sin esto, una prueba arrastra los pendientes de la anterior. */
function clearQueue(): void {
  dbModule.getDb().prepare("DELETE FROM social_outbox").run();
}

const CONFIG = {
  instance: "https://mastodon.social",
  token: "secreto",
  visibility: "public" as const,
};

/** Respuesta mínima de Mastodon (`application/json`). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `fetch` de mentira que apunta lo que recibe y contesta lo que se le diga. */
function fakeFetch(reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return reply(url, init ?? {});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("sin token el bot está apagado", () => {
  assert.equal(mastodon.mastodonConfig({}), null);
  assert.equal(mastodon.mastodonConfig({ MASTODON_TOKEN: "   " }), null);
});

test("la instancia por defecto es mastodon.social y por HTTP se rechaza", () => {
  const config = mastodon.mastodonConfig({ MASTODON_TOKEN: "tok" });
  assert.equal(config?.instance, "https://mastodon.social");
  assert.equal(config?.visibility, "public");
  // El token viaja en una cabecera: por HTTP iría en claro.
  assert.equal(mastodon.mastodonConfig({ MASTODON_TOKEN: "tok", MASTODON_INSTANCE: "http://x.de" }), null);
  assert.equal(mastodon.mastodonConfig({ MASTODON_TOKEN: "tok", MASTODON_INSTANCE: "no es una url" }), null);
});

test("la instancia se normaliza y la visibilidad no acepta inventos", () => {
  const config = mastodon.mastodonConfig({
    MASTODON_TOKEN: "tok",
    MASTODON_INSTANCE: "https://xn--baw-joa.social/",
    MASTODON_VISIBILITY: "unlisted",
  });
  assert.equal(config?.instance, "https://xn--baw-joa.social");
  assert.equal(config?.visibility, "unlisted");
  assert.equal(
    mastodon.mastodonConfig({ MASTODON_TOKEN: "tok", MASTODON_VISIBILITY: "secreta" })?.visibility,
    "public",
  );
});

test("hay cincuenta formulaciones por idioma", () => {
  for (const locale of ["de", "es", "en"] as const) {
    assert.equal(
      mastodon.leadVariants(locale).length,
      50,
      `${locale}: ${mastodon.leadVariants(locale).length} variantes`,
    );
  }
});

test("todas las formulaciones son enunciativas: sin exclamaciones ni emoji", () => {
  // El registro es de biblioteca, no de folleto: una frase, sin signos de
  // exclamación y sin pictogramas.
  const pictogram = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const seen = new Set<string>();
  for (const locale of ["de", "es", "en"] as const) {
    for (const lead of mastodon.leadVariants(locale)) {
      const text = lead("Título", "Autoría");
      assert.doesNotMatch(text, /[!¡]/, `${locale}: «${text}» lleva exclamación`);
      assert.doesNotMatch(text, pictogram, `${locale}: «${text}» lleva emoji`);
      assert.ok(text.endsWith("."), `${locale}: «${text}» no cierra con punto`);
      assert.match(text, /Título/, `${locale}: «${text}» no nombra el título`);
      assert.match(text, /Autoría/, `${locale}: «${text}» no nombra la autoría`);
      seen.add(text);
    }
  }
  // Dos variantes calcadas serían una variante menos, y nadie lo notaría.
  assert.equal(seen.size, 150, "hay formulaciones duplicadas");
});

test("la variante depende del id de la obra y se reparte", () => {
  assert.equal(mastodon.variantIndex("bok_abc", 50), mastodon.variantIndex("bok_abc", 50));
  const used = new Set<number>();
  for (let index = 0; index < 2000; index += 1) {
    used.add(mastodon.variantIndex(`bok_${index}`, 50));
  }
  assert.equal(used.size, 50, `solo se usan ${used.size} de 50 variantes`);
  assert.equal(mastodon.variantIndex("bok_x", 0), 0);
});

test("la combinación de etiquetas cambia de un libro a otro", () => {
  for (const locale of ["de", "es", "en"] as const) {
    const pool = mastodon.tagPool(locale);
    const combos = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const tags = mastodon.hashtagsFor(locale, `bok_${index}`);
      assert.equal(tags.length, 3, "la casa y dos del fondo");
      assert.equal(tags[0], pool[0], "la etiqueta de la casa va siempre primero");
      assert.equal(new Set(tags).size, 3, `etiquetas repetidas: ${tags.join(", ")}`);
      for (const tag of tags) assert.ok(pool.includes(tag), `${tag} no está en el fondo de ${locale}`);
      combos.add(tags.join(" "));
    }
    // Con seis candidatas y dos elegidas sin repetir, y contando el orden, salen
    // treinta combinaciones: el reparto tiene que cubrirlas todas.
    assert.equal(combos.size, 30, `${locale}: solo ${combos.size} combinaciones distintas`);
  }
});

test("el aviso lleva el texto elegido, el enlace y las etiquetas", () => {
  const text = mastodon.composeStatus({
    title: "El infinito en un junco",
    author: "Irene Vallejo",
    url: "https://wanderbibliothek.org/werk/bok_1",
    locale: "de",
    seed: "bok_1",
  });
  assert.match(text, /El infinito en un junco/);
  assert.match(text, /Irene Vallejo/);
  assert.match(text, /https:\/\/wanderbibliothek\.org\/werk\/bok_1/);
  assert.match(text, /#Wanderbibliothek/);
  assert.ok(Array.from(text).length <= mastodon.STATUS_LIMIT);
  // Mismo libro, mismo texto: lo que se encola es lo que se publica.
  assert.equal(
    text,
    mastodon.composeStatus({
      title: "El infinito en un junco",
      author: "Irene Vallejo",
      url: "https://wanderbibliothek.org/werk/bok_1",
      locale: "de",
      seed: "bok_1",
    }),
  );
});

test("cada idioma escribe con sus comillas y sus etiquetas", () => {
  const base = { title: "T", author: "A", url: "https://x.org/werk/bok_1", seed: "bok_1" };
  const de = mastodon.composeStatus({ ...base, locale: "de" });
  const es = mastodon.composeStatus({ ...base, locale: "es" });
  const en = mastodon.composeStatus({ ...base, locale: "en" });
  assert.match(de, /„T“/);
  assert.match(es, /«T»/);
  assert.match(en, /“T”/);
  // Las etiquetas salen del fondo de cada idioma, no de una lista fija.
  for (const [locale, text] of [
    ["de", de],
    ["es", es],
    ["en", en],
  ] as const) {
    const tags = (text.match(/#\S+/g) ?? []).map((tag) => tag.slice(1));
    assert.deepEqual(tags, mastodon.hashtagsFor(locale, base.seed));
  }
});

test("un título enorme se recorta y el enlace sobrevive", () => {
  const url = "https://wanderbibliothek.org/werk/bok_1";
  const text = mastodon.composeStatus({
    title: "Muy largo ".repeat(200),
    author: "Alguien",
    url,
    locale: "de",
    seed: "bok_1",
  });
  assert.ok(Array.from(text).length <= mastodon.STATUS_LIMIT, `mide ${Array.from(text).length}`);
  assert.match(text, /…/);
  assert.ok(text.includes(url), "el enlace no puede quedar cortado");
});

test("el enlace lleva el prefijo de idioma y el bot escribe en el del ejemplar", () => {
  assert.equal(mastodon.localeForLanguage("Español"), "es");
  assert.equal(mastodon.localeForLanguage("Inglés"), "en");
  assert.equal(mastodon.localeForLanguage("Alemán"), "de");
  // «Otro» y «No especificado» no dicen nada: idioma de la casa.
  assert.equal(mastodon.localeForLanguage("Otro"), "de");
  assert.equal(mastodon.localeForLanguage("No especificado"), "de");
  assert.equal(mastodon.localeForLanguage(null), "de");

  assert.equal(mastodon.workUrl("https://x.org/", "bok_1", "de"), "https://x.org/werk/bok_1");
  assert.equal(mastodon.workUrl("https://x.org", "bok_1", "es"), "https://x.org/es/werk/bok_1");
  assert.equal(mastodon.workUrl("https://x.org", "bok_1", "en"), "https://x.org/en/werk/bok_1");
});

test("la portada lleva texto alternativo en el idioma del aviso", () => {
  assert.equal(mastodon.coverAlt("de", "1984", "George Orwell"), "Buchcover von „1984“ von George Orwell");
  assert.equal(mastodon.coverAlt("es", "1984", "George Orwell"), "Portada de «1984» de George Orwell");
  assert.equal(mastodon.coverAlt("en", "1984", "George Orwell"), "Cover of “1984” by George Orwell");
});

test("una obra se anuncia una sola vez, aunque la pongan tres personas", () => {
  clearQueue();
  const first = mastodon.enqueuePost({ bookId: "bok_unico", text: "hola" });
  const second = mastodon.enqueuePost({ bookId: "bok_unico", text: "hola otra vez" });
  assert.ok(first, "la primera vez tiene que encolar");
  assert.equal(second, null, "la clave única por red y obra tiene que descartar el duplicado");
  const rows = dbModule
    .getDb()
    .prepare("SELECT body FROM social_outbox WHERE subject = ?")
    .all("bok_unico") as { body: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.body, "hola");
});

test("sin configuración el proceso no toca la red", async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse({ id: "1" }));
  const result = await mastodon.processSocialOutbox({ limit: 5, config: null, fetchImpl: impl });
  assert.deepEqual(result, { sent: 0, failed: 0, skipped: true });
  assert.equal(calls.length, 0);
});

test("un aviso pendiente se publica con el token y la clave de idempotencia", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_envia", text: "texto a publicar" });
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ id: "110", url: "https://mastodon.social/@wanderbibliothek/110" }),
  );
  const result = await mastodon.processSocialOutbox({ limit: 50, config: CONFIG, fetchImpl: impl });
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://mastodon.social/api/v1/statuses");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer secreto");
  // La clave de idempotencia es el id de la fila: un reintento devuelve el mismo
  // estado en lugar de publicar dos veces.
  const row = dbModule
    .getDb()
    .prepare("SELECT id, status, external_id, external_url FROM social_outbox WHERE subject = ?")
    .get("bok_envia") as { id: string; status: string; external_id: string; external_url: string };
  assert.equal(headers["Idempotency-Key"], row.id);
  assert.equal(row.status, "sent");
  assert.equal(row.external_id, "110");
  assert.match(row.external_url, /@wanderbibliothek\/110/);
});

test("si la fila guarda una imagen, el estado la adjunta", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_con_imagen", text: "texto", mediaId: "22348641" });
  const { impl, calls } = fakeFetch(() => jsonResponse({ id: "111" }));
  await mastodon.processSocialOutbox({ limit: 50, config: CONFIG, fetchImpl: impl });
  const form = calls[0]!.init.body as FormData;
  assert.deepEqual(form.getAll("media_ids[]"), ["22348641"]);
});

test("un 500 deja el aviso pendiente y con espera", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_500", text: "texto" });
  const { impl } = fakeFetch(() => jsonResponse({ error: "caído" }, 503));
  const result = await mastodon.processSocialOutbox({ limit: 50, config: CONFIG, fetchImpl: impl });
  assert.equal(result.failed, 1);
  const row = dbModule
    .getDb()
    .prepare("SELECT status, attempts, last_error, next_attempt_at FROM social_outbox WHERE subject = ?")
    .get("bok_500") as {
    status: string;
    attempts: number;
    last_error: string;
    next_attempt_at: string;
  };
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, "caído");
  assert.ok(row.next_attempt_at > new Date().toISOString().slice(0, 19), "tiene que esperar");
});

test("un token inválido no se reintenta: no mejora solo", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_401", text: "texto" });
  const { impl } = fakeFetch(() => jsonResponse({ error: "The access token is invalid" }, 401));
  await mastodon.processSocialOutbox({ limit: 50, config: CONFIG, fetchImpl: impl });
  const row = dbModule
    .getDb()
    .prepare("SELECT status, last_error FROM social_outbox WHERE subject = ?")
    .get("bok_401") as { status: string; last_error: string };
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /access token/);
});

test("quedarse sin red deja el aviso para el siguiente intento", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_sin_red", text: "texto" });
  const impl = (async () => {
    throw new Error("ECONNREFUSED mastodon.social");
  }) as unknown as typeof fetch;
  const result = await mastodon.processSocialOutbox({ limit: 50, config: CONFIG, fetchImpl: impl });
  assert.equal(result.failed, 1);
  const row = dbModule
    .getDb()
    .prepare("SELECT status, last_error FROM social_outbox WHERE subject = ?")
    .get("bok_sin_red") as { status: string; last_error: string };
  assert.equal(row.status, "pending");
  assert.match(row.last_error, /ECONNREFUSED/);
});

test("la imagen del aviso es la tarjeta del sitio, ya en JPG", async () => {
  // El sitio pinta la tarjeta (portada sobre el verde de la casa) y el bot la
  // recompone: un PNG de 1200×630 con una foto dentro pesa el triple.
  const png = PNG.sync.write(
    (() => {
      const image = new PNG({ width: 1200, height: 630 });
      image.data.fill(120);
      return image;
    })(),
  );
  const { impl, calls } = fakeFetch(() =>
    new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
  );
  const media = await mastodon.mediaForPost("https://wanderbibliothek.org", "bok_tarjeta", impl);
  assert.ok(media, "tiene que devolver una imagen");
  assert.equal(media.contentType, "image/jpeg");
  assert.equal(isJpeg(media.data), true);
  assert.equal(calls[0]!.url, "https://wanderbibliothek.org/api/og/werk/bok_tarjeta");
});

test("si la tarjeta no se puede pintar, se sube la portada suelta", async () => {
  // Sin fila de libro no hay portada en disco: el resultado es «sin imagen»,
  // pero lo que importa es que no revienta y que no sube el JSON del error.
  const { impl } = fakeFetch(() => jsonResponse({ error: "boom" }, 500));
  const media = await mastodon.mediaForPost("https://wanderbibliothek.org", "bok_sin_nada", impl);
  assert.equal(media, null);
});

test("la portada se sube con su texto alternativo y devuelve el id", async () => {
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ id: "22348641", url: "https://files.example/x.jpeg" }),
  );
  const result = await mastodon.uploadMedia(
    CONFIG,
    { data: Buffer.from([0xff, 0xd8, 0xff, 0x00]), contentType: "image/jpeg", description: "Portada de «1984»" },
    impl,
  );
  assert.deepEqual(result, { ok: true, id: "22348641" });
  assert.equal(calls[0]!.url, "https://mastodon.social/api/v2/media");
  const form = calls[0]!.init.body as FormData;
  assert.equal(form.get("description"), "Portada de «1984»");
  const file = form.get("file") as File;
  assert.equal(file.type, "image/jpeg");
  assert.match(file.name, /\.jpg$/);
});

test("sin permiso para medios, la subida falla sin reintento", async () => {
  const { impl } = fakeFetch(() => jsonResponse({ error: "This action is outside your granted scopes" }, 403));
  const result = await mastodon.uploadMedia(
    CONFIG,
    { data: Buffer.alloc(4), contentType: "image/jpeg", description: "x" },
    impl,
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.retryable, false);
});

test("una imagen que se procesa en segundo plano se espera", async () => {
  let polled = 0;
  const { impl } = fakeFetch((url) => {
    if (url.endsWith("/api/v1/media/900")) {
      polled += 1;
      return jsonResponse({ id: "900", url: "https://files.example/x.jpeg" });
    }
    return jsonResponse({ id: "900", url: null }, 202);
  });
  const result = await mastodon.uploadMedia(
    CONFIG,
    { data: Buffer.alloc(4), contentType: "image/jpeg", description: "x" },
    impl,
  );
  assert.deepEqual(result, { ok: true, id: "900" });
  assert.equal(polled, 1, "tiene que preguntar por el medio antes de devolverlo");
});

test("la purga borra entregados antiguos y respeta los pendientes", () => {
  clearQueue();
  const db = dbModule.getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO social_outbox (id, network, subject, body, status, attempts, next_attempt_at, created_at)
     VALUES (?, 'mastodon', ?, 'x', ?, 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
  );
  insert.run("soc_viejo_enviado", "bok_purga_1", "sent");
  insert.run("soc_viejo_pendiente", "bok_purga_2", "pending");
  mastodon.purgeSocialOutbox(90);
  const left = db
    .prepare("SELECT subject FROM social_outbox WHERE subject LIKE 'bok_purga_%' ORDER BY subject")
    .all() as { subject: string }[];
  assert.deepEqual(left, [{ subject: "bok_purga_2" }]);
});

test("publicar anuncia la obra y no deja la cola a medias", async () => {
  clearQueue();
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : String(input));
    return jsonResponse({ id: "7", url: "https://mastodon.social/@wanderbibliothek/7" });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  try {
    // Sin fila en `books` no hay ISBN ni portada: se publica solo el texto.
    const result = await mastodon.announceBook({
      bookId: "bok_anuncio",
      title: "Ficciones",
      author: "Jorge Luis Borges",
      language: "Español",
      base: "https://wanderbibliothek.org",
    });
    assert.deepEqual(result, { queued: true, sent: true, media: false });
    assert.ok(calls.every((url) => !url.includes("/api/v2/media")), "sin portada no se sube nada");
    const row = dbModule
      .getDb()
      .prepare("SELECT body, status FROM social_outbox WHERE subject = ?")
      .get("bok_anuncio") as { body: string; status: string };
    assert.equal(row.status, "sent");
    // El ejemplar está en español: enlace con prefijo y etiquetas en español.
    assert.match(row.body, /https:\/\/wanderbibliothek\.org\/es\/werk\/bok_anuncio/);
    assert.match(row.body, /#Wanderbibliothek/);
    for (const tag of mastodon.hashtagsFor("es", "bok_anuncio")) {
      assert.ok(row.body.includes(`#${tag}`), `falta #${tag}`);
    }

    // La segunda vez no se vuelve a anunciar.
    const again = await mastodon.announceBook({
      bookId: "bok_anuncio",
      title: "Ficciones",
      author: "Jorge Luis Borges",
      language: "Español",
      base: "https://wanderbibliothek.org",
    });
    assert.deepEqual(again, { queued: false, sent: false, media: false });
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});

test("en desarrollo no se anuncia una URL de localhost", async () => {
  process.env.MASTODON_TOKEN = "tok";
  try {
    const result = await mastodon.announceBook({
      bookId: "bok_local",
      title: "T",
      author: "A",
      base: "http://localhost:3000",
    });
    assert.deepEqual(result, { queued: false, sent: false, media: false });
  } finally {
    delete process.env.MASTODON_TOKEN;
  }
});

test("sin token, publicar no encola nada", async () => {
  clearQueue();
  const result = await mastodon.announceBook({
    bookId: "bok_sin_bot",
    title: "T",
    author: "A",
    base: "https://wanderbibliothek.org",
  });
  assert.deepEqual(result, { queued: false, sent: false, media: false });
  const rows = dbModule
    .getDb()
    .prepare("SELECT COUNT(*) AS n FROM social_outbox WHERE subject = ?")
    .get("bok_sin_bot") as { n: number };
  assert.equal(rows.n, 0, "sin bot no se acumulan filas muertas en la cola");
});
