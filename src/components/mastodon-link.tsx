import { MASTODON } from "@/lib/brand";

/**
 * Enlace a la cuenta del fediverso, para el pie de página.
 *
 * La verificación de Mastodon la resuelve el `<link rel="me">` del encabezado
 * (`src/app/layout.tsx`), que es invisible porque Mastodon lee el HTML servido
 * y no necesita nada en pantalla. Este es el mismo enlace, pero a la vista y
 * pulsable: `rel="me"` de más no estorba a la comprobación y deja claro en el
 * HTML qué cuenta es la de la casa.
 *
 * Vive en su propio componente porque hay dos pies (el del catálogo y el del
 * resto de páginas) y no deben acabar apuntando a cuentas distintas.
 */
export function MastodonLink() {
  return (
    <a href={MASTODON} rel="me noopener" target="_blank">
      Mastodon
    </a>
  );
}
