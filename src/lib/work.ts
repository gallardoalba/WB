import { createHash } from "node:crypto";
import { normalizeText } from "./text";

/**
 * Agrupar ediciones del mismo libro.
 *
 * Cada ISBN es una edición distinta, pero para quien busca el libro todas son
 * «el mismo libro»: la conversación y los ejemplares deben estar juntos. Se usa
 * una clave de obra:
 *
 * - `ol:<workId>` cuando Open Library conoce la obra: agrupa incluso las
 *   traducciones, que cambian el título.
 * - `t:<hash>` en el resto de los casos, a partir del título y del apellido de
 *   la autoría. Es lo que permite agrupar dos ediciones españolas de un libro
 *   sin que ningún catálogo las relacione.
 *
 * La clave se calcula siempre igual (mismo título, misma autoría → misma
 * clave), así que dos publicaciones del mismo libro coinciden sin necesidad de
 * comparar filas.
 */

/** Palabras que no identifican una obra: artículos y conjunciones. */
const IGNORED = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "der", "die", "das"]);

/**
 * Título sin subtítulo: la misma obra se publica con y sin él («El infinito en
 * un junco» / «El infinito en un junco: La invención de los libros…»), y las
 * dos tienen que caer en la misma obra.
 */
function mainTitle(title: string): string {
  return title.split(/[:—]/)[0] ?? title;
}

function titleKey(title: string): string {
  const words = normalizeText(mainTitle(title))
    .split(" ")
    .filter((word) => word && !IGNORED.has(word));
  return words.join(" ");
}

/**
 * Apellido de la autoría. Los catálogos alternan «Umberto Eco» y «Eco,
 * Umberto», y las dos formas tienen que dar la misma clave.
 */
function authorKey(author: string): string {
  const comma = author.indexOf(",");
  if (comma > 0) {
    return normalizeText(author.slice(0, comma)).split(" ").filter(Boolean).join(" ");
  }
  const words = normalizeText(author).split(" ").filter(Boolean);
  return words.length > 0 ? words[words.length - 1]! : "";
}

/** Clave derivada del título y la autoría, para cuando no hay obra externa. */
export function workKeyFromTitle(title: string, author: string): string {
  const payload = `${titleKey(title)}|${authorKey(author)}`;
  const digest = createHash("sha1").update(payload).digest("hex").slice(0, 16);
  return `t:${digest}`;
}

/** Clave a partir del identificador de obra de Open Library. */
export function workKeyFromOpenLibrary(workId: string): string {
  const id = workId.replace(/^\/works\//, "").trim();
  return `ol:${id}`;
}

/** ¿La clave viene de Open Library (agrupa traducciones)? */
export function isOpenLibraryWorkKey(key: string): boolean {
  return key.startsWith("ol:");
}
