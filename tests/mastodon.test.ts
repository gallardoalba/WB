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

/** Deja en la cola un aviso que el perfil ya publicó, como haría `processSocialOutbox`. */
function insertSentPost(bookId: string, externalId: string, sentAt: Date): void {
  dbModule
    .getDb()
    .prepare(
      `INSERT INTO social_outbox
         (id, network, subject, body, status, attempts, next_attempt_at, created_at,
          external_id, external_url, sent_at)
       VALUES (?, 'mastodon', ?, 'texto', 'sent', 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      `soc_${externalId}`,
      bookId,
      sentAt.toISOString(),
      sentAt.toISOString(),
      externalId,
      `https://mastodon.social/@wanderbibliothek/${externalId}`,
      sentAt.toISOString(),
    );
}

/**
 * Instante fijo de las pruebas que publican: las 10:00 de Berlín.
 *
 * La fila se encola con esta referencia y el turno se calcula desde ella. Con
 * el reloj real, el minuto sorteado entre las 09:00 y las 20:00 podía caer
 * antes de la hora a la que se lanzaba la suite: el aviso quedaba encolado
 * para un instante ya pasado y el cron, con razón, no veía nada vencido.
 */
const REFERENCIA = new Date("2026-11-11T09:00:00Z");

/**
 * Instante en el que el aviso de esa fila ya puede salir: un minuto después de
 * su turno, contado desde `desde`, que es cuando se encoló.
 *
 * El cron no publica antes de `next_attempt_at` ni antes del minuto sorteado
 * para ese id, así que la prueba tiene que cumplir las dos condiciones.
 */
function despuesDelTurno(id: string, desde: Date): Date {
  return new Date(Math.max(mastodon.momentoDelAviso(id, desde).getTime(), desde.getTime()) + 60_000);
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

test("hay cien formulaciones", () => {
  assert.equal(mastodon.leadVariants().length, 100);
});

test("todas las formulaciones son enunciativas: sin exclamaciones ni emoji", () => {
  // El registro es de biblioteca, no de folleto: una frase, sin signos de
  // exclamación y sin pictogramas.
  const pictogram = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const seen = new Set<string>();
  for (const lead of mastodon.leadVariants()) {
    const text = lead("Título", "Autoría");
    assert.doesNotMatch(text, /[!¡]/, `«${text}» lleva exclamación`);
    assert.doesNotMatch(text, pictogram, `«${text}» lleva emoji`);
    assert.ok(text.endsWith("."), `«${text}» no cierra con punto`);
    assert.match(text, /Título/, `«${text}» no nombra el título`);
    assert.match(text, /Autoría/, `«${text}» no nombra la autoría`);
    seen.add(text);
  }
  // Dos variantes calcadas serían una variante menos, y nadie lo notaría.
  assert.equal(seen.size, 100, "hay formulaciones duplicadas");
});

test("las formulaciones no llevan referencias temporales", () => {
  // La cola publica días después del alta: decir «ab heute» o «heute» sería
  // mentira en el momento en que sale el aviso.
  const tiempo = /\b(heute|sofort|soeben|eben|jetzt|nun|seit|gestern|morgen|kürzlich)\b/i;
  for (const lead of mastodon.leadVariants()) {
    const text = lead("Título", "Autoría");
    assert.doesNotMatch(text, tiempo, `«${text}» sitúa el aviso en el tiempo`);
  }
});

test("la variante depende del id de la obra y se reparte", () => {
  assert.equal(mastodon.variantIndex("bok_abc", 100), mastodon.variantIndex("bok_abc", 100));
  const used = new Set<number>();
  for (let index = 0; index < 2000; index += 1) {
    used.add(mastodon.variantIndex(`bok_${index}`, 100));
  }
  assert.equal(used.size, 100, `solo se usan ${used.size} de 100 variantes`);
  assert.equal(mastodon.variantIndex("bok_x", 0), 0);
});

test("las etiquetas mezclan la casa, el tema del libro y la lectura", () => {
  const reading = mastodon.readingTags();
  // Sin tema conocido: la casa y dos etiquetas de lectura distintas.
  for (let index = 0; index < 200; index += 1) {
    const tags = mastodon.hashtagsFor(`bok_${index}`);
    assert.equal(tags.length, 3, "siempre tres etiquetas");
    assert.equal(tags[0], "Wanderbibliothek", "la etiqueta de la casa va primero");
    assert.equal(new Set(tags).size, 3, `etiquetas repetidas: ${tags.join(", ")}`);
    for (const tag of tags.slice(1)) assert.ok(reading.includes(tag), `${tag} no es de lectura`);
  }
  // El tema sale de las etiquetas curadas del ejemplar…
  const filosofia = mastodon.hashtagsFor("bok_filo", { tags: ["Filosofía"] });
  assert.deepEqual(filosofia.slice(0, 2), ["Wanderbibliothek", "Philosophie"]);
  assert.ok(reading.includes(filosofia[2]!), `la tercera es de lectura: ${filosofia[2]}`);
  // …y, si no hay, de la categoría de la obra.
  assert.equal(mastodon.hashtagsFor("bok_hist", { category: "Humanidades" })[1], "Geisteswissenschaften");
  // La etiqueta del ejemplar manda sobre la categoría.
  assert.equal(
    mastodon.hashtagsFor("bok_x", { category: "Ficción", tags: ["Historia"] })[1],
    "Geschichte",
  );
});

test("cada etiqueta y categoría del catálogo tiene su etiqueta alemana", async () => {
  const { TAGS, CATEGORIES } = await import("../src/lib/domain.ts");
  const hashtag = /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+$/;
  for (const tag of TAGS) {
    const [subject] = mastodon.subjectHashtags({ tags: [tag] });
    assert.match(subject ?? "", hashtag, `${tag} no tiene etiqueta alemana`);
  }
  for (const category of CATEGORIES) {
    const [subject] = mastodon.subjectHashtags({ category });
    assert.match(subject ?? "", hashtag, `${category} no tiene etiqueta alemana`);
  }
});

test("el aviso lleva el texto elegido, el enlace y las etiquetas", () => {
  const text = mastodon.composeStatus({
    title: "El infinito en un junco",
    author: "Irene Vallejo",
    url: "https://wanderbibliothek.org/werk/bok_1",
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
      seed: "bok_1",
    }),
  );
});

