import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { AdminReportView, ListingStatus } from "../domain";
import { nowIso } from "./shared";
import { getUserById } from "./users";
import { notify } from "./notifications";

export function reportContent(input: {
  reporterId: string;
  targetType: "listing" | "user" | "message" | "review" | "comment" | "club" | "request";
  targetId: string;
  reason: string;
  details: string;
}): void {
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'",
    )
    .get(input.reporterId, input.targetType, input.targetId);
  if (existing) throw new ApiError(409, "Ya has denunciado este contenido.");
  assertReportableTarget(input.reporterId, input.targetType, input.targetId);
  if (
    (input.targetType === "message" || input.targetType === "request") &&
    input.details.trim().length < 10
  ) {
    throw new ApiError(
      400,
      input.targetType === "message"
        ? "Describe qué ha pasado: los mensajes cifrados no son legibles para la moderación."
        : "Describe qué ha pasado para que la moderación pueda revisar la incidencia.",
    );
  }

  db.prepare(
    "INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
  ).run(
    `rep_${randomUUID()}`,
    input.reporterId,
    input.targetType,
    input.targetId,
    input.reason,
    input.details,
    nowIso(),
  );
}

/** Comprueba que el objetivo denunciado existe y que quien denuncia lo ve. */
function assertReportableTarget(
  reporterId: string,
  targetType: "listing" | "user" | "message" | "review" | "comment" | "club" | "request",
  targetId: string,
): void {
  const db = getDb();
  if (targetType === "request") {
    const request = db
      .prepare(
        "SELECT 1 FROM requests WHERE id = ? AND (requester_id = ? OR owner_id = ?) AND status <> 'pending'",
      )
      .get(targetId, reporterId, reporterId);
    if (!request) throw new ApiError(404, "El intercambio no existe o aún no se ha aceptado.");
    return;
  }
  if (targetType === "club") {
    const club = db
      .prepare("SELECT 1 FROM clubs WHERE id = ? AND status = 'visible' AND owner_id <> ?")
      .get(targetId, reporterId);
    if (!club) throw new ApiError(404, "El club no existe.");
    return;
  }
  if (targetType === "comment") {
    const comment = db
      .prepare("SELECT 1 FROM book_comments WHERE id = ? AND author_id <> ? AND status = 'visible'")
      .get(targetId, reporterId);
    if (!comment) throw new ApiError(404, "El comentario no existe.");
    return;
  }
  if (targetType === "listing") {
    const row = db
      .prepare("SELECT 1 FROM listings WHERE id = ? AND status <> 'removed'")
      .get(targetId);
    if (!row) throw new ApiError(404, "El ejemplar ya no existe.");
    return;
  }
  if (targetType === "user") {
    if (!getUserById(targetId) || targetId === reporterId) {
      throw new ApiError(404, "La persona no existe.");
    }
    return;
  }
  if (targetType === "review") {
    const review = db
      .prepare("SELECT 1 FROM reviews WHERE id = ? AND author_id <> ?")
      .get(targetId, reporterId);
    if (!review) throw new ApiError(404, "La valoración no existe.");
    return;
  }
  // Un mensaje solo se puede denunciar desde dentro de su conversación.
  const message = db
    .prepare(
      `SELECT 1 FROM messages m JOIN requests r ON r.id = m.request_id
       WHERE m.id = ? AND (r.requester_id = ? OR r.owner_id = ?)`,
    )
    .get(targetId, reporterId, reporterId);
  if (!message) throw new ApiError(404, "El mensaje no existe.");
}

/* ------------------------------- moderación ------------------------------- */

