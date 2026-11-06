import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(import.meta.dirname, "..", "src");
const DICTIONARY = path.join(import.meta.dirname, "..", "src", "lib", "i18n.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !full.endsWith("i18n.ts") ? [full] : [];
  });
}

/** Claves del diccionario alemán: `"texto": "…"` o `identificador: "…"`. */
function dictionaryKeys(source: string): Set<string> {
  return dictionaryKeysOf(source, "DE");
}

/** Claves de un diccionario concreto (`DE`, `EN`) de i18n.ts. */
function dictionaryKeysOf(source: string, name: string): Set<string> {
  const start = source.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `no se encuentra el diccionario ${name} en i18n.ts`);
  const end = source.indexOf("\n} satisfies Dictionary;", start);
  assert.ok(end > start, `no se cierra el diccionario ${name}`);
  const block = source.slice(start, end);
  const keys = new Set<string>();
  for (const line of block.split("\n")) {
    const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:\s*"/.exec(line);
    if (!match) continue;
    keys.add(match[1] ?? match[2]!);
  }
  return keys;
}

/** Literales usados con `t("…")` o `translate(locale, "…")`. */
function usedKeys(files: string[]): Map<string, string> {
  const used = new Map<string, string>();
  const patterns = [/\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g, /\btranslate\(\s*\w+\s*,\s*"((?:[^"\\\n]|\\.)*)"/g];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        // Las claves del diccionario no se traducen a sí mismas.
        used.set(match[1]!, path.relative(ROOT, file));
      }
    }
  }
  return used;
}

test("toda cadena usada con t() o translate() tiene traducción alemana", () => {
  const files = walk(ROOT);
  const keys = dictionaryKeys(readFileSync(DICTIONARY, "utf8"));
  const used = usedKeys(files);

  const missing = [...used.entries()].filter(([key]) => !keys.has(key));
  assert.deepEqual(
    missing.map(([key, file]) => `${key} (${file})`),
    [],
    `faltan ${missing.length} traducciones en el diccionario DE`,
  );
});

test("el diccionario inglés cubre exactamente las mismas claves que el alemán", () => {
  // Si una clave faltara en inglés, `translate("en", …)` devolvería el
  // castellano sin avisar: media interfaz en español y nadie se enteraría.
  const source = readFileSync(DICTIONARY, "utf8");
  const de = dictionaryKeysOf(source, "DE");
  const en = dictionaryKeysOf(source, "EN");

  const missing = [...de].filter((key) => !en.has(key));
  const extra = [...en].filter((key) => !de.has(key));
  assert.deepEqual(
    missing.slice(0, 20),
    [],
    `faltan ${missing.length} traducciones en inglés`,
  );
  assert.deepEqual(
    extra.slice(0, 20),
    [],
    `sobran ${extra.length} claves en inglés`,
  );
});

test("el inglés traduce y cae al castellano cuando falta una clave", async () => {
  const { translate } = await import("../src/lib/i18n.ts");
  assert.equal(translate("en", "Descubrir"), "Discover");
  assert.equal(
    translate("en", "Un texto que no está en el diccionario"),
    "Un texto que no está en el diccionario",
  );
});

test("el idioma de la interfaz acepta inglés y su variante regional", async () => {
  const { normalizeLocale, DEFAULT_LOCALE } = await import(
    "../src/lib/locale.ts"
  );
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("en-GB"), "en");
  assert.equal(normalizeLocale(" ES-es "), "es");
  assert.equal(normalizeLocale("fr"), DEFAULT_LOCALE);
  assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE);
});

test("sin cookie manda el idioma del navegador", async () => {
  // Es lo que decide el idioma de una primera visita, el de la cuenta que se
  // crea en ella y, por tanto, el de los correos. Antes caía siempre al alemán.
  const { matchLocale, DEFAULT_LOCALE } = await import("../src/lib/locale.ts");
  assert.equal(matchLocale("es-ES,es;q=0.9,en;q=0.8"), "es");
  assert.equal(matchLocale("en-US,en;q=0.9"), "en");
  assert.equal(matchLocale("de-DE,de;q=0.9,en-US;q=0.8"), "de");
  // Lo que no hablamos se salta y se sigue con la preferencia siguiente.
  assert.equal(matchLocale("fr-FR,fr;q=0.9,en;q=0.5"), "en");
  // `q=0` significa «este no».
  assert.equal(matchLocale("es-ES;q=0,en;q=0.9"), "en");
  // Sin nada reconocible, ni idioma ni invención: quien llama decide el base.
  assert.equal(matchLocale("fr-FR,it;q=0.8"), null);
  assert.equal(matchLocale("*"), DEFAULT_LOCALE);
  assert.equal(matchLocale(""), null);
  assert.equal(matchLocale(null), null);
});