test("el título se conserva tal y como es, sin traducirlo", () => {
  // Un libro puede titularse en cualquier lengua: el aviso va en alemán, pero
  // el título no se toca. Ni acentos ni guiones ni mayúsculas se normalizan.
  const title = "Cien años de soledad — edición conmemorativa";
  const text = mastodon.composeStatus({
    title,
    author: "Gabriel García Márquez",
    url: "https://wanderbibliothek.org/werk/bok_1",
    seed: "bok_1",
    category: "Ficción",
  });
  assert.ok(text.includes(`„${title}“`), `el título cambia: ${text}`);
  assert.match(text, /#Belletristik/);
});

test("el aviso se escribe siempre en alemán, con sus comillas y etiquetas", () => {
  const text = mastodon.composeStatus({
    title: "T",
    author: "A",
    url: "https://x.org/werk/bok_1",
    seed: "bok_1",
  });
  assert.match(text, /„T“/);
  // Las etiquetas salen del fondo alemán, no de una lista fija.
  const tags = (text.match(/#\S+/g) ?? []).map((tag) => tag.slice(1));
  assert.deepEqual(tags, mastodon.hashtagsFor("bok_1"));
});

test("un título enorme se recorta y el enlace sobrevive", () => {
  const url = "https://wanderbibliothek.org/werk/bok_1";
  const text = mastodon.composeStatus({
    title: "Muy largo ".repeat(200),
    author: "Alguien",
    url,
    seed: "bok_1",
  });
  assert.ok(Array.from(text).length <= mastodon.STATUS_LIMIT, `mide ${Array.from(text).length}`);
  assert.match(text, /…/);
  assert.ok(text.includes(url), "el enlace no puede quedar cortado");
});

test("el enlace de la obra no lleva prefijo de idioma y conserva la marca del bot", () => {
  assert.equal(mastodon.workUrl("https://x.org/", "bok_1"), "https://x.org/werk/bok_1?ref=mastodon");
  // La marca no puede cambiar la página: la ruta sigue siendo la de la obra y
  // la canónica de esa página no lleva parámetros.
  assert.equal(
    mastodon.workUrl("https://x.org", "bok_1"),
    `https://x.org/werk/bok_1?ref=${mastodon.ANNOUNCE_REF}`,
  );
});

test("la portada lleva texto alternativo en alemán", () => {
  assert.equal(mastodon.coverAlt("1984", "George Orwell"), "Buchcover von „1984“ von George Orwell");
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
  const aviso = mastodon.enqueuePost({
    bookId: "bok_envia",
    text: "texto a publicar",
    now: REFERENCIA,
  })!;
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ id: "110", url: "https://mastodon.social/@wanderbibliothek/110" }),
  );
  const result = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, REFERENCIA),
  });
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

