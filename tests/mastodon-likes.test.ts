/**
 * El bot de «me gusta»: lo que se prueba aquí es, sobre todo, que no parezca un
 * robot. Los filtros, los topes y la memoria son la funcionalidad; la llamada a
 * Mastodon es lo de menos.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";
delete process.env.MASTODON_TOKEN;
delete process.env.MASTODON_LIKES;

type Likes = typeof import("../src/lib/mastodon-likes.ts");
type LikeConfig = import("../src/lib/mastodon-likes.ts").LikeConfig;
type DbModule = typeof import("../src/lib/db/index.ts");

let likes: Likes;
let dbModule: DbModule;

before(async () => {
  likes = await import("../src/lib/mastodon-likes.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

const CONFIG: LikeConfig = {
  instance: "https://mastodon.social",
  token: "secreto",
  visibility: "public",
  perDay: 40,
  minGapMinutes: 25,
  tags: null,
  locales: ["de"],
  perAccount: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Estado de Mastodon válido, tal y como lo devuelve la API (snake_case). */
function rawStatus(overrides: Record<string, unknown> = {}) {
  return {
    id: "111",
    url: "https://mastodon.social/@lectora/111",
    content:
      "<p>Ich habe <em>Der eindimensionale Mensch</em> gelesen und empfehle das Buch seit zwei Tagen jedem, der mir über den Weg läuft.</p>",
    language: "de",
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    visibility: "public",
    reblog: null,
    favourited: false,
    sensitive: false,
    account: {
      id: "42",
      acct: "lectora",
      bot: false,
      statuses_count: 120,
      note: "<p>Bücherwurm · lese jeden Abend zwei Kapitel</p>",
    },
    ...overrides,
  };
}

/** El mismo estado ya normalizado, que es lo que comen los filtros. */
function status(overrides: Record<string, unknown> = {}) {
  return likes.toStatus(rawStatus(overrides))!;
}

function clearMemory(): void {
  dbModule.getDb().prepare("DELETE FROM social_likes").run();
}

