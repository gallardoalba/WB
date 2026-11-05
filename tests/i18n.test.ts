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
  const start = source.indexOf("const DE");
  assert.ok(start >= 0, "no se encuentra el diccionario DE en i18n.ts");
  const end = source.indexOf("\n};", start);
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
