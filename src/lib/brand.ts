/** Nombre y partes de la marca, en un único sitio. */
export const BRAND = "Wanderbibliothek";
export const BRAND_FIRST = "Wander";
export const BRAND_SECOND = "bibliothek";

/**
 * Repositorio del código. Vive aquí y no en los textos de la documentación
 * porque lo enlazan también componentes de cliente, y el módulo de la
 * documentación arrastra párrafos enteros al paquete del navegador.
 */
export const REPOSITORY = "https://github.com/gallardoalba/wanderbibliothek";

/**
 * Cuenta del fediverso. Mastodon solo marca el enlace como verificado si la web
 * devuelve un `rel="me"` hacia ella (ver `src/app/layout.tsx`), y para eso el
 * dominio del perfil tiene que ser exactamente este.
 */
export const MASTODON = "https://mastodon.social/@wanderbibliothek";
