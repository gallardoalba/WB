import assert from "node:assert/strict";
import { before, test } from "node:test";

import { PNG } from "pngjs";

import { isJpeg } from "../src/lib/cover-convert.ts";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";
// El bot arranca apagado: cada prueba enciende lo que necesita.
delete process.env.MASTODON_TOKEN;
delete process.env.MASTODON_INSTANCE;
delete process.env.MASTODON_VISIBILITY;
// El silencio nocturno se prueba en sus propias pruebas: aquí se apaga para
// que el resto no dependa de la hora a la que se ejecute la suite.
process.env.MASTODON_QUIET_HOURS = "off";

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
      isAdmin: true,
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
      isAdmin: true,
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
      isAdmin: true,
    });
    assert.deepEqual(result, { queued: false, sent: false, media: false });
  } finally {
    delete process.env.MASTODON_TOKEN;
  }
});

test("el día del aviso se calcula en hora alemana, no en UTC", () => {
  // Las 23:30 UTC del 8 ya son el 9 en Berlín: si se contara en UTC, quien
  // publica de madrugada entraría en el día anterior.
  assert.equal(mastodon.dayKey(new Date("2026-11-08T23:30:00Z")), "2026-11-09");
  // En verano la diferencia son dos horas.
  assert.equal(mastodon.dayKey(new Date("2026-07-15T22:30:00Z")), "2026-07-16");
  assert.equal(mastodon.dayKey(new Date("2026-11-08T10:00:00Z")), "2026-11-08");
});

