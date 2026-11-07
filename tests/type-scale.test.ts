import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * El tamaño de letra se decide en decenas de reglas repartidas por `styles/`,
 * así que una auditoría de vez en cuando no basta: estos límites fijan lo que
 * ya se corrigió para que nadie lo deshaga sin darse cuenta.
 *
 * - 10 px: por debajo solo quedan las iniciales de avatar y el contador de la
 *   campana, que son marcas y no texto que haya que leer.
 * - 16 px en los campos: es el mínimo de Safari en iOS; por debajo, la página
 *   se amplía al enfocar un campo y no vuelve.
 * - 16 px en la prosa: 14 era el tamaño de la interfaz densa y las páginas de
 *   lectura (privacidad, aviso legal, proyecto, documentación) se leen seguidas.
 */
const STYLES = path.join(import.meta.dirname, "..", "src", "app", "styles");
const CONTROL = /\b(input|select|textarea)\b/;
/**
 * Única excepción al mínimo de los campos: el selector de idioma de la cabecera.
 * Es un control de utilidad de dos letras; a 16 px pesaba más que el buscador y
 * lo pidió así quien lo usa. El selector nativo de iOS abre su propia lista, así
 * que el zoom al enfocar apenas se nota.
 */
const CONTROL_EXEMPT = [".locale-select"];

type Rule = { file: string; selector: string; size: string; px: number };

function rules(): Rule[] {
  const out: Rule[] = [];
  for (const file of readdirSync(STYLES).filter((name) => name.endsWith(".css"))) {
    const source = readFileSync(path.join(STYLES, file), "utf8");
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim()
        .split("\n")
        .pop()!
        .trim();
      const size = /font-size:\s*([^;]+);/.exec(match[2])?.[1]?.trim();
      if (!size || !size.endsWith("px")) continue;
      out.push({ file, selector, size, px: Number.parseFloat(size) });
    }
  }
  return out;
}

test("ningún texto baja de 10 px", () => {
  const small = rules().filter((rule) => rule.px < 10);
  assert.deepEqual(
    small.map((rule) => `${rule.size} en ${rule.file} · ${rule.selector}`),
    [],
  );
});

test("los campos de texto no bajan de 16 px (zoom de iOS)", () => {
  const small = rules().filter(
    (rule) =>
      CONTROL.test(rule.selector) &&
      !CONTROL_EXEMPT.includes(rule.selector) &&
      rule.px < 16,
  );
  assert.deepEqual(
    small.map((rule) => `${rule.size} en ${rule.file} · ${rule.selector}`),
    [],
  );
});

test("la prosa y la escala base se leen a 16 px", () => {
  const tokens = readFileSync(path.join(STYLES, "tokens.css"), "utf8");
  assert.match(tokens, /--text-base:\s*16px;/, "--text-base debe ser 16 px");
  assert.match(tokens, /--text-md:\s*16px;/, "--text-md debe ser 16 px");
  // La regla base que cubre los campos que no declaran tamaño propio.
  assert.match(
    tokens,
    /input,\s*\n\s*select,\s*\n\s*textarea\s*\{[^}]*font-size:\s*var\(--text-md\);/,
    "los campos deben heredar 16 px por defecto",
  );
});
