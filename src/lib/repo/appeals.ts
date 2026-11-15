import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import { sendAppealResolvedEmail } from "../account-tokens";
import { nowIso } from "./shared";
import { liftSuspension } from "./users";
import { notify } from "./notifications";
import { writeAudit } from "./moderation";

export type AppealStatus = "open" | "upheld" | "rejected";

export type AppealView = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  sanctionReason: string;
  sanctionAt: string | null;
  message: string;
  status: AppealStatus;
  resolution: string;
  createdAt: string;
  resolvedAt: string | null;
  reviewerName: string | null;
  /** Falso si quien mira fue quien impuso la sanción: no puede revisarla. */
  canReview: boolean;
};

/**
 * Apelación de una suspensión vigente.
 *
 * La persona suspendida no puede iniciar sesión; llega aquí con el token que
 * viajó en el correo de la sanción. Se guarda una copia del motivo y de la
 * fecha de la sanción para que la apelación siga teniendo sentido aunque la
 * auditoría se pode con los años.
 */
export function createAppeal(userId: string, message: string): string {
  const db = getDb();
  const user = db
    .prepare(
      `SELECT is_suspended, suspension_reason FROM users
        WHERE id = ? AND email NOT LIKE 'deleted-%'`,
    )
    .get(userId) as { is_suspended: number; suspension_reason: string | null } | undefined;
  if (!user || !user.is_suspended) {
    throw new ApiError(409, "No hay una sanción activa que apelar.");
  }

  const audit = db
    .prepare(
      `SELECT id, admin_id, details, created_at FROM admin_audit
        WHERE action = 'suspend_user' AND target_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(userId) as
    | { id: string; admin_id: string; details: string; created_at: string }
    | undefined;
  if (!audit) throw new ApiError(409, "No se encontró la sanción que quieres apelar.");

  const already = db
    .prepare("SELECT 1 FROM appeals WHERE audit_id = ? AND status = 'open'")
    .get(audit.id);
  if (already) throw new ApiError(409, "Ya hay una apelación abierta para esta sanción.");

  const id = `apl_${randomUUID()}`;
  db.prepare(
    `INSERT INTO appeals
       (id, user_id, audit_id, sanctioner_id, sanction_reason, sanction_at,
        message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(
    id,
    userId,
    audit.id,
    audit.admin_id,
    user.suspension_reason ?? audit.details,
    audit.created_at,
    message.trim(),
    nowIso(),
  );
  return id;
}

function toAppealView(
  row: {
    id: string;
    user_id: string;
    user_name: string;
    user_email: string;
    sanctioner_id: string | null;
    sanction_reason: string;
    sanction_at: string | null;
    message: string;
    status: AppealStatus;
    resolution: string;
    created_at: string;
    resolved_at: string | null;
    reviewer_name: string | null;
  },
  viewerId: string,
): AppealView {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    sanctionReason: row.sanction_reason,
    sanctionAt: row.sanction_at,
    message: row.message,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    reviewerName: row.reviewer_name,
    canReview: row.sanctioner_id !== viewerId,
  };
}

const SELECT_APPEALS = `
  SELECT a.id, a.user_id, u.name AS user_name, u.email AS user_email,
         a.sanctioner_id, a.sanction_reason, a.sanction_at, a.message,
         a.status, a.resolution, a.created_at, a.resolved_at,
         r.name AS reviewer_name
    FROM appeals a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN users r ON r.id = a.reviewer_id`;

/** Apelaciones abiertas, para el equipo. */
export function listOpenAppeals(viewerId: string, limit = 25, offset = 0): AppealView[] {
  const rows = getDb()
    .prepare(`${SELECT_APPEALS} WHERE a.status = 'open' ORDER BY a.created_at ASC LIMIT ? OFFSET ?`)
    .all(limit, offset) as Parameters<typeof toAppealView>[0][];
  return rows.map((row) => toAppealView(row, viewerId));
}

export function countOpenAppeals(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM appeals WHERE status = 'open'")
    .get() as { count: number };
  return row.count;
}

/** Apelaciones de una persona, para consultar el historial en pruebas o cuenta. */
export function listUserAppeals(userId: string): AppealView[] {
  const rows = getDb()
    .prepare(`${SELECT_APPEALS} WHERE a.user_id = ? ORDER BY a.created_at DESC`)
    .all(userId) as Parameters<typeof toAppealView>[0][];
  return rows.map((row) => toAppealView(row, userId));
}

/**
 * Revisa una apelación. Quien impuso la sanción no puede revisarla: la
 * independencia es el punto del mecanismo, no un detalle.
 */
export function resolveAppeal(
  reviewerId: string,
  appealId: string,
  outcome: "upheld" | "rejected",
  resolution: string,
): void {
  const db = getDb();
  const appeal = db
    .prepare(
      `SELECT id, user_id, sanctioner_id, status FROM appeals WHERE id = ?`,
    )
    .get(appealId) as
    | { id: string; user_id: string; sanctioner_id: string | null; status: AppealStatus }
    | undefined;
  if (!appeal) throw new ApiError(404, "La apelación no existe.");
  if (appeal.status !== "open") throw new ApiError(409, "La apelación ya está resuelta.");
  if (appeal.sanctioner_id === reviewerId) {
    throw new ApiError(403, "La apelación debe revisarla otra persona del equipo.");
  }

  db.transaction(() => {
    const claimed = db
      .prepare(
        `UPDATE appeals
            SET status = ?, reviewer_id = ?, resolution = ?, resolved_at = ?
          WHERE id = ? AND status = 'open'`,
      )
      .run(outcome, reviewerId, resolution.trim(), nowIso(), appealId);
    if (claimed.changes !== 1) throw new ApiError(409, "La apelación ya está resuelta.");

    if (outcome === "upheld") {
      liftSuspension(appeal.user_id);
      notify({
        userId: appeal.user_id,
        type: "moderation",
        title: "Tu cuenta vuelve a estar activa",
        body: "Tu apelación se ha estimado y la suspensión se ha levantado.",
      });
    }

    writeAudit(
      db,
      reviewerId,
      `appeal_${outcome}`,
      "user",
      appeal.user_id,
      `apelación ${appealId} · ${resolution.trim().slice(0, 200)}`,
    );
  })();

  const row = getDb()
    .prepare("SELECT email, is_suspended FROM users WHERE id = ?")
    .get(appeal.user_id) as { email: string; is_suspended: number } | undefined;
  if (row?.email && !row.email.startsWith("deleted-")) {
    try {
      sendAppealResolvedEmail(
        appeal.user_id,
        row.email,
        outcome === "upheld",
        Boolean(row.is_suspended),
        resolution.trim(),
      );
    } catch (error) {
      // La decisión ya está tomada y auditada; un fallo al encolar el correo no
      // debe devolver un error que haga pensar que no se guardó.
      console.error("[appeals] no se pudo encolar la respuesta", error);
    }
  }
}
