import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { ClubRequestView, ClubView, CommunityMetrics } from "../domain";
import { notify } from "./notifications";
import { blockPair, isBlocked, nowIso, userCity } from "./shared";

/* -------------------------------- clubes ---------------------------------- */

type ClubRow = {
  id: string;
  name: string;
  city: string;
  description: string;
  meets_on: string;
  meets_at: string;
  created_at: string;
  owner_id: string;
  owner_name: string;
  book_id: string | null;
  book_title: string | null;
  book_author: string | null;
  join_policy: string;
  progress: number;
  progress_note: string;
  members: number;
  is_member: number;
  my_pending: number;
  pending_requests: number;
  attendees: number;
  attending: number;
  last_activity: string | null;
  member_names: string | null;
};

/**
 * La clave del encuentro es la fecha concreta si existe y, si no, la etiqueta
 * recurrente: así la asistencia se guarda contra el encuentro que se muestra y
 * no se mezcla al cambiar de fecha.
 */
const MEETS_KEY = "COALESCE(NULLIF(c.meets_at, ''), c.meets_on)";

const CLUB_SELECT = `
  SELECT c.id, c.name, c.city, c.description, c.meets_on, c.meets_at, c.created_at,
         c.owner_id, uo.name AS owner_name,
         c.book_id, b.title AS book_title, b.author AS book_author,
         c.join_policy, c.progress, c.progress_note,
         (SELECT COUNT(*) FROM club_members m
            LEFT JOIN users mu ON mu.id = m.user_id
           WHERE m.club_id = c.id AND m.status = 'member'
             AND COALESCE(mu.is_suspended, 0) = 0) AS members,
         CASE WHEN EXISTS (
           SELECT 1 FROM club_members m2
            WHERE m2.club_id = c.id AND m2.user_id = @viewerId AND m2.status = 'member'
         ) THEN 1 ELSE 0 END AS is_member,
         CASE WHEN EXISTS (
           SELECT 1 FROM club_members m3
            WHERE m3.club_id = c.id AND m3.user_id = @viewerId AND m3.status = 'pending'
         ) THEN 1 ELSE 0 END AS my_pending,
         (SELECT COUNT(*) FROM club_members m4
           WHERE m4.club_id = c.id AND m4.status = 'pending') AS pending_requests,
         (SELECT COUNT(*) FROM club_attendance ca
           WHERE ca.club_id = c.id AND ca.meets_key = ${MEETS_KEY}) AS attendees,
         CASE WHEN EXISTS (
           SELECT 1 FROM club_attendance ca2
            WHERE ca2.club_id = c.id AND ca2.user_id = @viewerId
              AND ca2.meets_key = ${MEETS_KEY}
         ) THEN 1 ELSE 0 END AS attending,
         (SELECT MAX(x) FROM (
            SELECT c.created_at AS x
            UNION ALL
            SELECT MAX(m5.joined_at) FROM club_members m5 WHERE m5.club_id = c.id
            UNION ALL
            SELECT MAX(bc.created_at) FROM book_comments bc
             WHERE bc.book_id = c.book_id AND bc.status = 'visible'
         )) AS last_activity,
         (SELECT json_group_array(name) FROM (
            SELECT u2.name AS name
              FROM club_members m6
              JOIN users u2 ON u2.id = m6.user_id
             WHERE m6.club_id = c.id AND m6.status = 'member'
               AND u2.is_suspended = 0
             ORDER BY m6.joined_at ASC
             LIMIT 3
         )) AS member_names
  FROM clubs c
  LEFT JOIN books b ON b.id = c.book_id
  JOIN users uo ON uo.id = c.owner_id
`;

/** Los nombres llegan como JSON; un dato raro nunca debe romper la tarjeta. */
function parseNames(raw: string | null): { id: string; name: string }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((name): name is string => typeof name === "string")
      .map((name, index) => ({ id: `${index}`, name }));
  } catch {
    return [];
  }
}

