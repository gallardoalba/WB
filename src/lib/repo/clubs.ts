import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { ClubRequestView, ClubView, CommunityMetrics } from "../domain";
import { notify } from "./notifications";
import { blockPair, isBlocked, nowIso, userCity, workBookIds, workIdsClause } from "./shared";

/* -------------------------------- clubes ---------------------------------- */

type ClubRow = {
  id: string;
  name: string;
  city: string;
  description: string;
  meets_on: string;
  meets_at: string;
  meets_place: string;
  meets_link: string;
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
  is_moderator: number;
};

/**
 * La clave del encuentro es la fecha concreta si existe y, si no, la etiqueta
 * recurrente: así la asistencia se guarda contra el encuentro que se muestra y
 * no se mezcla al cambiar de fecha.
 */
const MEETS_KEY = "COALESCE(NULLIF(c.meets_at, ''), c.meets_on)";

const CLUB_SELECT = `
  SELECT c.id, c.name, c.city, c.description, c.meets_on, c.meets_at,
         c.meets_place, c.meets_link, c.created_at,
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
         CASE WHEN EXISTS (
           SELECT 1 FROM club_members m7
            WHERE m7.club_id = c.id AND m7.user_id = @viewerId
              AND m7.status = 'member' AND m7.role = 'moderator'
         ) THEN 1 ELSE 0 END AS is_moderator,
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
    meetsPlace: row.meets_place,
    meetsLink: row.meets_link,
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
    isModerator: Boolean(row.is_moderator) && !isMine,
    // Las solicitudes las ve quien lleva el club: su dueño y sus moderadores.
    pendingRequests: isMine || row.is_moderator ? row.pending_requests : 0,
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
    meetsPlace?: string;
    meetsLink?: string;
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
      `INSERT INTO clubs (id, owner_id, name, city, description, book_id, meets_on, meets_at,
                          meets_place, meets_link, join_policy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ownerId,
      input.name,
      input.city,
      input.description,
      input.bookId ?? null,
      input.meetsOn,
      input.meetsAt ?? "",
      input.meetsPlace ?? "",
      input.meetsLink ?? "",
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
    AND (@like = '%%' OR unaccent(c.name) LIKE unaccent(@like)
         OR unaccent(c.description) LIKE unaccent(@like))
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
  // El LEFT JOIN va **después** del FROM, no en su lugar: sustituyendo el FROM
  // la sentencia quedaba como «JOIN … FROM clubs» y ordenar por cercanía daba
  // un 500 (error de sintaxis) en cuanto la cuenta tenía ciudad.
  const select = withDistance
    ? CLUB_SELECT.replace(
        "\n  FROM clubs c",
        "\n  FROM clubs c\n  LEFT JOIN city_distances cd\n    ON cd.from_name = @viewerCity AND cd.to_name = c.city",
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
  /** Ayuda a llevar el club (moderación y solicitudes). */
  isModerator: boolean;
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
      `SELECT u.id, u.name, u.city, m.joined_at, c.owner_id, m.role
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
    role: string;
  }[];
  return {
    members: rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      joinedAt: row.joined_at,
      isOwner: row.id === row.owner_id,
      isModerator: row.role === "moderator",
    })),
    total,
    hasMore: page * pageSize < total,
  };
}

/**
 * Quién puede llevar la parte social del club: su dueño y sus moderadores.
 *
 * Se pregunta a la base en cada operación (no se confía en la vista): un
 * moderador retirado deja de poder aprobar en el acto.
 */
export function moderatesClub(clubId: string, userId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT c.owner_id AS owner_id, m.role AS role
         FROM clubs c
         LEFT JOIN club_members m
           ON m.club_id = c.id AND m.user_id = ? AND m.status = 'member'
        WHERE c.id = ? AND c.status = 'visible'`,
    )
    .get(userId, clubId) as { owner_id: string; role: string | null } | undefined;
  if (!row) return false;
  return row.owner_id === userId || row.role === "moderator";
}

