/**
 * Fachada del repositorio.
 *
 * La implementación vive en `src/lib/repo/`, separada por dominio. Este
 * archivo conserva la API pública (`@/lib/repo`) para que rutas, componentes y
 * pruebas no cambien de import.
 *
 * Reglas de dependencia:
 *   shared  ←  users  ←  resto de módulos
 *   notifications  ←  requests / comments / reviews / moderation / social / maintenance
 *   comments  ←  social / snapshots
 * Ningún módulo importa este fichero (evita ciclos).
 */
export * from "./repo/account";
export * from "./repo/alerts";
export * from "./repo/catalog";
export * from "./repo/clubs";
export * from "./repo/clubforum";
export * from "./repo/clubpolls";
export * from "./repo/comments";
export * from "./repo/direct";
export * from "./repo/lists";
export * from "./repo/profile";
export * from "./repo/public-works";
export * from "./repo/reading";
export * from "./repo/journey";
export * from "./repo/maintenance";
export * from "./repo/moderation";
export * from "./repo/notifications";
export * from "./repo/requests";
export * from "./repo/reviews";
export * from "./repo/snapshots";
export * from "./repo/social";
export * from "./repo/stats";
export * from "./repo/totp";
export * from "./repo/users";
export * from "./repo/wants";