function toClubView(row: ClubRow, viewerId: string | null): ClubView {
  const isMine = row.owner_id === viewerId;
  const myStatus: ClubView["myStatus"] = row.is_member
    ? "member"
    : row.my_pending
      ? "pending"
      : "none";
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    description: row.description,
    meetsOn: row.meets_on,
    meetsAt: row.meets_at,
    createdAt: row.created_at,
    book:
      row.book_id && row.book_title
        ? { id: row.book_id, title: row.book_title, author: row.book_author ?? "" }
        : null,
    members: row.members,
    isMember: myStatus === "member",
    isMine,
    owner: { id: row.owner_id, name: row.owner_name },
    joinPolicy: row.join_policy === "approval" ? "approval" : "open",
    myStatus,
    memberPreview: parseNames(row.member_names),
    progress: row.progress,
    progressNote: row.progress_note,
    attendees: row.attendees,
    attending: Boolean(row.attending),
    lastActivityAt: row.last_activity,
    pendingRequests: isMine ? row.pending_requests : 0,
  };
}

/** Un nombre de club solo tiene que ser único dentro de su ciudad. */
function assertClubNameFree(
  db: Db,
  city: string,
  name: string,
  exceptId: string | null = null,
): void {
  const clash = db
    .prepare(
      `SELECT 1 FROM clubs
        WHERE city = @city
          AND lower(trim(name)) = lower(trim(@name))
          AND (@exceptId IS NULL OR id <> @exceptId)`,
    )
    .get({ city, name, exceptId }) as unknown;
  if (clash) {
    throw new ApiError(409, `Ya existe un club llamado «${name}» en ${city}.`);
  }
}

/** Tope de clubes por persona: evita que una cuenta sature el directorio. */
const MAX_CLUBS_PER_OWNER = 10;
/** Tope de miembros por club: los clubes son para leerse, no para acumular gente. */
const MAX_CLUB_MEMBERS = 200;

function clubLink(clubId: string): string {
  return `/clubes/${clubId}`;
}

/** Aviso interno a los miembros actuales (sin correo: son avisos de comunidad). */
function notifyMembers(
  db: Db,
  clubId: string,
  exceptUserId: string | null,
  input: { title: string; body: string },
): void {
  const members = db
    .prepare(
      `SELECT m.user_id FROM club_members m
        JOIN users u ON u.id = m.user_id
       WHERE m.club_id = ? AND m.status = 'member'
         AND u.is_suspended = 0 AND (? IS NULL OR m.user_id <> ?)`,
    )
    .all(clubId, exceptUserId, exceptUserId) as { user_id: string }[];
  for (const member of members) {
    notify({
      userId: member.user_id,
      type: "club",
      title: input.title,
      body: input.body,
      link: clubLink(clubId),
    });
  }
}

function recordProductEvent(
  db: Db,
  type: string,
  userId: string | null,
  clubId: string | null,
): void {
  db.prepare(
    "INSERT INTO product_events (id, type, user_id, club_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(`evt_${randomUUID()}`, type, userId, clubId, nowIso());
}

export function createClub(
  ownerId: string,
  input: {
    name: string;
    city: string;
    description: string;
    bookId?: string;
    meetsOn: string;
    meetsAt?: string;
    joinPolicy?: "open" | "approval";
  },
): ClubView {
  const db = getDb();
  if (input.bookId && !db.prepare("SELECT 1 FROM books WHERE id = ?").get(input.bookId)) {
    throw new ApiError(404, "Ese libro no existe.");
  }
  const owned = (
    db.prepare("SELECT COUNT(*) AS value FROM clubs WHERE owner_id = ?").get(ownerId) as {
      value: number;
    }
  ).value;
  if (owned >= MAX_CLUBS_PER_OWNER) {
    throw new ApiError(
      409,
      `Has llegado al máximo de ${MAX_CLUBS_PER_OWNER} clubes. Cierra uno para abrir otro.`,
    );
  }
  assertClubNameFree(db, input.city, input.name);

  const id = `clb_${randomUUID()}`;
  const now = nowIso();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO clubs (id, owner_id, name, city, description, book_id, meets_on, meets_at, join_policy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ownerId,
      input.name,
      input.city,
      input.description,
      input.bookId ?? null,
      input.meetsOn,
      input.meetsAt ?? "",
      input.joinPolicy ?? "open",
      now,
    );
    db.prepare(
      "INSERT INTO club_members (club_id, user_id, joined_at, status) VALUES (?, ?, ?, 'member')",
    ).run(id, ownerId, now);
    recordProductEvent(db, "club_create", ownerId, id);
  })();

  const row = db.prepare(`${CLUB_SELECT} WHERE c.id = @id`).get({ id, viewerId: ownerId }) as ClubRow;
  return toClubView(row, ownerId);
}