test("no encadena dos avisos del bot: espera a que el perfil publique otra cosa", async () => {
  clearQueue();
  const ahora = new Date("2026-11-11T12:00:00Z");
  // El aviso anterior salió otro día, así que el tope diario no es lo que frena
  // este: lo frena que la última entrada del perfil también es del bot.
  insertSentPost("bok_anterior", "500", new Date("2026-11-08T12:00:00Z"));
  const aviso = mastodon.enqueuePost({
    bookId: "bok_encadena",
    text: "texto",
    nextAttemptAt: ahora,
    now: ahora,
  })!;
  const { impl, calls } = fakeFetch((url) => {
    if (url.endsWith("/api/v1/accounts/verify_credentials")) return jsonResponse({ id: "acc_bot" });
    if (url.includes("/api/v1/accounts/acc_bot/statuses")) return jsonResponse([{ id: "500" }]);
    return jsonResponse({ id: "600", url: "https://mastodon.social/@wanderbibliothek/600" });
  });

  const result = await mastodon.processSocialOutbox({
    limit: 5,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, ahora),
  });

  assert.deepEqual(result, { sent: 0, failed: 0, skipped: true });
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/statuses")).length, 0);
  const fila = dbModule
    .getDb()
    .prepare("SELECT status FROM social_outbox WHERE id = ?")
    .get(aviso) as { status: string };
  assert.equal(fila.status, "pending", "el aviso sigue esperando, no se pierde");
});

test("publica cuando la última entrada del perfil no es del bot", async () => {
  clearQueue();
  const ahora = new Date("2026-11-11T12:00:00Z");
  insertSentPost("bok_anterior_2", "500", new Date("2026-11-08T12:00:00Z"));
  const aviso = mastodon.enqueuePost({
    bookId: "bok_tras_otro",
    text: "texto",
    nextAttemptAt: ahora,
    now: ahora,
  })!;
  const { impl, calls } = fakeFetch((url) => {
    if (url.endsWith("/api/v1/accounts/verify_credentials")) return jsonResponse({ id: "acc_bot" });
    if (url.includes("/api/v1/accounts/acc_bot/statuses")) return jsonResponse([{ id: "700" }]);
    return jsonResponse({ id: "600", url: "https://mastodon.social/@wanderbibliothek/600" });
  });

  const result = await mastodon.processSocialOutbox({
    limit: 5,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, ahora),
  });

  assert.equal(result.sent, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/statuses")).length, 1);
});

test("si no se puede leer el perfil, el aviso espera en vez de arriesgar", async () => {
  clearQueue();
  const ahora = new Date("2026-11-11T12:00:00Z");
  insertSentPost("bok_anterior_3", "500", new Date("2026-11-08T12:00:00Z"));
  const aviso = mastodon.enqueuePost({
    bookId: "bok_sin_perfil",
    text: "texto",
    nextAttemptAt: ahora,
    now: ahora,
  })!;
  const { impl, calls } = fakeFetch((url) => {
    if (url.endsWith("/api/v1/accounts/verify_credentials")) {
      return jsonResponse({ error: "This action is outside the authorized scopes" }, 403);
    }
    return jsonResponse({ id: "600", url: "https://mastodon.social/@wanderbibliothek/600" });
  });

  const result = await mastodon.processSocialOutbox({
    limit: 5,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, ahora),
  });

  assert.deepEqual(result, { sent: 0, failed: 0, skipped: true });
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/statuses")).length, 0);
});

test("la vía manual no consulta el perfil y publica igual", async () => {
  clearQueue();
  const ahora = new Date("2026-11-11T12:00:00Z");
  insertSentPost("bok_anterior_4", "500", new Date("2026-11-08T12:00:00Z"));
  const aviso = mastodon.enqueuePost({
    bookId: "bok_manual",
    text: "texto",
    nextAttemptAt: ahora,
    now: ahora,
  })!;
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ id: "600", url: "https://mastodon.social/@wanderbibliothek/600" }),
  );

  const result = await mastodon.processSocialOutbox({
    limit: 1,
    only: aviso,
    force: true,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, ahora),
  });

  assert.equal(result.sent, 1);
  assert.equal(
    calls.some((call) => call.url.includes("verify_credentials")),
    false,
    "el envío manual no pregunta por el perfil",
  );
});