/** Solicitudes de entrada pendientes: para el dueño y sus moderadores. */
export function listClubRequests(clubId: string, viewerId: string): ClubRequestView[] {
  const db = getDb();
  const club = db.prepare("SELECT owner_id FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (!moderatesClub(clubId, viewerId)) {
    throw new ApiError(403, "Solo quien lleva el club ve las solicitudes.");
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
    meetsPlace?: string;
    meetsLink?: string;
    bookId: string | null;
    joinPolicy?: "open" | "approval";
    progress?: number;
    progressNote?: string;
  },
): void {
  const db = getDb();
  const club = db
    .prepare(
      "SELECT owner_id, city, book_id, meets_at, meets_on, meets_place, meets_link, progress FROM clubs WHERE id = ?",
    )
    .get(clubId) as
    | {
        owner_id: string;
        city: string;
        book_id: string | null;
        meets_at: string;
        meets_on: string;
        meets_place: string;
        meets_link: string;
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
  const meetsPlace = input.meetsPlace ?? club.meets_place;
  const meetsLink = input.meetsLink ?? club.meets_link;
  const changedMeeting =
    meetsAt !== club.meets_at ||
    input.meetsOn !== club.meets_on ||
    meetsPlace !== club.meets_place ||
    meetsLink !== club.meets_link;
  const changedReading = (input.bookId ?? null) !== club.book_id;
  const progress = input.progress ?? club.progress;

  db.prepare(
    `UPDATE clubs
        SET name = ?, description = ?, meets_on = ?, meets_at = ?,
            meets_place = ?, meets_link = ?, book_id = ?,
            join_policy = ?, progress = ?, progress_note = ?
      WHERE id = ?`,
  ).run(
    input.name,
    input.description,
    input.meetsOn,
    meetsAt,
    meetsPlace,
    meetsLink,
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
    db.transaction(() => {
      db.prepare("DELETE FROM club_members WHERE club_id = ? AND user_id = ?").run(clubId, userId);
      // Quien se va no deja asistencia fantasma: el club seguía contándole
      // entre los confirmados del próximo encuentro.
      db.prepare("DELETE FROM club_attendance WHERE club_id = ? AND user_id = ?").run(
        clubId,
        userId,
      );
    })();
  }

  const counts = membershipCounts(db, clubId);
  return { member: membership.status === "member", status: membership.status, ...counts };
}

/**
 * Aprobar o rechazar una solicitud de entrada: su dueño o un moderador.
 *
 * Si decide un moderador, el dueño recibe el aviso: entera a quien responde del
 * club sin tener que revisar la lista cada día.
 */
export function decideClubMembership(
  actorId: string,
  clubId: string,
  userId: string,
  approve: boolean,
): { members: number; pending: number } {
  const db = getDb();
  const club = db
    .prepare("SELECT owner_id, name FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as { owner_id: string; name: string } | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (!moderatesClub(clubId, actorId)) {
    throw new ApiError(403, "Solo quien lleva el club decide quién entra.");
  }
  const isOwner = club.owner_id === actorId;

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

    // Si decide alguien de confianza, el dueño se entera: es su club.
    if (!isOwner) {
      const actor = db.prepare("SELECT name FROM users WHERE id = ?").get(actorId) as
        | { name: string }
        | undefined;
      const applicant = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as
        | { name: string }
        | undefined;
      notify({
        userId: club.owner_id,
        type: "club",
        title: approve ? "Una solicitud aceptada" : "Una solicitud rechazada",
        body: `${actor?.name ?? "Un moderador"} ${approve ? "aceptó" : "rechazó"} la entrada de ${
          applicant?.name ?? "una persona"
        } en «${club.name}».`,
        link: clubLink(clubId),
      });
    }
  })();

  return membershipCounts(db, clubId);
}

/**
 * Nombra (o retira) a un moderador del club. Solo su dueño, y solo entre
 * miembros activos: moderar sin estar dentro no tendría sentido.
 */