export type ClubSort = "members" | "meeting" | "recent" | "near";

export function listClubs(options: {
  viewerId: string | null;
  city?: string | null;
  q?: string;
  mine?: boolean;
  sort?: ClubSort;
  page?: number;
  pageSize?: number;
}): { clubs: ClubView[]; total: number; hasMore: boolean } {
  const db = getDb();
  const viewerId = options.viewerId ?? "";
  const city = options.city ?? null;
  const pageSize = Math.min(Math.max(options.pageSize ?? 12, 1), 48);
  const page = Math.max(1, options.page ?? 1);
  const like = `%${(options.q ?? "").trim().replace(/[%_]/g, "")}%`;
  const mine = options.mine ? 1 : 0;
  const sort: ClubSort = options.sort ?? "members";
  const viewerCity = options.viewerId ? (userCity(options.viewerId) ?? "") : "";

  const where = `
    c.status = 'visible'
    AND uo.is_suspended = 0
    AND (@city IS NULL OR c.city = @city)
    AND (@like = '%%' OR c.name LIKE @like COLLATE NOCASE
         OR c.description LIKE @like COLLATE NOCASE)
    AND (@mine = 0 OR c.owner_id = @viewerId OR EXISTS (
      SELECT 1 FROM club_members mm
       WHERE mm.club_id = c.id AND mm.user_id = @viewerId AND mm.status = 'member'
    ))
    AND ${blockPair("@viewerId", "c.owner_id")}
  `;

  const params = { viewerId, city, like, mine, viewerCity };
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS value FROM clubs c JOIN users uo ON uo.id = c.owner_id WHERE ${where}`,
      )
      .get(params) as { value: number }
  ).value;

  const withDistance = sort === "near" && Boolean(viewerCity);
  const select = withDistance
    ? CLUB_SELECT.replace(
        "FROM clubs c",
        "LEFT JOIN city_distances cd ON cd.from_name = @viewerCity AND cd.to_name = c.city\n  FROM clubs c",
      )
    : CLUB_SELECT;
  const order = withDistance
    ? "CASE WHEN cd.km IS NULL THEN 1 ELSE 0 END, cd.km ASC, members DESC"
    : sort === "meeting"
      ? `CASE WHEN c.meets_at <> '' AND c.meets_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
               THEN 0 ELSE 1 END,
         CASE WHEN c.meets_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN c.meets_at END ASC,
         members DESC, c.created_at DESC`
      : sort === "recent"
        ? "c.created_at DESC"
        : "members DESC, c.created_at DESC";

  const rows = db
    .prepare(`${select} WHERE ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as ClubRow[];

  return {
    clubs: rows.map((row) => toClubView(row, options.viewerId)),
    total,
    hasMore: page * pageSize < total,
  };
}

export function getClub(clubId: string, viewerId: string | null): ClubView | null {
  const row = getDb()
    .prepare(
      `${CLUB_SELECT}
       WHERE c.id = @id AND c.status = 'visible' AND uo.is_suspended = 0
         AND ${blockPair("@viewerId", "c.owner_id")}`,
    )
    .get({ id: clubId, viewerId: viewerId ?? "" }) as ClubRow | undefined;
  return row ? toClubView(row, viewerId) : null;
}

export type ClubMemberView = {
  id: string;
  name: string;
  city: string;
  joinedAt: string;
  isOwner: boolean;
};