/** `fetch` de mentira: apunta las llamadas y responde lo que se le diga. */
function fakeFetch(reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return reply(url, init ?? {});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/* ------------------------------ configuración ---------------------------- */

test("sin MASTODON_LIKES el bot de «me gusta» está apagado", () => {
  assert.equal(likes.likesConfig({ MASTODON_TOKEN: "tok" }), null);
  assert.equal(likes.likesConfig({ MASTODON_TOKEN: "tok", MASTODON_LIKES: "no" }), null);
  assert.equal(likes.likesConfig({ MASTODON_LIKES: "on" }), null, "sin token tampoco");
});

test("por defecto se miran los tres idiomas y un tope de 40 al día", () => {
  const config = likes.likesConfig({ MASTODON_TOKEN: "t", MASTODON_LIKES: "on" });
  assert.deepEqual(config?.locales, ["de", "es", "en"]);
  assert.equal(config?.perDay, 40);
  assert.equal(config?.perAccount, 1);
});

test("los idiomas se pueden recortar y lo que no existe se descarta", () => {
  assert.deepEqual(
    likes.likesConfig({ MASTODON_TOKEN: "t", MASTODON_LIKES: "on", MASTODON_LIKES_LOCALES: "de" })
      ?.locales,
    ["de"],
  );
  assert.deepEqual(
    likes.likesConfig({ MASTODON_TOKEN: "t", MASTODON_LIKES: "on", MASTODON_LIKES_LOCALES: "de,es" })
      ?.locales,
    ["de", "es"],
  );
  assert.deepEqual(
    likes.likesConfig({ MASTODON_TOKEN: "t", MASTODON_LIKES: "on", MASTODON_LIKES_LOCALES: "fr" })
      ?.locales,
    ["de", "es", "en"],
  );
  assert.deepEqual(
    likes.likesConfig({
      MASTODON_TOKEN: "t",
      MASTODON_LIKES: "on",
      MASTODON_LIKES_LOCALES: "ES-ES,de",
    })?.locales,
    ["es", "de"],
  );
});

test("solo se pulsa a cuentas que dicen en su perfil que leen", () => {
  const sinLibros = likes.likeableStatus(
    status({ account: { id: "9", acct: "tienda", bot: false, statuses_count: 90, note: "<p>Kaffee und Kuchen</p>" } }),
    { locale: "de" },
  );
  assert.equal(sinLibros.ok, false);
  if (!sinLibros.ok) assert.equal(sinLibros.reason, "la cuenta no dice nada de libros");

  for (const nota of ["Bücherwurm", "Leseratte aus Köln", "Ich rezensiere Romane", "Buchhandlung Weber"]) {
    const conLibros = likes.likeableStatus(
      status({ account: { id: "9", acct: "x", bot: false, statuses_count: 90, note: `<p>${nota}</p>` } }),
      { locale: "de" },
    );
    assert.equal(conLibros.ok, true, `${nota}: debería valer`);
  }
});

test("también vale en castellano y en inglés, cada uno con su etiqueta", () => {
  const castellano = likes.toStatus({
    id: "901",
    content:
      "<p>Terminé <em>El infinito en un junco</em> y lo recomiendo a quien lea novela o ensayo: un libro para leer con lápiz en la mano.</p>",
    language: "es",
    created_at: new Date().toISOString(),
    visibility: "public",
    reblog: null,
    favourited: false,
    sensitive: false,
    account: {
      id: "50",
      acct: "lectora.es",
      bot: false,
      statuses_count: 200,
      note: "<p>Lectura, libros y novela negra</p>",
    },
  })!;
  assert.deepEqual(likes.likeableStatus(castellano, { locale: "es" }), { ok: true });
  // La misma publicación no vale para la etiqueta alemana: el idioma manda.
  const enAleman = likes.likeableStatus(castellano, { locale: "de" });
  assert.equal(enAleman.ok, false);

  const ingles = likes.toStatus({
    id: "902",
    content:
      "<p>Just finished <em>Piranesi</em> and I keep recommending it: a book that asks to be read twice, slowly, with the window open.</p>",
    language: "en",
    created_at: new Date().toISOString(),
    visibility: "public",
    reblog: null,
    favourited: false,
    sensitive: false,
    account: {
      id: "51",
      acct: "reader.en",
      bot: false,
      statuses_count: 200,
      note: "<p>Reader, bookseller, reviews of novels</p>",
    },
  })!;
  assert.deepEqual(likes.likeableStatus(ingles, { locale: "en" }), { ok: true });
});

test("por cuenta se puede limitar a más de un «me gusta» al día", () => {  const cuenta = new Map([["lectora", 2]]);
  const conTope1 = likes.likeableStatus(status(), { locale: "de", accountsLiked: cuenta });
  assert.equal(conTope1.ok, false);
  const conTope2 = likes.likeableStatus(status(), {
    locale: "de",
    accountsLiked: cuenta,
    maxPerAccount: 3,
  });
  assert.equal(conTope2.ok, true);
});

test("los topes se pueden ajustar y se quedan en un rango sensato", () => {
  assert.equal(likes.likesConfig({ MASTODON_TOKEN: "t", MASTODON_LIKES: "on" })?.perDay, 40);
  assert.equal(
    likes.likesConfig({
      MASTODON_TOKEN: "t",
      MASTODON_LIKES: "on",
      MASTODON_LIKES_PER_DAY: "25",
      MASTODON_LIKES_MIN_GAP_MINUTES: "10",
    })?.perDay,
    25,
  );
  // 0 es «no des ninguno», no «usa el valor por defecto».
  assert.equal(
    likes.likesConfig({ MASTODON_TOKEN: "t", MASTODON_LIKES: "on", MASTODON_LIKES_PER_DAY: "0" }),
    null,
  );
  // Un valor absurdo no puede convertir el bot en una ametralladora.
  const feroz = likes.likesConfig({
    MASTODON_TOKEN: "t",
    MASTODON_LIKES: "on",
    MASTODON_LIKES_PER_DAY: "999",
    MASTODON_LIKES_MIN_GAP_MINUTES: "1",
  });
  assert.equal(feroz?.perDay, 60);
  assert.equal(feroz?.minGapMinutes, 5);
});

test("las etiquetas propias se limpian y se admiten con o sin almohadilla", () => {
  const config = likes.likesConfig({
    MASTODON_TOKEN: "t",
    MASTODON_LIKES: "on",
    MASTODON_LIKES_TAGS: "#Leseliste, Buchtipp  #bücher",
  });
  assert.deepEqual(config?.tags, ["Leseliste", "Buchtipp", "bücher"]);
});

/* ------------------------------- el estado -------------------------------- */

test("el texto del estado pierde el HTML y las entidades", () => {
  const text = likes.statusText(
    "<p>Un libro &amp; una tarde<br />«El infinito en un junco»</p>",
  );
  assert.equal(text, "Un libro & una tarde «El infinito en un junco»");
});

test("un estado sin identificador o sin cuenta se descarta", () => {
  assert.equal(likes.toStatus({ id: "", account: { acct: "x" } }), null);
  assert.equal(likes.toStatus({ id: "1", account: {} }), null);
  assert.ok(likes.toStatus({ id: "1", account: { acct: "x" } }));
});

/* -------------------------------- filtros -------------------------------- */

test("solo se pulsa lo que parece una persona hablando de libros", () => {
  const base = { locale: "de" as const };
  assert.deepEqual(likes.likeableStatus(status(), base), { ok: true });

  const casos: [Record<string, unknown>, string][] = [
    [{ reblog: { id: "2" } }, "es un boost"],
    [{ visibility: "private" }, "no es público"],
    [{ sensitive: true }, "está marcado como sensible"],
    [{ favourited: true }, "ya le gusta"],
    [{ account: { id: "9", acct: "otro", bot: true, statuses_count: 100 } }, "es otro bot"],
    [{ account: { id: "9", acct: "nuevo", bot: false, statuses_count: 3 } }, "cuenta sin recorrido"],
    [{ content: "<p>Hola #Bücher</p>" }, "texto demasiado corto"],
    [{ content: "<p>Ein Text über den Winter, den Regen und das Wetter in der Stadt, ohne dass es um etwas anderes geht als darum.</p>" }, "no habla de libros"],
    [{ created_at: new Date(Date.now() - 30 * 86_400_000).toISOString() }, "demasiado antiguo"],
    [{ language: "fr" }, "otro idioma"],
  ];
  for (const [overrides, esperado] of casos) {
    const result = likes.likeableStatus(status(overrides), base);
    assert.equal(result.ok, false, `${esperado}: debería descartarse`);
    if (!result.ok) assert.equal(result.reason, esperado);
  }
});

test("no se pulsa al propio bot, ni dos veces a la misma cuenta o al mismo estado", () => {
  const base = { locale: "de" as const, myAccountId: "42" };
  const propio = likes.likeableStatus(status(), base);
  assert.equal(propio.ok, false);
  if (!propio.ok) assert.equal(propio.reason, "es nuestro propio estado");

  const cuentaRepetida = likes.likeableStatus(status(), {
    locale: "de",
    accountsLiked: new Map([["lectora", 1]]),
  });
  assert.equal(cuentaRepetida.ok, false);
  if (!cuentaRepetida.ok) assert.equal(cuentaRepetida.reason, "ya le gustó a esa cuenta hoy");

  const yaPulsado = likes.likeableStatus(status(), {
    locale: "de",
    statusesLiked: new Set(["111"]),
  });
  assert.equal(yaPulsado.ok, false);
  if (!yaPulsado.ok) assert.equal(yaPulsado.reason, "ya se pulsó");
});

/* ------------------------------ la llamada -------------------------------- */

test("la línea de tiempo de la etiqueta se pide sin token y con su límite", async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse([]));
  const page = await likes.tagTimeline(CONFIG, "Bücher", { limit: 5, fetchImpl: impl });
  assert.equal(page.ok, true);
  assert.match(calls[0]!.url, /\/api\/v1\/timelines\/tag\/B%C3%BCcher\?limit=5&local=false$/);
  // Las líneas de tiempo de etiquetas son públicas: leer sin token evita
  // pedirle a la cuenta un permiso más (`read:statuses`).
  assert.equal(calls[0]!.init.headers, undefined);
});