test("si la obra cambia antes de publicarse, el aviso sale con los datos nuevos", async () => {
  // Una fila puede esperar horas (las tandas van separadas 4–7 horas): si
  // mientras tanto se corrige el título, ni el texto ni la tarjeta deben salir
  // con el dato viejo. La tarjeta se pinta al publicar y el texto se recompone
  // en ese momento con lo que hay en la base.
  clearQueue();
  const db = dbModule.getDb();
  const alta = "2026-01-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO users (id, name, email, city, password_hash, created_at)
     VALUES ('usr_mastodon', 'Mastodón', 'mastodon@example.test', 'Leipzig', 'scrypt$00$00', ?)`,
  ).run(alta);
  db.prepare(
    `INSERT INTO books (id, title, title_key, author, category, created_at)
     VALUES ('bok_actualiza', 'Título viejo', 'titulo viejo', 'Autora vieja', 'Ficción', ?)`,
  ).run(alta);
  db.prepare(
    `INSERT INTO listings (id, book_id, owner_id, condition, city, status, search_key, notes, created_at)
     VALUES ('lst_actualiza', 'bok_actualiza', 'usr_mastodon', 'Buen estado', 'Leipzig',
             'available', 'titulo viejo autora vieja leipzig', '', ?)`,
  ).run(alta);
  mastodon.enqueuePost({
    bookId: "bok_actualiza",
    text: "«Título viejo» von Autora vieja ist im Katalog.",
    now: REFERENCIA,
  });
  const aviso = db
    .prepare("SELECT id FROM social_outbox WHERE subject = 'bok_actualiza'")
    .get() as { id: string };
  db.prepare(
    "UPDATE books SET title = 'Título nuevo', author = 'Autora nueva' WHERE id = 'bok_actualiza'",
  ).run();

  const png = PNG.sync.write(
    (() => {
      const image = new PNG({ width: 1200, height: 630 });
      image.data.fill(90);
      return image;
    })(),
  );
  const { impl, calls } = fakeFetch((url) =>
    url.includes("/api/og/werk/")
      ? new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })
      : jsonResponse({ id: "121" }),
  );
  const result = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso.id, REFERENCIA),
  });
  assert.equal(result.sent, 1);

  // La tarjeta se pide **al publicar**, no al encolar: la ruta la pinta con los
  // datos de ese instante (y la fila guardaba otra cosa).
  assert.ok(
    calls.some((call) => call.url.endsWith("/api/og/werk/bok_actualiza")),
    "tiene que pedir la tarjeta en el momento de publicar",
  );

  const estado = calls.find((call) => call.url.endsWith("/api/v1/statuses"))!;
  const texto = String((estado.init.body as FormData).get("status"));
  assert.match(texto, /Título nuevo/, "el texto lleva el título corregido");
  assert.doesNotMatch(texto, /Título viejo/);
});

test("si la fila guarda una imagen, el estado la adjunta", async () => {
  clearQueue();
  const aviso = mastodon.enqueuePost({
    bookId: "bok_con_imagen",
    text: "texto",
    mediaId: "22348641",
    now: REFERENCIA,
  })!;
  const { impl, calls } = fakeFetch(() => jsonResponse({ id: "111" }));
  await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, REFERENCIA),
  });
  const form = calls[0]!.init.body as FormData;
  assert.deepEqual(form.getAll("media_ids[]"), ["22348641"]);
});

test("un 500 deja el aviso pendiente y con espera", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_500", text: "texto", now: REFERENCIA });
  const aviso = dbModule
    .getDb()
    .prepare("SELECT id FROM social_outbox WHERE subject = 'bok_500'")
    .get() as { id: string };
  const { impl } = fakeFetch(() => jsonResponse({ error: "caído" }, 503));
  const instante = despuesDelTurno(aviso.id, REFERENCIA);
  const result = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: instante,
  });
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
  assert.ok(
    row.next_attempt_at > instante.toISOString().slice(0, 19),
    "tiene que esperar",
  );
});

test("un token inválido no se reintenta: no mejora solo", async () => {
  clearQueue();
  const aviso = mastodon.enqueuePost({ bookId: "bok_401", text: "texto", now: REFERENCIA })!;
  const { impl } = fakeFetch(() => jsonResponse({ error: "The access token is invalid" }, 401));
  await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, REFERENCIA),
  });
  const row = dbModule
    .getDb()
    .prepare("SELECT status, last_error FROM social_outbox WHERE subject = ?")
    .get("bok_401") as { status: string; last_error: string };
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /access token/);
});

test("quedarse sin red deja el aviso para el siguiente intento", async () => {
  clearQueue();
  const aviso = mastodon.enqueuePost({ bookId: "bok_sin_red", text: "texto", now: REFERENCIA })!;
  const impl = (async () => {
    throw new Error("ECONNREFUSED mastodon.social");
  }) as unknown as typeof fetch;
  const result = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: despuesDelTurno(aviso, REFERENCIA),
  });
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
    // El aviso sale siempre en alemán: enlace sin prefijo y etiquetas alemanas.
    assert.match(row.body, /https:\/\/wanderbibliothek\.org\/werk\/bok_anuncio/);
    assert.match(row.body, /#Wanderbibliothek/);
    for (const tag of mastodon.hashtagsFor("bok_anuncio")) {
      assert.ok(row.body.includes(`#${tag}`), `falta #${tag}`);
    }

    // La segunda vez no se vuelve a anunciar.
    const again = await mastodon.announceBook({
      bookId: "bok_anuncio",
      title: "Ficciones",
      author: "Jorge Luis Borges",
      base: "https://wanderbibliothek.org",
      isAdmin: true,
    });
    assert.deepEqual(again, { queued: false, sent: false, media: false });
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});