/** Miembros activos de un club (sin cuentas suspendidas), paginados. */
export function listClubMembers(
  clubId: string,
  options: { page?: number; pageSize?: number } = {},
): { members: ClubMemberView[]; total: number; hasMore: boolean } {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const page = Math.max(1, options.page ?? 1);
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS value FROM club_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.club_id = ? AND m.status = 'member' AND u.is_suspended = 0`,
      )
      .get(clubId) as { value: number }
  ).value;
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.city, m.joined_at, c.owner_id
       FROM club_members m
       JOIN users u ON u.id = m.user_id
       JOIN clubs c ON c.id = m.club_id
       WHERE m.club_id = ? AND m.status = 'member' AND u.is_suspended = 0
       ORDER BY (u.id = c.owner_id) DESC, m.joined_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(clubId, pageSize, (page - 1) * pageSize) as {
    id: string;
    name: string;
    city: string;
    joined_at: string;
    owner_id: string;
  }[];
  return {
    members: rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      joinedAt: row.joined_at,
      isOwner: row.id === row.owner_id,
    })),
    total,
    hasMore: page * pageSize < total,
  };
}

/** Solicitudes de entrada pendientes: solo para quien creó el club. */
export function listClubRequests(clubId: string, ownerId: string): ClubRequestView[] {
  const db = getDb();
  const club = db.prepare("SELECT owner_id FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club ve las solicitudes.");
  }
  return db
    .prepare(
      `SELECT u.id, u.name, u.city, m.joined_at
       FROM club_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.club_id = ? AND m.status = 'pending' AND u.is_suspended = 0
       ORDER BY m.joined_at ASC`,
    )
    .all(clubId)
    .map((row) => {
      const typed = row as { id: string; name: string; city: string; joined_at: string };
      return {
        user: { id: typed.id, name: typed.name, city: typed.city },
        createdAt: typed.joined_at,
      };
    });
}

/** Quien creó el club puede cambiar nombre, descripción, encuentro y lectura. */
export function updateClub(
  ownerId: string,
  clubId: string,
  input: {
    name: string;
    description: string;
    meetsOn: string;
    meetsAt?: string;
    bookId: string | null;
    joinPolicy?: "open" | "approval";
    progress?: number;
    progressNote?: string;
  },
): void {
  const db = getDb();
  const club = db
    .prepare(
      "SELECT owner_id, city, book_id, meets_at, meets_on, progress FROM clubs WHERE id = ?",
    )
    .get(clubId) as
    | {
        owner_id: string;
        city: string;
        book_id: string | null;
        meets_at: string;
        meets_on: string;
        progress: number;
      }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) throw new ApiError(403, "Solo puedes editar tus clubes.");

  if (input.bookId && !db.prepare("SELECT 1 FROM books WHERE id = ?").get(input.bookId)) {
    throw new ApiError(404, "Ese libro no existe.");
  }

  assertClubNameFree(db, club.city, input.name, clubId);

  const meetsAt = input.meetsAt ?? club.meets_at;
  const changedMeeting = meetsAt !== club.meets_at || input.meetsOn !== club.meets_on;
  const changedReading = (input.bookId ?? null) !== club.book_id;
  const progress = input.progress ?? club.progress;

  db.prepare(
    `UPDATE clubs
        SET name = ?, description = ?, meets_on = ?, meets_at = ?, book_id = ?,
            join_policy = ?, progress = ?, progress_note = ?
      WHERE id = ?`,
  ).run(
    input.name,
    input.description,
    input.meetsOn,
    meetsAt,
    input.bookId,
    input.joinPolicy ?? "open",
    progress,
    input.progressNote ?? "",
    clubId,
  );

  if (changedMeeting) {
    notifyMembers(db, clubId, ownerId, {
      title: "Nuevo encuentro del club",
      body: meetsAt
        ? `El club ha fijado otro encuentro: ${meetsAt.slice(0, 16).replace("T", " ")}.`
        : "Se ha actualizado el día de encuentro del club.",
    });
  }
  if (changedReading) {
    notifyMembers(db, clubId, ownerId, {
      title: "Cambio de lectura en el club",
      body: "El club ha elegido otra lectura en curso. Entra para verla.",
    });
  }
  if (progress !== club.progress) {
    notifyMembers(db, clubId, ownerId, {
      title: "El club avanza",
      body: `La lectura va por el ${progress}%.`,
    });
  }
}

export function deleteClub(ownerId: string, clubId: string): void {
  const db = getDb();
  const club = db.prepare("SELECT owner_id FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) throw new ApiError(403, "Solo puedes borrar tus clubes.");
  db.prepare("DELETE FROM clubs WHERE id = ?").run(clubId);
}

export type ClubMembershipResult = {
  /** true solo si la persona ya es miembro (una solicitud pendiente no lo es). */
  member: boolean;
  status: "member" | "pending" | "none";
  members: number;
  pending: number;
};

function membershipCounts(db: Db, clubId: string): { members: number; pending: number } {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM club_members m
            LEFT JOIN users u ON u.id = m.user_id
           WHERE m.club_id = ? AND m.status = 'member'
             AND COALESCE(u.is_suspended, 0) = 0) AS members,
         (SELECT COUNT(*) FROM club_members m2
           WHERE m2.club_id = ? AND m2.status = 'pending') AS pending`,
    )
    .get(clubId, clubId) as { members: number; pending: number };
}