test("publicar varios libros el mismo día anuncia solo el primero", async () => {
  clearQueue();
  const original = globalThis.fetch;
  let posted = 0;
  globalThis.fetch = (async () => {
    posted += 1;
    return jsonResponse({ id: String(posted) });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  // Horas simuladas: el primer aviso sale en el acto y los siguientes esperan
  // el turno de la cuenta (4-7 h). Media hora después ya no toca, y al día
  // siguiente la cola vuelve a estar libre. Las fechas son lógicas: la prueba
  // no debe depender del reloj real del equipo.
  const primeraHora = new Date("2026-11-08T09:00:00Z");
  const mediaHora = new Date("2026-11-08T09:30:00Z");
  const diaSiguiente = new Date("2026-11-09T07:00:00Z");
  const anunciar = (bookId: string, ownerId: string, now: Date) =>
    mastodon.announceBook({
      bookId,
      title: "Título",
      author: "Autoría",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
      ownerId,
      now,
    });
  try {
    const primero = await anunciar("bok_dia_1", "usr_uno", primeraHora);
    const segundo = await anunciar("bok_dia_2", "usr_uno", mediaHora);
    const otraPersona = await anunciar("bok_dia_3", "usr_dos", mediaHora);
    const alDiaSiguiente = await anunciar("bok_dia_4", "usr_uno", diaSiguiente);

    assert.deepEqual(primero, { queued: true, sent: true, media: false });
    assert.deepEqual(segundo, { queued: false, sent: false, media: false }, "el segundo libro del día no se anuncia");
    // Otra persona sí tiene su aviso, pero entra en el turno de la cuenta: el
    // bot publica de uno en uno, separado 4-7 horas.
    assert.deepEqual(
      { queued: otraPersona.queued, sent: otraPersona.sent },
      { queued: true, sent: false },
      "otra persona sí tiene su aviso, encolado",
    );
    assert.deepEqual(alDiaSiguiente, { queued: true, sent: true, media: false }, "al día siguiente vuelve a tocar");

    const filas = dbModule
      .getDb()
      .prepare("SELECT subject, owner_id, day FROM social_outbox ORDER BY subject")
      .all() as { subject: string; owner_id: string; day: string }[];
    assert.deepEqual(
      filas.map((fila) => fila.subject),
      ["bok_dia_1", "bok_dia_3", "bok_dia_4"],
      "el segundo del mismo día no llegó a encolarse",
    );
    assert.equal(filas[0]!.owner_id, "usr_uno");
    assert.equal(filas[0]!.day, "2026-11-08");
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});

test("sin persona no se aplica el tope diario (envío a mano)", async () => {
  clearQueue();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => jsonResponse({ id: "9" })) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  try {
    const now = new Date("2026-11-08T09:00:00Z");
    const uno = await mastodon.announceBook({
      bookId: "bok_manual_1",
      title: "T",
      author: "A",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
      now,
    });
    const dos = await mastodon.announceBook({
      bookId: "bok_manual_2",
      title: "T",
      author: "A",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
      now,
    });
    assert.equal(uno.queued, true);
    assert.equal(dos.queued, true);
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});

test("una cuenta que no es de administración no llega a la cola", async () => {
  clearQueue();
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    llamadas.push(String(input));
    return jsonResponse({ id: "1" });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  try {
    const result = await mastodon.announceBook({
      bookId: "bok_comunidad",
      title: "Ficciones",
      author: "Jorge Luis Borges",
      base: "https://wanderbibliothek.org",
      isAdmin: false,
    });
    assert.deepEqual(result, { queued: false, sent: false, media: false });
    assert.equal(llamadas.length, 0, "ni una petición a la instancia");
    const rows = dbModule
      .getDb()
      .prepare("SELECT COUNT(*) AS n FROM social_outbox WHERE subject = ?")
      .get("bok_comunidad") as { n: number };
    assert.equal(rows.n, 0, "la cola solo recoge lo que publica la administración");
  } finally {
    globalThis.fetch = original;
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
    isAdmin: true,
  });
  assert.deepEqual(result, { queued: false, sent: false, media: false });
  const rows = dbModule
    .getDb()
    .prepare("SELECT COUNT(*) AS n FROM social_outbox WHERE subject = ?")
    .get("bok_sin_bot") as { n: number };
  assert.equal(rows.n, 0, "sin bot no se acumulan filas muertas en la cola");
});

/* ------------------ la portada llega después de crear el ejemplar ---------- */

test("sin portada en disco no se espera ni un instante", async () => {
  // `timeoutMs = 0` es el caso «no hay nada que esperar»: la función sale sin
  // dormir, que es lo que hace el aviso cuando el formulario no sube imagen.
  assert.equal(await mastodon.esperarPortadaSubida("bok_sin_portada", 0), false);
});

test("el aviso espera la portada que el formulario sube después del alta", async () => {
  const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  clearQueue();
  const dir = mkdtempSync(join(tmpdir(), "wb-portada-"));
  const anterior = process.env.WANDERBIBLIOTHEK_COVER_CACHE;
  process.env.WANDERBIBLIOTHEK_COVER_CACHE = dir;

  const tarjeta = PNG.sync.write(
    (() => {
      const image = new PNG({ width: 400, height: 620 });
      image.data.fill(90);
      return image;
    })(),
  );
  const portada = PNG.sync.write(
    (() => {
      const image = new PNG({ width: 100, height: 150 });
      image.data.fill(200);
      return image;
    })(),
  );

  const original = globalThis.fetch;
  // El id va con el patrón real de `bok_…`: el prefijo `bok_` y, después, solo
  // letras, números y guiones (un guion bajo de más hace que no haya portada).
  const bookId = "bok_prueba-portada";
  // La fila de la obra es lo que da título y autoría al texto alternativo de la
  // imagen cuando la sube el procesador de la cola.
  dbModule
    .getDb()
    .prepare(
      `INSERT OR IGNORE INTO books (id, title, title_key, author, isbn, category,
         language, cover_url, work_key, publisher, year, series, created_at)
       VALUES (?, 'Iluminaciones', 'iluminaciones', 'Walter Benjamin', NULL, 'Humanidades',
         'Español', ?, NULL, NULL, NULL, NULL, '2026-11-08T00:00:00.000Z')`,
    )
    .run(bookId, `/api/cover/book/${bookId}`);
  let portadaEnDiscoAlPedirLaTarjeta = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/og/werk/")) {
      // Lo que se comprueba: cuando el bot pide la tarjeta, la portada ya está.
      portadaEnDiscoAlPedirLaTarjeta = existsSync(join(dir, `upload-${bookId}.img`));
      return new Response(new Uint8Array(tarjeta), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return jsonResponse({ id: "117583227433568922", url: "https://mastodon.social/@x/1" });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";

  try {
    // El navegador sube la imagen unos cientos de milisegundos después de
    // recibir el id del libro: es exactamente lo que dejaba el post sin portada.
    const subida = setTimeout(() => {
      writeFileSync(join(dir, `upload-${bookId}.img`), portada);
    }, 400);

    const result = await mastodon.announceBook({
      bookId,
      title: "Iluminaciones",
      author: "Walter Benjamin",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
      esperarPortada: true,
    });
    clearTimeout(subida);

    assert.deepEqual(result, { queued: true, sent: true, media: true });
    assert.equal(
      portadaEnDiscoAlPedirLaTarjeta,
      true,
      "la tarjeta tiene que pintarse con la portada ya subida",
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
    if (anterior === undefined) delete process.env.WANDERBIBLIOTHEK_COVER_CACHE;
    else process.env.WANDERBIBLIOTHEK_COVER_CACHE = anterior;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("la administración anuncia cada libro del día, sin el tope de uno", async () => {
  clearQueue();
  const original = globalThis.fetch;
  let posted = 0;
  globalThis.fetch = (async () => {
    posted += 1;
    return jsonResponse({ id: String(posted) });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  const now = new Date("2026-11-08T19:00:00Z");
  const anunciar = (bookId: string, sinTopeDiario: boolean) =>
    mastodon.announceBook({
      bookId,
      title: "Eclipse of reason",
      author: "Max Horkheimer",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
      ownerId: "usr_admin",
      sinTopeDiario,
      now,
    });

  try {
    const primera = await anunciar("bok-admin-1", true);
    const segunda = await anunciar("bok-admin-2", true);
    // La misma persona sin la marca: el segundo libro del día ya no se anuncia.
    const tercera = await anunciar("bok-admin-3", false);
    assert.equal(primera.queued, true);
    assert.equal(segunda.queued, true, "la administración no tiene tope diario");
    assert.equal(tercera.queued, false, "sin la marca sigue valiendo el tope");
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});

test("la separación entre avisos encolados está entre 4 y 7 horas", () => {
  assert.equal(mastodon.separacionAviso(() => 0), mastodon.SOCIAL_GAP_MIN_MS);
  assert.equal(mastodon.separacionAviso(() => 1), mastodon.SOCIAL_GAP_MAX_MS);
  const medio = mastodon.separacionAviso(() => 0.5);
  assert.ok(medio > mastodon.SOCIAL_GAP_MIN_MS && medio < mastodon.SOCIAL_GAP_MAX_MS);
  // Con azar real, siempre dentro de la banda.
  for (let i = 0; i < 50; i += 1) {
    const hueco = mastodon.separacionAviso();
    assert.ok(hueco >= mastodon.SOCIAL_GAP_MIN_MS && hueco <= mastodon.SOCIAL_GAP_MAX_MS);
  }
});

test("veinte libros de golpe: el primero sale y los demás esperan su turno", async () => {
  clearQueue();
  const original = globalThis.fetch;
  let posted = 0;
  globalThis.fetch = (async () => {
    posted += 1;
    return jsonResponse({ id: String(posted) });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  // Reloj real: los turnos se comparan con lo que ya hay en la cola, que lleva
  // marcas de tiempo de verdad.
  const ahora = new Date();
  try {
    const anunciar = (n: number) =>
      mastodon.announceBook({
        bookId: `bok-tanda-${n}`,
        title: `Libro ${n}`,
        author: "Autora",
        base: "https://wanderbibliothek.org",
        isAdmin: true,
        ownerId: "usr_admin",
        sinTopeDiario: true,
        now: ahora,
      });

    const primera = await anunciar(1);
    assert.equal(primera.sent, true, "el primero sale en el acto");

    const segunda = await anunciar(2);
    const tercera = await anunciar(3);
    assert.deepEqual(
      { queued: segunda.queued, sent: segunda.sent },
      { queued: true, sent: false },
      "el segundo se encola, no se publica",
    );
    assert.equal(tercera.sent, false);

    // Los turnos son crecientes y el hueco entre ellos cae en la banda.
    const turnos = dbModule
      .getDb()
      .prepare(
        `SELECT subject, next_attempt_at FROM social_outbox
          WHERE subject LIKE 'bok-tanda-%' ORDER BY created_at ASC`,
      )
      .all() as { subject: string; next_attempt_at: string }[];
    const fechas = turnos.map((fila) => new Date(fila.next_attempt_at).getTime());
    assert.ok(fechas[1]! > ahora.getTime(), "el segundo espera, no sale ya");
    const hueco = fechas[1]! - ahora.getTime();
    assert.ok(
      hueco >= mastodon.SOCIAL_GAP_MIN_MS && hueco <= mastodon.SOCIAL_GAP_MAX_MS,
      `hueco inesperado: ${hueco} ms`,
    );
    const entreDos = fechas[2]! - fechas[1]!;
    assert.ok(
      entreDos >= mastodon.SOCIAL_GAP_MIN_MS && entreDos <= mastodon.SOCIAL_GAP_MAX_MS,
      `hueco inesperado entre el 2 y el 3: ${entreDos} ms`,
    );

    // El cron no los suelta antes de tiempo.
    const antes = await mastodon.processSocialOutbox();
    assert.equal(antes.sent, 0, "todavía no toca ninguno");
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});

test("MASTODON_GAP_MINUTES ajusta la banda y con 0 no hay espera", () => {
  const anterior = process.env.MASTODON_GAP_MINUTES;
  try {
    delete process.env.MASTODON_GAP_MINUTES;
    assert.equal(mastodon.separacionAviso(() => 0), mastodon.SOCIAL_GAP_MIN_MS);

    process.env.MASTODON_GAP_MINUTES = "0";
    assert.equal(mastodon.separacionAviso(() => 0), 0, "sin espera para la prueba desde la web");

    process.env.MASTODON_GAP_MINUTES = "30-90";
    assert.equal(mastodon.separacionAviso(() => 0), 30 * 60_000);
    assert.equal(mastodon.separacionAviso(() => 1), 90 * 60_000);

    process.env.MASTODON_GAP_MINUTES = "90-30";
    assert.equal(mastodon.separacionAviso(() => 0), 30 * 60_000, "la banda se ordena sola");

    // Un valor ilegible no deja la cola parada: vuelve a la banda por defecto.
    process.env.MASTODON_GAP_MINUTES = "dos horas";
    assert.equal(mastodon.separacionAviso(() => 0), mastodon.SOCIAL_GAP_MIN_MS);
  } finally {
    if (anterior === undefined) delete process.env.MASTODON_GAP_MINUTES;
    else process.env.MASTODON_GAP_MINUTES = anterior;
  }
});

test("con MASTODON_GAP_MINUTES=0 dos libros seguidos salen en el acto", async () => {
  clearQueue();
  const original = globalThis.fetch;
  let posted = 0;
  globalThis.fetch = (async () => {
    posted += 1;
    return jsonResponse({ id: String(posted) });
  }) as unknown as typeof fetch;
  const anterior = process.env.MASTODON_GAP_MINUTES;
  process.env.MASTODON_TOKEN = "tok";
  process.env.MASTODON_GAP_MINUTES = "0";
  try {
    const anunciar = (n: number) =>
      mastodon.announceBook({
        bookId: `bok-sin-espera-${n}`,
        title: `Libro ${n}`,
        author: "Autora",
        base: "https://wanderbibliothek.org",
        isAdmin: true,
        ownerId: "usr_admin",
        sinTopeDiario: true,
      });
    assert.equal((await anunciar(1)).sent, true);
    assert.equal((await anunciar(2)).sent, true, "sin espera el segundo también sale");
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
    if (anterior === undefined) delete process.env.MASTODON_GAP_MINUTES;
    else process.env.MASTODON_GAP_MINUTES = anterior;
  }
});

/* ------------------------- silencio nocturno ------------------------------ */

test("entre las 22:00 y las 09:00 de Berlín no se publica nada", () => {
  const anterior = process.env.MASTODON_QUIET_HOURS;
  delete process.env.MASTODON_QUIET_HOURS;
  try {
    // Noviembre: Berlín va una hora por delante de UTC.
    const casos: [string, boolean][] = [
      ["2026-11-09T07:59:00Z", true], // 08:59
      ["2026-11-09T08:00:00Z", false], // 09:00, ya se puede
      ["2026-11-09T12:00:00Z", false], // 13:00
      ["2026-11-09T20:59:00Z", false], // 21:59
      ["2026-11-09T21:00:00Z", true], // 22:00, se cierra
      ["2026-11-09T23:59:00Z", true], // 00:59 del día siguiente
      ["2026-11-09T03:30:00Z", true], // 04:30
    ];
    for (const [instante, esperado] of casos) {
      assert.equal(
        mastodon.enHorarioSilencioso(new Date(instante)),
        esperado,
        `a las ${instante} debería ser ${esperado ? "silencio" : "permitido"}`,
      );
    }

    // Lo que vence de madrugada pasa a las 09:00 de esa mañana.
    const salida = mastodon.fueraDeSilencio(new Date("2026-11-09T01:30:00Z"));
    assert.equal(salida.toISOString().slice(11, 13), "08", "las 09:00 de Berlín son las 08:00 UTC");

    // Una banda que no cruza la medianoche también vale.
    process.env.MASTODON_QUIET_HOURS = "1-5";
    assert.equal(mastodon.enHorarioSilencioso(new Date("2026-11-09T03:00:00Z")), true); // 04:00
    assert.equal(mastodon.enHorarioSilencioso(new Date("2026-11-09T21:00:00Z")), false); // 22:00

    // Y se puede apagar.
    process.env.MASTODON_QUIET_HOURS = "off";
    assert.equal(mastodon.enHorarioSilencioso(new Date("2026-11-09T03:00:00Z")), false);
  } finally {
    if (anterior === undefined) delete process.env.MASTODON_QUIET_HOURS;
    else process.env.MASTODON_QUIET_HOURS = anterior;
  }
});

test("un aviso que nace de noche se encola para las 09:00 y no se envía", async () => {
  clearQueue();
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    llamadas.push(String(input));
    return jsonResponse({ id: "1" });
  }) as unknown as typeof fetch;
  const anterior = process.env.MASTODON_QUIET_HOURS;
  delete process.env.MASTODON_QUIET_HOURS;
  process.env.MASTODON_TOKEN = "tok";
  try {
    const noche = new Date("2026-11-09T22:30:00Z"); // 23:30 en Berlín
    const result = await mastodon.announceBook({
      bookId: "bok-nocturno",
      title: "Eclipse of reason",
      author: "Max Horkheimer",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
      ownerId: "usr_admin",
      sinTopeDiario: true,
      now: noche,
    });
    assert.deepEqual(result, { queued: true, sent: false, media: false });
    assert.equal(llamadas.length, 0, "de noche no se llama a Mastodon");

    const fila = dbModule
      .getDb()
      .prepare("SELECT status, next_attempt_at FROM social_outbox WHERE subject = ?")
      .get("bok-nocturno") as { status: string; next_attempt_at: string };
    assert.equal(fila.status, "pending");
    assert.equal(fila.next_attempt_at, "2026-11-10T08:00:00.000Z", "las 09:00 de Berlín");
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
    if (anterior === undefined) delete process.env.MASTODON_QUIET_HOURS;
    else process.env.MASTODON_QUIET_HOURS = anterior;
  }
});

test("el cron tampoco publica de noche, aunque haya avisos vencidos", async () => {
  clearQueue();
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    llamadas.push(String(input));
    return jsonResponse({ id: "1" });
  }) as unknown as typeof fetch;
  const anterior = process.env.MASTODON_QUIET_HOURS;
  delete process.env.MASTODON_QUIET_HOURS;
  process.env.MASTODON_TOKEN = "tok";
  try {
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO social_outbox (id, network, subject, body, status, attempts, next_attempt_at, created_at)
         VALUES ('soc_noche', 'mastodon', 'bok_noche', 'texto', 'pending', 0,
                 '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      )
      .run();
    const result = await mastodon.processSocialOutbox({ now: new Date("2026-11-09T23:00:00Z") });
    assert.deepEqual(result, { sent: 0, failed: 0, skipped: true });
    assert.equal(llamadas.length, 0, "ni una petición a Mastodon");

    // De día sí sale.
    const dia = await mastodon.processSocialOutbox({ now: new Date("2026-11-09T10:00:00Z") });
    assert.equal(dia.sent, 1);
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
    if (anterior === undefined) delete process.env.MASTODON_QUIET_HOURS;
    else process.env.MASTODON_QUIET_HOURS = anterior;
  }
});