export function setClubModerator(
  ownerId: string,
  clubId: string,
  userId: string,
  moderator: boolean,
): { moderators: number } {
  const db = getDb();
  const club = db.prepare("SELECT owner_id, name FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string; name: string }
    | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club elige a sus moderadores.");
  }
  if (userId === ownerId) {
    throw new ApiError(409, "Tú ya llevas el club: no hace falta nombrarte moderador.");
  }

  db.transaction(() => {
    const member = db
      .prepare("SELECT status, role FROM club_members WHERE club_id = ? AND user_id = ?")
      .get(clubId, userId) as { status: string; role: string } | undefined;
    if (!member || member.status !== "member") {
      throw new ApiError(409, "Solo puedes nombrar moderador a alguien que ya esté en el club.");
    }
    const role = moderator ? "moderator" : "member";
    if (member.role !== role) {
      db.prepare("UPDATE club_members SET role = ? WHERE club_id = ? AND user_id = ?").run(
        role,
        clubId,
        userId,
      );
      notify({
        userId,
        type: "club",
        title: moderator ? "Ahora moderas un club" : "Ya no moderas el club",
        body: moderator
          ? `Podrás aceptar solicitudes de entrada y retirar mensajes en «${club.name}».`
          : `«${club.name}» lo lleva otra persona: ya no moderas su foro.`,
        link: clubLink(clubId),
      });
    }
  })();

  const total = db
    .prepare(
      "SELECT COUNT(*) AS value FROM club_members WHERE club_id = ? AND role = 'moderator' AND status = 'member'",
    )
    .get(clubId) as { value: number };
  return { moderators: total.value };
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
  // Igual que al salir por su cuenta: sin asistencia pendiente.
  db.prepare("DELETE FROM club_attendance WHERE club_id = ? AND user_id = ?").run(clubId, userId);
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

/**
 * Encuentros anteriores del club. La asistencia se guarda contra la fecha (o la
 * etiqueta) del encuentro, así que al cambiar de fecha el anterior sigue ahí:
 * esto lo agrupa para que el club tenga memoria de a quién vio.
 */
export function listClubMeetingHistory(
  clubId: string,
  limit = 6,
): { key: string; attendees: number }[] {
  const db = getDb();
  const club = db
    .prepare("SELECT meets_at, meets_on FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as { meets_at: string; meets_on: string } | undefined;
  if (!club) return [];
  const actual = club.meets_at || club.meets_on;
  return db
    .prepare(
      `SELECT ca.meets_key AS key, COUNT(*) AS attendees, MAX(ca.created_at) AS ultimo
         FROM club_attendance ca
         JOIN users u ON u.id = ca.user_id
        WHERE ca.club_id = ? AND ca.meets_key <> ? AND u.is_suspended = 0
        GROUP BY ca.meets_key
        ORDER BY ultimo DESC
        LIMIT ?`,
    )
    .all(clubId, actual, limit)
    .map((row) => {
      const typed = row as { key: string; attendees: number };
      return { key: typed.key, attendees: typed.attendees };
    });
}

/**
 * Quién va por dónde con la lectura en curso: los estados personales
 * (`reading_states`) de los miembros para esa obra, incluida cualquiera de sus
 * ediciones. Es la información que un club necesita sin preguntarla en el foro.
 */
export function listClubReadingStates(
  clubId: string,
  bookId: string,
): { userId: string; status: "reading" | "read" }[] {
  const db = getDb();
  const scope = workIdsClause("rs.book_id", workBookIds(bookId));
  const rows = db
    .prepare(
      `SELECT DISTINCT rs.user_id AS userId, rs.status AS status
         FROM club_members m
         JOIN users u ON u.id = m.user_id
         JOIN reading_states rs ON rs.user_id = m.user_id
        WHERE m.club_id = @clubId AND m.status = 'member' AND u.is_suspended = 0
          AND ${scope.clause}`,
    )
    .all({ ...scope.params, clubId }) as { userId: string; status: string }[];
  return rows.map((row) => ({
    userId: row.userId,
    status: row.status === "read" ? "read" : "reading",
  }));
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
export function listHiddenClubs(limit = 50, offset = 0): HiddenClubView[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.city, u.name AS owner_name, c.created_at
         FROM clubs c JOIN users u ON u.id = c.owner_id
        WHERE c.status = 'hidden'
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as {
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

/** Total de clubes ocultos (para paginar la lista). */
export function countHiddenClubs(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM clubs WHERE status = 'hidden'")
    .get() as { count: number };
  return row.count;
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