export function setClubMembership(
  userId: string,
  clubId: string,
  joined: boolean,
): ClubMembershipResult {
  const db = getDb();
  const club = db
    .prepare(
      `SELECT c.owner_id, c.join_policy, c.name, u.is_suspended
         FROM clubs c JOIN users u ON u.id = c.owner_id
        WHERE c.id = ? AND c.status = 'visible'`,
    )
    .get(clubId) as
    | { owner_id: string; join_policy: string; name: string; is_suspended: number }
    | undefined;
  if (!club || club.is_suspended) throw new ApiError(404, "El club no existe.");
  if (isBlocked(userId, club.owner_id) || isBlocked(club.owner_id, userId)) {
    throw new ApiError(404, "El club no existe.");
  }

  if (!joined && club.owner_id === userId) {
    throw new ApiError(409, "Quien creó el club no puede salir de él.");
  }

  const membership: { status: ClubMembershipResult["status"] } = { status: "none" };

  if (joined) {
    // Dentro de una transacción: dos altas simultáneas no pueden saltarse el
    // tope de miembros ni chocar contra la clave primaria.
    db.transaction(() => {
      const already = db
        .prepare("SELECT status FROM club_members WHERE club_id = ? AND user_id = ?")
        .get(clubId, userId) as { status: string } | undefined;
      if (already) {
        membership.status = already.status === "member" ? "member" : "pending";
        return;
      }
      const total = membershipCounts(db, clubId).members;
      if (total >= MAX_CLUB_MEMBERS) {
        throw new ApiError(409, `Este club ya tiene ${MAX_CLUB_MEMBERS} miembros, el máximo.`);
      }
      const needsApproval = club.join_policy === "approval" && club.owner_id !== userId;
      membership.status = needsApproval ? "pending" : "member";
      db.prepare(
        "INSERT INTO club_members (club_id, user_id, joined_at, status) VALUES (?, ?, ?, ?)",
      ).run(clubId, userId, nowIso(), membership.status);

      const joiner = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as
        | { name: string }
        | undefined;
      if (membership.status === "member") {
        recordProductEvent(db, "club_join", userId, clubId);
        notify({
          userId: club.owner_id,
          type: "club",
          title: "Alguien se ha unido a tu club",
          body: `${joiner?.name ?? "Una persona"} se ha unido a «${club.name}».`,
          link: clubLink(clubId),
        });
      } else {
        notify({
          userId: club.owner_id,
          type: "club",
          title: "Nueva solicitud para tu club",
          body: `${joiner?.name ?? "Una persona"} quiere entrar en «${club.name}».`,
          link: clubLink(clubId),
        });
      }
    })();
  } else {
    db.prepare("DELETE FROM club_members WHERE club_id = ? AND user_id = ?").run(clubId, userId);
  }

  const counts = membershipCounts(db, clubId);
  return { member: membership.status === "member", status: membership.status, ...counts };
}

