/**
 * Separador del pie de página.
 *
 * `aria-hidden` para que un lector de pantalla no lea un punto entre dos
 * enlaces, pero presente en el texto: al copiar el pie o registrarlo, las
 * secciones y los enlaces no quedan pegados («ClubesLectoresListas»).
 */
export function FooterSeparator() {
  return (
    <span className="footer-sep" aria-hidden="true">
      {" · "}
    </span>
  );
}
