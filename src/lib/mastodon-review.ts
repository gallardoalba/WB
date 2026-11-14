/**
 * Revisión de los avisos ya publicados en el perfil de Mastodon.
 *
 * El bot escribe ahora siempre en alemán, pero los avisos publicados antes del
 * cambio conservan el idioma del ejemplar (castellano o inglés) y sus etiquetas
 * antiguas. Mastodon permite editar una publicación, así que esta revisión solo
 * señala cuáles hay que retraducir a mano y enlaza cada una: aquí no se toca
 * nada ni se habla con la instancia.
 *
 * La detección es deliberadamente conservadora. Un aviso cuenta como «de otro
 * idioma» solo si lleva el prefijo `/es` o `/en` en el enlace de la obra o si
 * usa las etiquetas castellanas o inglesas que el bot ponía entonces. Así, un
 * libro con título en castellano dentro de un aviso alemán no se marca por
 * error: el título se conserva siempre en su idioma original.
 */

/** Un aviso ya enviado, tal y como quedó guardado en `social_outbox`. */
export type PublishedPost = {
  /** Id de la fila en `social_outbox`. */
  id: string;
  /** Id de la obra (`subject`). */
  bookId: string;
  title: string | null;
  author: string | null;
  body: string;
  /** Enlace del estado publicado, para abrirlo y editarlo en Mastodon. */
  url: string | null;
  sentAt: string | null;
};

export type ReviewedPost = PublishedPost & {
  /** `true` si el texto se publicó en castellano o en inglés. */
  needsTranslation: boolean;
  /** Qué delató el idioma, para poder explicarlo en el listado. */
  reasons: string[];
};

const MARKERS: readonly (readonly [RegExp, string])[] = [
  [/\/es\/werk\//, "enlace con prefijo /es"],
  [/\/en\/werk\//, "enlace con prefijo /en"],
  [
    /#(?:Libros|Libro|Lectura|Biblioteca|Literatura|IntercambioDeLibros)\b/,
    "etiquetas castellanas",
  ],
  [/#(?:Books|Book|BookSwap|Reading|Library|Literature|Bookstodon)\b/, "etiquetas inglesas"],
];

/** Marca qué avisos publicados siguen en otro idioma. No modifica nada. */
export function reviewPublished(posts: readonly PublishedPost[]): ReviewedPost[] {
  return posts.map((post) => {
    const reasons = MARKERS.filter(([pattern]) => pattern.test(post.body)).map(([, text]) => text);
    return { ...post, needsTranslation: reasons.length > 0, reasons };
  });
}