/** Quien creó el club aprueba o rechaza una solicitud de entrada. */
export function decideClubMembership(
  ownerId: string,
  clubId: string,
  userId: string,
  approve: boolean,
): { members: number; pending: number } {
  const db = getDb();
  const club = db
    .prepare("SELECT owner_id, name FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as { owner_id: string; name: string } | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club decide quién entra.");
  }

  // Todo dentro de una transacción y con escrituras condicionales: si dos
  // peticiones deciden a la vez, solo una cambia el estado.
  db.transaction(() => {
    const pending = db
      .prepare("SELECT status FROM club_members WHERE club_id = ? AND user_id = ?")
      .get(clubId, userId) as { status: string } | undefined;
    if (pending?.status !== "pending") throw new ApiError(404, "Esa solicitud ya no existe.");

    if (approve) {
      if (membershipCounts(db, clubId).members >= MAX_CLUB_MEMBERS) {
        throw new ApiError(409, `Este club ya tiene ${MAX_CLUB_MEMBERS} miembros, el máximo.`);
      }
      const updated = db
        .prepare(
          "UPDATE club_members SET status = 'member' WHERE club_id = ? AND user_id = ? AND status = 'pending'",
        )
        .run(clubId, userId);
      if (updated.changes !== 1) throw new ApiError(404, "Esa solicitud ya no existe.");
      recordProductEvent(db, "club_join", userId, clubId);
      notify({
        userId,
        type: "club",
        title: "Te han aceptado en el club",
        body: `Ya formas parte de «${club.name}». La conversación está en el hilo del libro.`,
        link: clubLink(clubId),
      });
    } else {
      const deleted = db
        .prepare("DELETE FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'pending'")
        .run(clubId, userId);
      if (deleted.changes !== 1) throw new ApiError(404, "Esa solicitud ya no existe.");
      notify({
        userId,
        type: "club",
        title: "Solicitud no aceptada",
        body: `El club «${club.name}» no ha aceptado tu entrada por ahora.`,
        link: clubLink(clubId),
      });
    }
  })();

  return membershipCounts(db, clubId);
}

/** El dueño puede retirar a un miembro (nunca a sí mismo). */
export function removeClubMember(ownerId: string, clubId: string, userId: string): void {
  if (ownerId === userId) throw new ApiError(409, "No puedes retirarte de tu propio club.");
  const db = getDb();
  const club = db.prepare("SELECT owner_id, name FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string; name: string }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club puede retirar miembros.");
  }
  const result = db
    .prepare("DELETE FROM club_members WHERE club_id = ? AND user_id = ?")
    .run(clubId, userId);
  if (result.changes === 0) throw new ApiError(404, "Esa persona no está en el club.");
  notify({
    userId,
    type: "club",
    title: "Ya no estás en el club",
    body: `Quien creó «${club.name}» te ha retirado del club.`,
    link: clubLink(clubId),
  });
}

/** Cesión del club a otra persona que ya sea miembro. */
export function transferClub(ownerId: string, clubId: string, userId: string): void {
  if (ownerId === userId) throw new ApiError(409, "El club ya es tuyo.");
  const db = getDb();
  const club = db.prepare("SELECT owner_id, name FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string; name: string }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club puede cederlo.");
  }
  // Ceder a una cuenta suspendida dejaría el club invisible y sin nadie que
  // pudiera devolverlo.
  const target = db.prepare("SELECT is_suspended FROM users WHERE id = ?").get(userId) as
    | { is_suspended: number }
    | undefined;
  if (!target || target.is_suspended) {
    throw new ApiError(404, "La persona ya no está disponible.");
  }
  if (isBlocked(ownerId, userId) || isBlocked(userId, ownerId)) {
    throw new ApiError(409, "No puedes ceder el club a esa persona.");
  }

  db.transaction(() => {
    const member = db
      .prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'")
      .get(clubId, userId);
    if (!member) {
      throw new ApiError(409, "Solo puedes ceder el club a alguien que ya sea miembro.");
    }
    const moved = db
      .prepare("UPDATE clubs SET owner_id = ? WHERE id = ? AND owner_id = ?")
      .run(userId, clubId, ownerId);
    if (moved.changes !== 1) {
      throw new ApiError(409, "El club ha cambiado de manos mientras lo mirabas.");
    }
    notify({
      userId,
      type: "club",
      title: "Ahora llevas un club",
      body: `Te han cedido «${club.name}». Ya puedes cambiar la lectura y los encuentros.`,
      link: clubLink(clubId),
    });
    notify({
      userId: ownerId,
      type: "club",
      title: "Has cedido un club",
      body: `«${club.name}» ya tiene otra persona al frente.`,
      link: clubLink(clubId),
    });
  })();
}