test("si al token le falta write:favourites, el motivo lo dice", async () => {
  clearMemory();
  const { impl } = mastodonReply({
    statuses: [rawStatus()],
    favouriteMessage: "This action is outside the authorized scopes",
    favourite: 403,
  });
  const result = await likes.processLikes({ config: CONFIG, fetchImpl: impl, maxTags: 99 });
  assert.equal(result.liked, false);
  assert.match(result.reason, /write:favourites/);
});

test("un 404 de etiqueta no se reintenta y un 429 sí", async () => {
  const notFound = fakeFetch(() => jsonResponse({ error: "Record not found" }, 404));
  const r1 = await likes.tagTimeline(CONFIG, "inventada", { fetchImpl: notFound.impl });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.retryable, false);

  const limited = fakeFetch(() => jsonResponse({ error: "Too many requests" }, 429));
  const r2 = await likes.tagTimeline(CONFIG, "Books", { fetchImpl: limited.impl });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.retryable, true);
});

/* ------------------------------- una pasada ------------------------------ */

/** Servidor de mentira con cuenta propia, una etiqueta y un «me gusta». */
function mastodonReply(
  options: { statuses: unknown[]; favourite?: number; favouriteMessage?: string } = {
    statuses: [],
  },
) {
  return fakeFetch((url, init) => {
    if (url.includes("/accounts/verify_credentials")) {
      return jsonResponse({ id: "999", acct: "wanderbibliothek", username: "wanderbibliothek" });
    }
    if (url.includes("/timelines/tag/")) return jsonResponse(options.statuses);
    if (url.includes("/favourite") && (init.method ?? "GET") === "POST") {
      return options.favouriteMessage
        ? jsonResponse({ error: options.favouriteMessage }, options.favourite ?? 200)
        : jsonResponse({ id: "111" }, options.favourite ?? 200);
    }
    return jsonResponse({ error: "no esperado" }, 500);
  });
}