test("los documentos largos también existen en inglés", async () => {
  // Avisos, privacidad, aviso legal y documentación técnica se componen por
  // idioma; si alguno se quedara en dos, el inglés vería texto alemán.
  const { localizeNotification } = await import(
    "../src/lib/notification-locale.ts"
  );
  assert.deepEqual(localizeNotification("en", "Nueva solicitud de intercambio", ""), {
    title: "New swap request",
    body: "",
  });

  const { legalConfig, privacyDocument, imprintDocument } = await import(
    "../src/lib/legal.ts"
  );
  const config = legalConfig({});
  assert.equal(privacyDocument("en", config).title, "Privacy policy");
  assert.equal(imprintDocument("en", config).title, "Legal notice");

  const { technicalDocument } = await import("../src/lib/technical.ts");
  assert.equal(technicalDocument("en").title, "Technical documentation");
  assert.equal(
    technicalDocument("en").sections.length,
    technicalDocument("es").sections.length,
  );
});

test("los mapas *_COPY se traducen aunque la llamada sea dinámica", () => {
  const keys = dictionaryKeys(readFileSync(DICTIONARY, "utf8"));
  const missing: string[] = [];
  for (const file of walk(ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const block of source.matchAll(/const\s+\w*_COPY\b[^=]*=\s*\{([\s\S]*?)\};/g)) {
      for (const entry of block[1]!.matchAll(/^\s*\w+\s*:\s*"((?:[^"\\]|\\.)*)"/gm)) {
        if (!keys.has(entry[1]!)) {
          missing.push(`${entry[1]} (${path.relative(ROOT, file)})`);
        }
      }
    }
  }
  assert.deepEqual(missing, [], `faltan ${missing.length} textos de mapas *_COPY`);
});

test("el diccionario no guarda traducciones que ya no usa nadie", () => {
  // Sin esta comprobación las traducciones se acumulan: al retirar el escáner
  // de ISBN quedaron seis claves huérfanas que solo se vieron a mano.
  //
  // No basta con buscar `t("…")`: muchas cadenas llegan a `t()` desde una
  // constante (categorías, etiquetas, idiomas, ciudades). Por eso se comprueba
  // si el texto aparece como literal en algún sitio del código.
  const keys = dictionaryKeys(readFileSync(DICTIONARY, "utf8"));
  const sources = walk(ROOT).map((file) => readFileSync(file, "utf8"));
  const dead = [...keys].filter(
    (key) => !sources.some((source) => source.includes(`"${key}"`) || source.includes(`'${key}'`)),
  );
  assert.deepEqual(
    dead.slice(0, 20),
    [],
    `hay ${dead.length} traducciones que ningún texto del código usa; bórralas de i18n.ts`,
  );
});

test("el diccionario no tiene textos vacíos ni duplicados", () => {
  const source = readFileSync(DICTIONARY, "utf8");
  const start = source.indexOf("const DE");
  // El diccionario cierra con `} satisfies Dictionary;`: se busca ese cierre
  // real (y no un `};` cualquiera) para no analizar el resto del archivo.
  const close = /\n\}(?: satisfies [\w<>, ]+)?;/.exec(source.slice(start));
  assert.ok(close, "no se encontró el cierre del diccionario DE");
  const block = source.slice(start, start + close!.index);
  const seen = new Set<string>();
  for (const line of block.split("\n")) {
    const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? match[2]!;
    assert.ok(!seen.has(key), `clave duplicada en DE: ${key}`);
    seen.add(key);
    assert.match(match[3]!.trim(), /^".+",?$/, `traducción vacía o inválida para «${key}»`);
  }
  assert.ok(seen.size > 900, `el diccionario parece incompleto (${seen.size} claves)`);
});

test("los identificadores de mensaje no chocan dentro del diccionario", async () => {
  // El cliente recibe las traducciones indexadas por `messageId`: si dos textos
  // compartieran identificador, uno de los dos mostraría la traducción del otro
  // y nadie se enteraría. Con 1 257 entradas y 32 bits, un choque es posible
  // (probabilidad ~0,02 % por par): esta prueba es la que lo detecta.
  const { messageId } = await import("../src/lib/message-id.ts");
  const { DE } = await import("../src/lib/i18n.ts");
  const byId = new Map<number, string>();
  const collisions: string[] = [];
  for (const text of Object.keys(DE)) {
    const id = messageId(text);
    const previous = byId.get(id);
    if (previous !== undefined) collisions.push(`${previous} ↔ ${text}`);
    byId.set(id, text);
  }
  assert.deepEqual(collisions, [], `hay ${collisions.length} identificadores repetidos`);
});

test("el diccionario por identificador devuelve las mismas traducciones", async () => {
  const { messageId, messagesById } = await import("../src/lib/message-id.ts");
  const { DE } = await import("../src/lib/i18n.ts");
  const byId = messagesById(DE);
  const wrong: string[] = [];
  for (const [text, value] of Object.entries(DE)) {
    if (byId[messageId(text)] !== value) wrong.push(text);
  }
  assert.deepEqual(wrong, [], `hay ${wrong.length} traducciones mal indexadas`);
  assert.equal(Object.keys(byId).length, Object.keys(DE).length);
});