/** Asistencia al encuentro actual (la clave es la fecha o la etiqueta). */
export function setClubAttendance(
  userId: string,
  clubId: string,
  attending: boolean,
): { attending: boolean; attendees: number } {
  const db = getDb();
  const club = db
    .prepare("SELECT meets_at, meets_on FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as { meets_at: string; meets_on: string } | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  const membership = db
    .prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'")
    .get(clubId, userId);
  if (!membership) throw new ApiError(403, "Solo los miembros pueden confirmar asistencia.");
  const key = club.meets_at || club.meets_on;
  if (!key) throw new ApiError(409, "El club aún no ha fijado un encuentro.");

  if (attending) {
    db.prepare(
      "INSERT OR IGNORE INTO club_attendance (club_id, user_id, meets_key, created_at) VALUES (?, ?, ?, ?)",
    ).run(clubId, userId, key, nowIso());
  } else {
    db.prepare(
      "DELETE FROM club_attendance WHERE club_id = ? AND user_id = ? AND meets_key = ?",
    ).run(clubId, userId, key);
  }

  const attendees = (
    db
      .prepare("SELECT COUNT(*) AS value FROM club_attendance WHERE club_id = ? AND meets_key = ?")
      .get(clubId, key) as { value: number }
  ).value;
  return { attending, attendees };
}

/**
 * Invitación a un lector. Solo puede invitar quien creó el club o alguien que
 * siga a la persona invitada, para que el club no sea un canal de spam.
 */
export function inviteToClub(inviterId: string, clubId: string, userId: string): void {
  const db = getDb();
  const club = db
    .prepare(
      `SELECT c.owner_id, c.name, u.is_suspended
         FROM clubs c JOIN users u ON u.id = c.owner_id
        WHERE c.id = ? AND c.status = 'visible'`,
    )
    .get(clubId) as { owner_id: string; name: string; is_suspended: number } | undefined;
  if (!club || club.is_suspended) throw new ApiError(404, "El club no existe.");
  const member = db
    .prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'")
    .get(clubId, inviterId);
  if (!member) throw new ApiError(403, "Solo los miembros pueden invitar.");
  if (userId === inviterId) throw new ApiError(409, "Ya estás en el club.");

  const target = db.prepare("SELECT name, is_suspended FROM users WHERE id = ?").get(userId) as
    | { name: string; is_suspended: number }
    | undefined;
  if (!target || target.is_suspended) throw new ApiError(404, "Esa persona no existe.");
  if (isBlocked(inviterId, userId) || isBlocked(userId, inviterId)) {
    throw new ApiError(404, "Esa persona no existe.");
  }
  const already = db
    .prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?")
    .get(clubId, userId);
  if (already) throw new ApiError(409, "Esa persona ya está en el club o ha pedido entrar.");

  if (club.owner_id !== inviterId) {
    const follows = db
      .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?")
      .get(inviterId, userId);
    if (!follows) throw new ApiError(403, "Solo puedes invitar a personas que sigues.");
  }

  const inviter = db.prepare("SELECT name FROM users WHERE id = ?").get(inviterId) as {
    name: string;
  };
  notify({
    userId,
    type: "club",
    title: "Te han invitado a un club",
    body: `${inviter.name} te invita a «${club.name}».`,
    link: clubLink(clubId),
  });
}

/** Clubs visibles para el sitemap (dueño activo y sin moderación). */
export function listClubSitemap(limit = 500): { id: string; created_at: string }[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.created_at FROM clubs c
         JOIN users u ON u.id = c.owner_id
        WHERE u.is_suspended = 0 AND c.status = 'visible'
        ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(limit) as { id: string; created_at: string }[];
}

/* ----------------------------- métricas ----------------------------------- */

/**
 * Vista de club: una por persona y club cada hora para no inflar la tabla con
 * recargas. Sin cuenta no se registra (no hay nada que medir).
 */
export function recordClubView(clubId: string, userId: string | null): void {
  if (!userId) return;
  const db = getDb();
  const recent = db
    .prepare(
      `SELECT 1 FROM product_events
        WHERE type = 'club_view' AND user_id = ? AND club_id = ?
          AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`,
    )
    .get(userId, clubId);
  if (recent) return;
  recordProductEvent(db, "club_view", userId, clubId);
}

export type HiddenClubView = {
  id: string;
  name: string;
  city: string;
  ownerName: string;
  createdAt: string;
};

/** Clubes retirados por moderación, para poder restablecerlos. */
export function listHiddenClubs(limit = 50): HiddenClubView[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.city, u.name AS owner_name, c.created_at
         FROM clubs c JOIN users u ON u.id = c.owner_id
        WHERE c.status = 'hidden'
        ORDER BY c.created_at DESC
        LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    name: string;
    city: string;
    owner_name: string;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    ownerName: row.owner_name,
    createdAt: row.created_at,
  }));
}