test("la migración reescribe los avisos que aún esperan en la cola", async () => {
  clearQueue();
  const db = dbModule.getDb();
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO books
       (id, title, title_key, author, isbn, category, language, cover_url, created_at)
     VALUES ('bok_cola', 'Ficciones', 'ficciones', 'Jorge Luis Borges', NULL, 'Ficción', 'Español', NULL, ?)`,
  ).run(ahora);
  db.prepare(
    `INSERT OR REPLACE INTO books
       (id, title, title_key, author, isbn, category, language, cover_url, created_at)
     VALUES ('bok_cola_hist', 'Rayuela', 'rayuela', 'Julio Cortázar', NULL, 'Ficción', 'Español', NULL, ?)`,
  ).run(ahora);
  const insert = db.prepare(
    `INSERT INTO social_outbox (id, network, subject, body, status, attempts, next_attempt_at, created_at)
     VALUES (?, 'mastodon', ?, ?, ?, 0, ?, ?)`,
  );
  const viejo = "Alte Fassung: https://ejemplo/es/werk/bok_cola";
  insert.run("soc_cola_pendiente", "bok_cola", viejo, "pending", ahora, ahora);
  // La clave única es por obra, así que el historial va con otra obra.
  insert.run("soc_cola_enviada", "bok_cola_hist", viejo, "sent", ahora, ahora);

  try {
    const { refreshQueuedPosts } = await import("../src/lib/db/migrations.ts");
    assert.equal(refreshQueuedPosts(db), 1, "solo se reescribe el aviso pendiente");

    const filas = db
      .prepare("SELECT id, body FROM social_outbox ORDER BY id")
      .all() as { id: string; body: string }[];
    const pendiente = filas.find((fila) => fila.id === "soc_cola_pendiente")!;
    // Texto en alemán, enlace sin prefijo y etiquetas de tema y lectura.
    assert.match(pendiente.body, /„Ficciones“ von Jorge Luis Borges/);
    assert.match(pendiente.body, /#Wanderbibliothek/);
    assert.match(pendiente.body, /#Belletristik/);
    assert.match(pendiente.body, /\/werk\/bok_cola\?ref=mastodon/);
    // Lo ya enviado es historial: no se reescribe.
    const enviada = filas.find((fila) => fila.id === "soc_cola_enviada")!;
    assert.equal(enviada.body, viejo);
  } finally {
    db.prepare("DELETE FROM social_outbox WHERE id LIKE 'soc_cola_%'").run();
    db.prepare("DELETE FROM books WHERE id LIKE 'bok_cola%'").run();
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
  // Horas simuladas: el primer aviso sale en el acto y el segundo, el mismo día,
  // espera a la jornada siguiente (un libro al día). Las fechas son lógicas: la
  // prueba no debe depender del reloj real del equipo.
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
    // bot publica uno al día, así que cae en la jornada siguiente.
    assert.deepEqual(
      { queued: otraPersona.queued, sent: otraPersona.sent },
      { queued: true, sent: false },
      "otra persona sí tiene su aviso, encolado",
    );
    // El día siguiente a las 08:00 de Berlín ese turno ya está tomado, así que
    // el cuarto libro se va al día de después en vez de publicarse ahora.
    assert.deepEqual(
      { queued: alDiaSiguiente.queued, sent: alDiaSiguiente.sent },
      { queued: true, sent: false },
      "el turno del día siguiente ya lo tiene el aviso de otra persona",
    );

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
  // El aviso se encola al publicar un ejemplar: sin una copia viva, la cola
  // considera que la obra ya no se puede pedir y no la anuncia.
  dbModule
    .getDb()
    .prepare(
      `INSERT OR IGNORE INTO listings (id, book_id, owner_id, condition, city, status,
         search_key, created_at)
       VALUES (?, ?, 'usr_admin', 'Buen estado', 'Stuttgart', 'available', ?, '2026-11-08T00:00:00.000Z')`,
    )
    .run(`lst_${bookId}`, bookId, "iluminaciones");
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

test("la separación entre avisos es de un día: un libro al día", () => {
  // El bot anuncia **un libro al día**: la banda por defecto es de 24 h, así
  // que el segundo libro de una tanda cae en la jornada siguiente.
  assert.equal(mastodon.SOCIAL_GAP_MIN_MS, 24 * 60 * 60 * 1000);
  assert.equal(mastodon.SOCIAL_GAP_MAX_MS, 24 * 60 * 60 * 1000);
  assert.equal(mastodon.separacionAviso(() => 0), mastodon.SOCIAL_GAP_MIN_MS);
  assert.equal(mastodon.separacionAviso(() => 1), mastodon.SOCIAL_GAP_MAX_MS);
  assert.equal(mastodon.separacionAviso(() => 0.5), mastodon.SOCIAL_GAP_MIN_MS);
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
    // El turno se marca al abrir la ventana del día siguiente; la hora exacta
    // la sortea el cron dentro de la ventana.
    assert.equal(
      fechas[1]!,
      mastodon.inicioDeVentana(new Date(fechas[1]!)).getTime(),
      "el turno apunta a las 09:00 de Berlín",
    );
    assert.equal(
      fechas[2]! - fechas[1]!,
      24 * 60 * 60 * 1000,
      "un aviso por jornada: cada uno cae en el día siguiente",
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

test("el cron no publica dos libros el mismo día, y la hora se sortea", async () => {
  // Un libro al día: aunque haya dos avisos vencidos, la segunda pasada del
  // cron (cada quince minutos) se queda quieta y el segundo sale mañana. Y no
  // sale a las 09:00 en punto: cada fila tiene su minuto al azar dentro de la
  // ventana, estable durante el día.
  clearQueue();
  let publicados = 0;
  // Lo último que hay en el perfil. Entre un día y otro la cuenta publica otra
  // cosa, que es lo que permite al bot volver a anunciar.
  let ultimaEntrada = "700";
  const { impl, calls } = fakeFetch((url) => {
    if (url.endsWith("/api/v1/accounts/verify_credentials")) return jsonResponse({ id: "acc_bot" });
    if (url.includes("/api/v1/accounts/acc_bot/statuses")) {
      return jsonResponse([{ id: ultimaEntrada }]);
    }
    publicados += 1;
    ultimaEntrada = String(publicados);
    return jsonResponse({ id: String(publicados) });
  });
  const estados = () => calls.filter((call) => call.url.endsWith("/api/v1/statuses")).length;
  const manana = new Date("2026-11-09T08:00:00Z"); // 09:00 en Berlín, abre la ventana
  const id1 = mastodon.enqueuePost({
    bookId: "bok_uno_al_dia_1",
    text: "uno",
    nextAttemptAt: manana,
    now: manana,
  })!;
  mastodon.enqueuePost({ bookId: "bok_uno_al_dia_2", text: "dos", nextAttemptAt: manana, now: manana });

  // La fila que el cron va a mirar es la más antigua vencida; se toma de la
  // base y no se supone, para que el minuto sorteado sea el suyo aunque dos
  // inserciones caigan en el mismo milisegundo.
  const elegida = (
    dbModule
      .getDb()
      .prepare(
        `SELECT id FROM social_outbox
          WHERE network = 'mastodon' AND status = 'pending' AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC, created_at ASC, rowid ASC LIMIT 1`,
      )
      .get(manana.toISOString()) as { id: string }
  ).id;
  assert.ok(id1, "la primera fila se encoló");
  const momento = mastodon.momentoDelAviso(elegida, manana);
  assert.ok(
    momento.getTime() >= mastodon.inicioDeVentana(manana).getTime(),
    "el minuto sorteado está dentro de la ventana",
  );
  assert.ok(momento.getTime() < new Date("2026-11-09T19:00:00Z").getTime(), "y antes de las 20:00");

  // Antes de su minuto no se publica, aunque la ventana esté abierta. Solo se
  // comprueba si el minuto sorteado cae más tarde: con el minuto 0 la fila ya
  // toca a las 09:00 y la pasada publicaría, que es justo lo que se mide abajo.
  if (momento.getTime() > manana.getTime()) {
    const temprano = await mastodon.processSocialOutbox({
      limit: 50,
      config: CONFIG,
      fetchImpl: impl,
      now: manana,
    });
    assert.deepEqual(temprano, { sent: 0, failed: 0, skipped: true }, "todavía no es su minuto");
    assert.equal(estados(), 0);
  }

  const primera = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: momento,
  });
  assert.equal(primera.sent, 1, "sale cuando llega su minuto");
  assert.equal(estados(), 1);

  // Ya publicado el de hoy, el siguiente no sale aunque le llegue la hora.
  const segunda = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: momento,
  });
  assert.deepEqual(segunda, { sent: 0, failed: 0, skipped: true }, "el segundo espera a mañana");
  assert.equal(estados(), 1, "no se publica nada más ese día");

  // Al día siguiente sí: se prueba al final de la ventana, cuando ya pasó
  // cualquier minuto sorteado. Entre medias la cuenta publicó otra cosa, así
  // que el bot no encadena dos entradas propias.
  ultimaEntrada = "700";
  const inicioManana = mastodon.inicioDeVentana(new Date(momento.getTime() + 24 * 60 * 60 * 1000));
  const finManana = new Date(inicioManana.getTime() + 11 * 60 * 60 * 1000 - 60_000); // 19:59
  const tercera = await mastodon.processSocialOutbox({
    limit: 50,
    config: CONFIG,
    fetchImpl: impl,
    now: finManana,
  });
  assert.equal(tercera.sent, 1, "al día siguiente sí toca");
  assert.equal(estados(), 2);
});

test("la hora del aviso se sortea dentro de la ventana y no cambia en el día", () => {
  const dia = new Date("2026-11-09T08:00:00Z"); // 09:00 en Berlín
  const inicio = mastodon.inicioDeVentana(dia).getTime();
  const fin = inicio + 11 * 60 * 60 * 1000; // 20:00

  const primera = mastodon.momentoDelAviso("soc_abc", dia);
  assert.ok(primera.getTime() >= inicio, "no antes de las 09:00");
  assert.ok(primera.getTime() < fin, "no después de las 20:00");

  // El cron pasa cada quince minutos: la hora ya sorteada no cambia en el día.
  assert.equal(
    mastodon.momentoDelAviso("soc_abc", new Date("2026-11-09T17:00:00Z")).getTime(),
    primera.getTime(),
  );

  // Filas distintas, minutos distintos: no salen todas a la misma hora.
  const minutos = new Set(
    Array.from({ length: 20 }, (_, i) => mastodon.momentoDelAviso(`soc_${i}`, dia).getTime()),
  );
  assert.ok(minutos.size > 15, `el reparto debería usar la ventana, no ${minutos.size} minutos`);

  // Y cada día toca una hora nueva.
  const otroDia = mastodon.momentoDelAviso("soc_abc", new Date("2026-11-10T08:00:00Z"));
  assert.notEqual(otroDia.getTime(), primera.getTime(), "el mismo libro no sale siempre a la misma hora");
});

/* ------------------------- silencio nocturno ------------------------------ */
test("entre las 20:00 y las 09:00 de Berlín no se publica nada", () => {
  const anterior = process.env.MASTODON_QUIET_HOURS;
  delete process.env.MASTODON_QUIET_HOURS;
  try {
    // Noviembre: Berlín va una hora por delante de UTC.
    const casos: [string, boolean][] = [
      ["2026-11-09T07:59:00Z", true], // 08:59
      ["2026-11-09T08:00:00Z", false], // 09:00, ya se puede
      ["2026-11-09T12:00:00Z", false], // 13:00
      ["2026-11-09T18:59:00Z", false], // 19:59, último minuto permitido
      ["2026-11-09T19:00:00Z", true], // 20:00, se cierra
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

test("--ahora suelta un aviso concreto sin turno ni horario de silencio", async () => {
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
    // Turno muy futuro y de madrugada: con el cron no saldría ni hoy ni ahora.
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO social_outbox (id, network, subject, body, status, attempts, next_attempt_at, created_at)
         VALUES ('soc_tarde', 'mastodon', 'bok_tarde', 'texto', 'pending', 0,
                 '2099-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      )
      .run();
    const noche = new Date("2026-11-09T23:00:00Z");
    const cron = await mastodon.processSocialOutbox({ now: noche });
    assert.deepEqual(cron, { sent: 0, failed: 0, skipped: true }, "el cron calla");
    assert.equal(llamadas.length, 0, "ni una petición a Mastodon");

    const manual = await mastodon.processSocialOutbox({
      only: "soc_tarde",
      force: true,
      now: noche,
    });
    assert.equal(manual.sent, 1);
    assert.equal(llamadas.length > 0, true, "la vía manual sí publica");
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
    if (anterior === undefined) delete process.env.MASTODON_QUIET_HOURS;
    else process.env.MASTODON_QUIET_HOURS = anterior;
  }
});

test("`force` sin `only` no adelanta la cola entera", async () => {
  clearQueue();
  process.env.MASTODON_TOKEN = "tok";
  const anterior = process.env.MASTODON_QUIET_HOURS;
  delete process.env.MASTODON_QUIET_HOURS;
  try {
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO social_outbox (id, network, subject, body, status, attempts, next_attempt_at, created_at)
         VALUES ('soc_futuro', 'mastodon', 'bok_futuro', 'texto', 'pending', 0,
                 '2099-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      )
      .run();
    // Sin `only`, `force` no vale: el cron no puede saltarse la separación.
    const result = await mastodon.processSocialOutbox({
      force: true,
      now: new Date("2026-11-09T10:00:00Z"),
    });
    assert.equal(result.sent, 0);
  } finally {
    delete process.env.MASTODON_TOKEN;
    if (anterior === undefined) delete process.env.MASTODON_QUIET_HOURS;
    else process.env.MASTODON_QUIET_HOURS = anterior;
  }
});

test("una obra sin ejemplares vivos no se anuncia cuando le llega el turno", async () => {
  clearQueue();
  const db = dbModule.getDb();
  // La obra existe (la cola la conoce) pero su única copia se retiró entre el
  // encolado y el turno: el enlace a /werk ya no ofrece nada que pedir.
  db.prepare(
    `INSERT OR IGNORE INTO books (id, title, title_key, author, category, created_at)
     VALUES ('bok_retirada', 'Libro retirado', 'libro retirado', 'Autoría', 'Ficción',
             '2026-11-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO listings (id, book_id, owner_id, condition, city, status,
       search_key, created_at)
     VALUES ('lst_retirada', 'bok_retirada', 'usr_admin', 'Buen estado', 'Stuttgart',
             'removed', 'libro retirado', '2026-11-01T00:00:00.000Z')`,
  ).run();
  mastodon.enqueuePost({ bookId: "bok_retirada", text: "No debería salir.", now: REFERENCIA });
  const aviso = db
    .prepare("SELECT id FROM social_outbox WHERE subject = 'bok_retirada'")
    .get() as { id: string };

  let llamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    llamadas += 1;
    return jsonResponse({ id: "1" });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";

  try {
    const resultado = await mastodon.processSocialOutbox({
      now: despuesDelTurno(aviso.id, REFERENCIA),
    });
    assert.equal(resultado.sent, 0, "no se publica nada");
    assert.equal(resultado.failed, 1);
    assert.equal(llamadas, 0, "no se llega a hablar con Mastodon");

    const fila = db
      .prepare("SELECT status, last_error FROM social_outbox WHERE subject = 'bok_retirada'")
      .get() as { status: string; last_error: string };
    assert.equal(fila.status, "failed", "la fila se cierra; no se reintenta en balde");
    assert.match(fila.last_error, /ejemplares/i);
  } finally {
    globalThis.fetch = original;
    delete process.env.MASTODON_TOKEN;
  }
});