test("da un «me gusta» y lo apunta para no repetirlo", async () => {
  clearMemory();
  const { impl, calls } = mastodonReply({ statuses: [rawStatus()] });
  const result = await likes.processLikes({ config: CONFIG, fetchImpl: impl, maxTags: 99 });
  assert.equal(result.liked, true);
  assert.equal(result.status?.account, "lectora");
  assert.equal(calls.filter((call) => call.url.includes("/favourite")).length, 1);
  assert.equal(likes.likeCountSince(), 1);

  // El mismo estado no se vuelve a pulsar aunque Mastodon lo devuelva otra vez.
  const otra = await likes.processLikes({
    config: { ...CONFIG, minGapMinutes: 0 },
    fetchImpl: mastodonReply({ statuses: [rawStatus()] }).impl,
    now: new Date(Date.now() + 60 * 60 * 1000),
    maxTags: 99,
  });
  assert.equal(otra.liked, false);
});

test("en simulación recorre el camino pero no pulsa nada", async () => {
  clearMemory();
  const { impl, calls } = mastodonReply({ statuses: [rawStatus()] });
  const result = await likes.processLikes({ config: CONFIG, fetchImpl: impl, dryRun: true, maxTags: 99 });
  assert.equal(result.liked, false);
  assert.equal(result.reason, "simulación: no se ha pulsado nada");
  assert.equal(result.status?.id, "111");
  assert.equal(calls.filter((call) => call.url.includes("/favourite")).length, 0);
  assert.equal(likes.likeCountSince(), 0);
});