/**
 * Recordatorio del encuentro: avisa a los miembros cuando falta menos de un día
 * y aún no se ha avisado en las últimas 20 horas (una vez por encuentro).
 */
export function notifyUpcomingMeetings(): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.meets_at FROM clubs c
        WHERE c.status = 'visible' AND c.meets_at <> ''
          AND c.meets_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND c.meets_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')
          AND NOT EXISTS (
            SELECT 1 FROM product_events e
             WHERE e.type = 'club_reminder' AND e.club_id = c.id
               AND e.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 hours')
          )`,
    )
    .all() as { id: string; name: string; meets_at: string }[];

  for (const club of rows) {
    notifyMembers(db, club.id, null, {
      title: "Mañana es el encuentro del club",
      body: `«${club.name}» se reúne el ${club.meets_at.slice(0, 16).replace("T", " ")}.`,
    });
    recordProductEvent(db, "club_reminder", null, club.id);
  }
  return rows.length;
}

/** Cifras de comunidad para el panel de administración. */
export function getCommunityMetrics(): CommunityMetrics {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { value: number }).value;
  return {
    clubs: one("SELECT COUNT(*) AS value FROM clubs WHERE status = 'visible'"),
    memberships: one(
      `SELECT COUNT(*) AS value FROM club_members m JOIN users u ON u.id = m.user_id
        WHERE m.status = 'member' AND u.is_suspended = 0`,
    ),
    pendingRequests: one("SELECT COUNT(*) AS value FROM club_members WHERE status = 'pending'"),
    conversations: one(
      `SELECT COUNT(*) AS value FROM book_comments c JOIN users u ON u.id = c.author_id
        WHERE c.status = 'visible' AND u.is_suspended = 0`,
    ),
    views7d: one(
      `SELECT COUNT(*) AS value FROM product_events WHERE type = 'club_view'
        AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`,
    ),
    joins7d: one(
      `SELECT COUNT(*) AS value FROM club_members WHERE status = 'member'
        AND joined_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`,
    ),
    retention7d: one(
      `SELECT COUNT(*) AS value FROM users u
        WHERE u.is_suspended = 0
          AND u.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
          AND (
            EXISTS (SELECT 1 FROM book_comments c WHERE c.author_id = u.id
                     AND c.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', u.created_at, '+7 days'))
            OR EXISTS (SELECT 1 FROM events e WHERE e.actor_id = u.id
                        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', u.created_at, '+7 days'))
            OR EXISTS (SELECT 1 FROM messages m JOIN requests r ON r.id = m.request_id
                        WHERE (r.owner_id = u.id OR r.requester_id = u.id)
                          AND m.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', u.created_at, '+7 days'))
          )`,
    ),
    availableListings: one("SELECT COUNT(*) AS value FROM listings WHERE status = 'available'"),
    requests30d: one(
      `SELECT COUNT(*) AS value FROM requests
        WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`,
    ),
    completed30d: one(
      `SELECT COUNT(*) AS value FROM requests WHERE status = 'completed'
        AND updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`,
    ),
    activeUsers30d: one(
      `SELECT COUNT(DISTINCT u.id) AS value FROM users u
        WHERE u.is_suspended = 0 AND (
          EXISTS (SELECT 1 FROM requests r WHERE (r.owner_id = u.id OR r.requester_id = u.id)
                   AND r.updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))
          OR EXISTS (SELECT 1 FROM book_comments c WHERE c.author_id = u.id
                   AND c.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))
          OR EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = u.id
                   AND m.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))
        )`,
    ),
  };
}

