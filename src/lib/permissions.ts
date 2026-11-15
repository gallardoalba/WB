import type { SessionUser } from "./domain";

/**
 * Quién puede moderar y quién puede sancionar.
 *
 * La separación es deliberada: moderar es revisar denuncias y ocultar
 * contenido, y esa tarea no debe llevar aparejada la capacidad de suspender
 * cuentas. Solo la administración sanciona y nombra al equipo.
 */
export function canModerate(user: Pick<SessionUser, "isAdmin" | "isModerator">): boolean {
  return user.isAdmin || user.isModerator;
}

export function canSanction(user: Pick<SessionUser, "isAdmin">): boolean {
  return user.isAdmin;
}