test("respeta el descanso entre pulsaciones", async () => {
  clearMemory();
  likes.recordLike({ statusId: "ayer", accountAcct: "otra", url: null });
  const result = await likes.processLikes({
    config: CONFIG,
    fetchImpl: mastodonReply({ statuses: [rawStatus()] }).impl,
  });
  assert.equal(result.liked, false);
  assert.match(result.reason, /descanso/);
});

test("respeta el tope en 24 h", async () => {
  clearMemory();
  for (let index = 0; index < CONFIG.perDay; index += 1) {
    likes.recordLike({ statusId: `viejo-${index}`, accountAcct: `cuenta-${index}` });
  }
  const result = await likes.processLikes({
    config: CONFIG,
    fetchImpl: mastodonReply({ statuses: [status()] }).impl,
  });
  assert.equal(result.liked, false);
  assert.match(result.reason, /tope/);
});

test("una cuenta por día: si ya se le pulsó, se busca otra publicación", async () => {
  clearMemory();
  likes.recordLike({ statusId: "otro-estado-suyo", accountAcct: "lectora" });
  const result = await likes.processLikes({
    config: { ...CONFIG, minGapMinutes: 5, perDay: 8 },
    fetchImpl: mastodonReply({ statuses: [rawStatus()] }).impl,
    now: new Date(Date.now() + 60 * 60 * 1000),
    maxTags: 99,
  });
  // Solo hay una etiqueta con una única candidata de esa cuenta: no hay nada.
  assert.equal(result.liked, false);
  assert.match(result.reason, /nada que mereciera/);
});

test("si Mastodon rechaza el «me gusta», no se apunta nada", async () => {
  clearMemory();
  const { impl } = mastodonReply({ statuses: [rawStatus()], favourite: 429 });
  const result = await likes.processLikes({ config: CONFIG, fetchImpl: impl, maxTags: 99 });
  assert.equal(result.liked, false);
  assert.match(result.reason, /no se pudo dar/);
  assert.equal(likes.likeCountSince(), 0);
});

test("apagado no hace ni una petición", async () => {
  let llamadas = 0;
  const impl = (async () => {
    llamadas += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const result = await likes.processLikes({ config: null, fetchImpl: impl });
  assert.equal(result.liked, false);
  assert.match(result.reason, /apagado/);
  assert.equal(llamadas, 0);
});

test("las etiquetas del día se barajan de forma estable", () => {
  const day = new Date("2026-11-08T10:00:00Z");
  const primera = likes.tagsForRun(CONFIG, day, 3).map((entry) => entry.tag);
  const segunda = likes.tagsForRun(CONFIG, day, 3).map((entry) => entry.tag);
  assert.deepEqual(primera, segunda, "el mismo día siempre mira lo mismo");
  assert.equal(primera.length, 3);

  // Con el orden completo se ve que el reparto cambia al día siguiente.
  const todos = { ...CONFIG, locales: ["de", "es", "en"] as const };
  const todas = (fecha: Date) =>
    likes.tagsForRun({ ...todos, locales: [...todos.locales] }, fecha, 99).map((entry) => entry.tag);
  assert.notDeepEqual(todas(day), todas(new Date("2026-11-09T10:00:00Z")));
});

test("el historial se purga y los «me gusta» recientes se pueden leer", () => {
  clearMemory();
  likes.recordLike({ statusId: "1", accountAcct: "a", url: "https://x/1", tag: "Bücher", locale: "de" });
  assert.equal(likes.recentLikes(5).length, 1);
  assert.equal(likes.likedStatusIds().has("1"), true);
  dbModule
    .getDb()
    .prepare("UPDATE social_likes SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-400 days')")
    .run();
  assert.equal(likes.purgeSocialLikes(180), 1);
  assert.equal(likes.likeCountSince(), 0);
});