export function listReports(
  options: { limit?: number; offset?: number } = {},
): AdminReportView[] {
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.created_at,
              u.id AS reporter_id, u.name AS reporter_name,
              b.title AS listing_title,
              target_user.name AS user_name,
              (SELECT CASE WHEN m.encrypted = 1
                           THEN 'Mensaje cifrado (solo legible por sus participantes)'
                           ELSE substr(m.body, 1, 70) END
                 FROM messages m WHERE m.id = r.target_id) AS message_snippet,
              (SELECT uu.name || ' · ' || rv.rating || '/5'
                 FROM reviews rv JOIN users uu ON uu.id = rv.author_id
                WHERE rv.id = r.target_id) AS review_label,
              (SELECT substr(bc.body, 1, 70) FROM book_comments bc WHERE bc.id = r.target_id) AS comment_snippet,
              (SELECT cl.name || ' · ' || cl.city FROM clubs cl WHERE cl.id = r.target_id) AS club_label,
              (SELECT b2.title || ' · ' || rq.status
                 FROM requests rq
                 JOIN listings l2 ON l2.id = rq.listing_id
                 JOIN books b2 ON b2.id = l2.book_id
                WHERE rq.id = r.target_id) AS request_label
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN listings l ON r.target_type = 'listing' AND l.id = r.target_id
       LEFT JOIN books b ON b.id = l.book_id
       LEFT JOIN users target_user ON r.target_type = 'user' AND target_user.id = r.target_id
       WHERE r.status = 'open'
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as {
    id: string;
    target_type: string;
    target_id: string;
    reason: string;
    details: string;
    created_at: string;
    reporter_id: string;
    reporter_name: string;
    listing_title: string | null;
    user_name: string | null;
    message_snippet: string | null;
    review_label: string | null;
    comment_snippet: string | null;
    club_label: string | null;
    request_label: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    targetType: row.target_type as AdminReportView["targetType"],
    targetId: row.target_id,
    targetLabel:
      row.listing_title ??
      row.user_name ??
      row.message_snippet ??
      row.review_label ??
      row.comment_snippet ??
      row.club_label ??
      row.request_label ??
      row.target_id,
    reason: row.reason,
    details: row.details,
    createdAt: row.created_at,
    reporter: { id: row.reporter_id, name: row.reporter_name },
  }));
}

export function countOpenReports(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM reports WHERE status = 'open'")
    .get() as { count: number };
  return row.count;
}

export type AdminAction =
  | "dismiss"
  | "hide_listing"
  | "suspend_user"
  | "hide_comment"
  | "hide_club";
export type ModerationAction =
  | "hide_listing"
  | "restore_listing"
  | "suspend_user"
  | "unsuspend_user"
  | "hide_comment"
  | "restore_comment"
  | "hide_club"
  | "restore_club";

