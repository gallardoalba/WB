import assert from "node:assert/strict";
import { before, test } from "node:test";

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

/** Respuesta mínima de Mastodon para `POST /api/v1/statuses`. */
function statusResponse(body: unknown, status = 200): Response {
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

test("el aviso lleva título, autoría, enlace y etiquetas", () => {
  const text = mastodon.composeStatus({
    title: "El infinito en un junco",
    author: "Irene Vallejo",
    url: "https://wanderbibliothek.org/werk/bok_1",
    locale: "de",
  });
  assert.match(text, /El infinito en un junco/);
  assert.match(text, /Irene Vallejo/);
  assert.match(text, /https:\/\/wanderbibliothek\.org\/werk\/bok_1/);
  assert.match(text, /#Wanderbibliothek/);
  assert.ok(Array.from(text).length <= mastodon.STATUS_LIMIT);
});

test("cada idioma escribe el aviso en su idioma", () => {
  const base = { title: "T", author: "A", url: "https://x.org/werk/bok_1" };
  assert.match(mastodon.composeStatus({ ...base, locale: "de" }), /Neu bei Wanderbibliothek/);
  assert.match(mastodon.composeStatus({ ...base, locale: "es" }), /Nuevo en Wanderbibliothek/);
  assert.match(mastodon.composeStatus({ ...base, locale: "en" }), /New on Wanderbibliothek/);
});

test("un título enorme se recorta y el enlace sobrevive", () => {
  const url = "https://wanderbibliothek.org/werk/bok_1";
  const text = mastodon.composeStatus({
    title: "Muy largo ".repeat(200),
    author: "Alguien",
    url,
    locale: "de",
  });
  // 500 puntos de código es el límite del estado; con `length` un título con
  // emojis se colaría por encima del tope.
  assert.ok(Array.from(text).length <= mastodon.STATUS_LIMIT, `mide ${Array.from(text).length}`);
  assert.match(text, /…/);
  assert.ok(text.includes(url), "el enlace no puede quedar cortado");
  assert.match(text, /#Bücher/);
});

test("el enlace lleva el prefijo de idioma y el bot escribe en el del ejemplar", () => {
  assert.equal(mastodon.localeForLanguage("Español"), "es");
  assert.equal(mastodon.localeForLanguage("Inglés"), "en");
  assert.equal(mastodon.localeForLanguage("Alemán"), "de");
  // «Otro» y «No especificado» no dicen nada: idioma de la casa.
  assert.equal(mastodon.localeForLanguage("No especificado"), "de");
  assert.equal(mastodon.localeForLanguage(null), "de");

  assert.equal(mastodon.workUrl("https://x.org/", "bok_1", "de"), "https://x.org/werk/bok_1");
  assert.equal(mastodon.workUrl("https://x.org", "bok_1", "es"), "https://x.org/es/werk/bok_1");
  assert.equal(mastodon.workUrl("https://x.org", "bok_1", "en"), "https://x.org/en/werk/bok_1");
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
  const { impl, calls } = fakeFetch(() => statusResponse({ id: "1" }));
  const result = await mastodon.processSocialOutbox({ limit: 5, config: null, fetchImpl: impl });
  assert.deepEqual(result, { sent: 0, failed: 0, skipped: true });
  assert.equal(calls.length, 0);
});

test("un aviso pendiente se publica con el token y la clave de idempotencia", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_envia", text: "texto a publicar" });
  const { impl, calls } = fakeFetch(() =>
    statusResponse({ id: "110", url: "https://mastodon.social/@wanderbibliothek/110" }),
  );
  const config = { instance: "https://mastodon.social", token: "secreto", visibility: "public" as const };
  const result = await mastodon.processSocialOutbox({ limit: 50, config, fetchImpl: impl });
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

test("un 500 deja el aviso pendiente y con espera", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_500", text: "texto" });
  const { impl } = fakeFetch(() => statusResponse({ error: "caído" }, 503));
  const config = { instance: "https://mastodon.social", token: "t", visibility: "public" as const };
  const result = await mastodon.processSocialOutbox({ limit: 50, config, fetchImpl: impl });
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
  const { impl } = fakeFetch(() => statusResponse({ error: "The access token is invalid" }, 401));
  const config = { instance: "https://mastodon.social", token: "malo", visibility: "public" as const };
  await mastodon.processSocialOutbox({ limit: 50, config, fetchImpl: impl });
  const row = dbModule
    .getDb()
    .prepare("SELECT status, last_error FROM social_outbox WHERE subject = ?")
    .get("bok_401") as { status: string; last_error: string };
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /access token/);
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
    return statusResponse({ id: "7", url: "https://mastodon.social/@wanderbibliothek/7" });
  }) as unknown as typeof fetch;
  process.env.MASTODON_TOKEN = "tok";
  try {
    const result = await mastodon.announceBook({
      bookId: "bok_anuncio",
      title: "Ficciones",
      author: "Jorge Luis Borges",
      language: "Español",
      base: "https://wanderbibliothek.org",
    });
    assert.deepEqual(result, { queued: true, sent: true });
    assert.equal(calls.length, 1);
    const row = dbModule
      .getDb()
      .prepare("SELECT body, status FROM social_outbox WHERE subject = ?")
      .get("bok_anuncio") as { body: string; status: string };
    assert.equal(row.status, "sent");
    // El ejemplar está en español: aviso en español y enlace con prefijo.
    assert.match(row.body, /Nuevo en Wanderbibliothek/);
    assert.match(row.body, /https:\/\/wanderbibliothek\.org\/es\/werk\/bok_anuncio/);
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
    assert.deepEqual(result, { queued: false, sent: false });
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
  assert.deepEqual(result, { queued: false, sent: false });
  const rows = dbModule
    .getDb()
    .prepare("SELECT COUNT(*) AS n FROM social_outbox WHERE subject = ?")
    .get("bok_sin_bot") as { n: number };
  assert.equal(rows.n, 0, "sin bot no se acumulan filas muertas en la cola");
});

test("quedarse sin red deja el aviso para el siguiente intento", async () => {
  clearQueue();
  mastodon.enqueuePost({ bookId: "bok_sin_red", text: "texto" });
  const impl = (async () => {
    throw new Error("ECONNREFUSED mastodon.social");
  }) as unknown as typeof fetch;
  const config = { instance: "https://mastodon.social", token: "t", visibility: "public" as const };
  const result = await mastodon.processSocialOutbox({ limit: 50, config, fetchImpl: impl });
  assert.equal(result.failed, 1);
  const row = dbModule
    .getDb()
    .prepare("SELECT status, last_error FROM social_outbox WHERE subject = ?")
    .get("bok_sin_red") as { status: string; last_error: string };
  assert.equal(row.status, "pending");
  assert.match(row.last_error, /ECONNREFUSED/);
});