function applyModeration(
  db: Db,
  action: ModerationAction,
  targetType: string,
  targetId: string,
): void {
  if (action === "hide_club" || action === "restore_club") {
    if (targetType !== "club") throw new ApiError(409, "Esta acción solo vale para clubes.");
    const club = db
      .prepare("SELECT id, owner_id, name, status FROM clubs WHERE id = ?")
      .get(targetId) as
      | { id: string; owner_id: string; name: string; status: string }
      | undefined;
    if (!club) throw new ApiError(404, "El club no existe.");

    if (action === "hide_club") {
      db.prepare("UPDATE clubs SET status = 'hidden' WHERE id = ?").run(targetId);
      notify({
        userId: club.owner_id,
        type: "moderation",
        title: "Un club tuyo se ha ocultado",
        body: "Lo ha retirado el equipo de moderación tras una revisión.",
        link: `/clubes/${club.id}`,
      });
    } else {
      if (club.status !== "hidden") {
        throw new ApiError(409, "Ese club no está oculto.");
      }
      db.prepare("UPDATE clubs SET status = 'visible' WHERE id = ?").run(targetId);
      notify({
        userId: club.owner_id,
        type: "moderation",
        title: "Tu club vuelve a estar visible",
        body: "Se ha restablecido tras la revisión.",
        link: `/clubes/${club.id}`,
      });
    }
    return;
  }

  if (action === "hide_comment" || action === "restore_comment") {
    if (targetType !== "comment") {
      throw new ApiError(409, "Esta acción solo vale para comentarios.");
    }
    const comment = db
      .prepare("SELECT id, author_id, book_id, status FROM book_comments WHERE id = ?")
      .get(targetId) as
      | { id: string; author_id: string; book_id: string; status: string }
      | undefined;
    if (!comment) throw new ApiError(404, "El comentario no existe.");

    if (action === "hide_comment") {
      db.prepare("UPDATE book_comments SET status = 'hidden' WHERE id = ?").run(targetId);
      notify({
        userId: comment.author_id,
        type: "moderation",
        title: "Un comentario tuyo se ha ocultado",
        body: "Lo ha retirado el equipo de moderación tras una revisión.",
        bookId: comment.book_id,
      });
    } else {
      if (comment.status !== "hidden") {
        throw new ApiError(409, "Ese comentario no está oculto.");
      }
      db.prepare("UPDATE book_comments SET status = 'visible' WHERE id = ?").run(targetId);
      notify({
        userId: comment.author_id,
        type: "moderation",
        title: "Tu comentario vuelve a estar visible",
        body: "Se ha restablecido tras la revisión.",
        bookId: comment.book_id,
      });
    }
    return;
  }

  if (action === "hide_listing" || action === "restore_listing") {
    if (targetType !== "listing") throw new ApiError(409, "Esta acción solo vale para ejemplares.");
    const listing = db
      .prepare(
        `SELECT l.id, l.owner_id, b.title, l.status, l.moderated_from
         FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = ?`,
      )
      .get(targetId) as
      | {
          id: string;
          owner_id: string;
          title: string;
          status: ListingStatus;
          moderated_from: string | null;
        }
      | undefined;
    if (!listing) throw new ApiError(404, "El ejemplar no existe.");

    if (action === "hide_listing") {
      // Se conserva el estado previo (available/paused/reserved/given) para
      // poder restaurarlo tal cual y no republicar algo que estaba entregado.
      db.prepare(
        `UPDATE listings
            SET moderated_from = CASE WHEN status = 'removed' THEN moderated_from ELSE status END,
                status = 'removed'
          WHERE id = ?`,
      ).run(targetId);

      const affected = db
        .prepare(
          "SELECT id, requester_id, status FROM requests WHERE listing_id = ? AND status IN ('pending','accepted')",
        )
        .all(targetId) as { id: string; requester_id: string; status: string }[];
      db.prepare(
        "UPDATE requests SET status = 'expired', updated_at = ? WHERE listing_id = ? AND status = 'pending'",
      ).run(nowIso(), targetId);
      db.prepare(
        "UPDATE requests SET status = 'cancelled', updated_at = ? WHERE listing_id = ? AND status = 'accepted'",
      ).run(nowIso(), targetId);
      for (const request of affected) {
        notify({
          userId: request.requester_id,
          type: "moderation",
          title:
            request.status === "accepted"
              ? "Intercambio cancelado por moderación"
              : "Solicitud cerrada por moderación",
          body: `El ejemplar «${listing.title}» se ha retirado mientras se revisa.`,
          listingId: targetId,
          requestId: request.id,
        });
      }
      notify({
        userId: listing.owner_id,
        type: "moderation",
        title: "Tu ejemplar se ha retirado temporalmente",
        body: `«${listing.title}» queda oculto mientras el equipo revisa una denuncia.`,
        listingId: targetId,
      });
    } else {
      if (listing.status !== "removed") {
        throw new ApiError(409, "Ese ejemplar no está retirado.");
      }
      const previous = listing.moderated_from;
      const restored: ListingStatus =
        previous === "paused" || previous === "reserved" || previous === "given"
          ? previous
          : "available";
      db.prepare("UPDATE listings SET status = ?, moderated_from = NULL WHERE id = ?").run(
        restored,
        targetId,
      );
      notify({
        userId: listing.owner_id,
        type: "moderation",
        title: "Tu ejemplar vuelve a estar publicado",
        body: `«${listing.title}» se ha restablecido tras la revisión.`,
        listingId: targetId,
      });
    }
    return;
  }

  if (targetType !== "user") throw new ApiError(409, "Esta acción solo vale para cuentas.");
  const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(targetId) as
    | { id: string; name: string; email: string }
    | undefined;
  if (!user) throw new ApiError(404, "La cuenta no existe.");
  // Las cuentas eliminadas por su dueño no se pueden reactivar.
  if (user.email.startsWith("deleted-")) {
    throw new ApiError(409, "Esa cuenta se eliminó a petición de su titular.");
  }

  if (action === "suspend_user") {
    // El estado de los ejemplares no se toca: el catálogo ya oculta los de una
    // cuenta suspendida, así que la sanción es reversible.
    db.prepare("UPDATE users SET is_suspended = 1 WHERE id = ?").run(targetId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
  } else {
    db.prepare("UPDATE users SET is_suspended = 0 WHERE id = ?").run(targetId);
    notify({
      userId: targetId,
      type: "moderation",
      title: "Tu cuenta vuelve a estar activa",
      body: "Puedes volver a entrar y publicar ejemplares.",
    });
  }
}

export function writeAudit(
  db: Db,
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: string,
): void {
  db.prepare(
    "INSERT INTO admin_audit (id, admin_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(`aud_${randomUUID()}`, adminId, action, targetType, targetId, details, nowIso());
}

/** Acción directa de moderación, sin depender de una denuncia abierta. */
export function moderateTarget(
  adminId: string,
  input: {
    action: ModerationAction;
    targetType: "listing" | "user" | "comment" | "club";
    targetId: string;
  },
): void {
  const db = getDb();
  db.transaction(() => {
    applyModeration(db, input.action, input.targetType, input.targetId);
    writeAudit(db, adminId, input.action, input.targetType, input.targetId, "acción directa");
  })();
}

export function resolveReport(adminId: string, reportId: string, action: AdminAction): void {
  const db = getDb();
  const report = db
    .prepare("SELECT id, target_type, target_id, status FROM reports WHERE id = ?")
    .get(reportId) as
    | { id: string; target_type: string; target_id: string; status: string }
    | undefined;

  if (!report) throw new ApiError(404, "La denuncia no existe.");

  db.transaction(() => {
    // Se toma la denuncia de forma atómica: si otra persona la resolvió entre
    // la lectura y la escritura, esta acción no se aplica dos veces.
    const claimed = db
      .prepare("UPDATE reports SET status = ? WHERE id = ? AND status = 'open'")
      .run(action === "dismiss" ? "dismissed" : "reviewed", reportId);
    if (claimed.changes !== 1) throw new ApiError(409, "La denuncia ya está resuelta.");

    if (action !== "dismiss") {
      applyModeration(db, action, report.target_type, report.target_id);
    }

    writeAudit(
      db,
      adminId,
      action,
      report.target_type,
      report.target_id,
      `denuncia ${reportId}`,
    );
  })();
}

export type SuspendedUserView = {
  id: string;
  name: string;
  email: string;
  city: string;
  suspendedAt: string | null;
};

/** Cuentas suspendidas por moderación (excluye las eliminadas por su dueño). */
export function listSuspendedUsers(limit = 50): SuspendedUserView[] {
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.name, u.email, u.city,
              (SELECT a.created_at FROM admin_audit a
                WHERE a.action = 'suspend_user' AND a.target_id = u.id
                ORDER BY a.created_at DESC LIMIT 1) AS suspended_at
       FROM users u
       WHERE u.is_suspended = 1 AND u.email NOT LIKE 'deleted-%'
       ORDER BY suspended_at DESC, u.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    name: string;
    email: string;
    city: string;
    suspended_at: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
    suspendedAt: row.suspended_at,
  }));
}

export type HiddenCommentView = {
  id: string;
  body: string;
  createdAt: string;
  bookId: string;
  bookTitle: string;
  authorName: string;
};

/** Comentarios ocultos por moderación: la acción se puede deshacer. */
export function listHiddenComments(limit = 20): HiddenCommentView[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.book_id, b.title AS book_title, u.name AS author_name
       FROM book_comments c
       JOIN books b ON b.id = c.book_id
       JOIN users u ON u.id = c.author_id
       WHERE c.status = 'hidden'
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    body: string;
    created_at: string;
    book_id: string;
    book_title: string;
    author_name: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    bookId: row.book_id,
    bookTitle: row.book_title,
    authorName: row.author_name,
  }));
}

export type AuditView = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
  adminName: string;
};

export function listAudit(limit = 20): AuditView[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at,
              u.name AS admin_name
       FROM admin_audit a JOIN users u ON u.id = a.admin_id
       ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    action: string;
    target_type: string;
    target_id: string;
    details: string;
    created_at: string;
    admin_name: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details,
    createdAt: row.created_at,
    adminName: row.admin_name,
  }));
}
