import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import { getReaderJourney } from "./journey";
import { cancelExchangesForAccount } from "./requests";
import { nowIso } from "./shared";
import { getUserById } from "./users";

export function deleteAccount(userId: string): void {
  const db = getDb();
  const account = getUserById(userId);
  const anonymousEmail = `deleted-${randomUUID()}@wanderbibliothek.invalid`;

  db.transaction(() => {
    db.prepare("UPDATE listings SET status = 'removed' WHERE owner_id = ?").run(userId);
    // Cancelar sin más dejaría los ejemplares de la otra parte en `reserved`
    // para siempre; el helper reutiliza la misma transición que la UI.
    cancelExchangesForAccount(userId);
    if (account?.email) {
      // Los enlaces pendientes contienen tokens y el correo de la persona.
      db.prepare("DELETE FROM mail_outbox WHERE to_email = ?").run(account.email);
    }
    db.prepare(
      `UPDATE users
          SET name = 'Cuenta eliminada', email = ?, bio = '', is_suspended = 1,
              password_hash = ?, public_key = NULL, public_key_id = NULL,
              totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL
        WHERE id = ?`,
    ).run(anonymousEmail, hashPlaceholder(), userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM favorites WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM book_wants WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM reading_states WHERE user_id = ?").run(userId);
    // Resto de datos personales: clubs propios (arrastra sus miembros), avisos,
    // tokens de cuenta, bloqueos en ambos sentidos y marcas de lectura.
    db.prepare("DELETE FROM clubs WHERE owner_id = ?").run(userId);
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM account_tokens WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM availability_alerts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?").run(userId, userId);
    db.prepare("DELETE FROM request_reads WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM reports WHERE reporter_id = ?").run(userId);

    // Contenido propio: fuera. Si un comentario tiene respuestas se deja el
    // hueco (sin texto) para no romper la conversación de los demás.
    const ownComments = db
      .prepare("SELECT id FROM book_comments WHERE author_id = ?")
      .all(userId) as { id: string }[];
    const hasReplies = db.prepare(
      "SELECT 1 FROM book_comments WHERE parent_id = ? AND status <> 'deleted' LIMIT 1",
    );
    const tombstone = db.prepare(
      "UPDATE book_comments SET status = 'deleted', body = '' WHERE id = ?",
    );
    const hardDelete = db.prepare("DELETE FROM book_comments WHERE id = ?");
    for (const comment of ownComments) {
      if (hasReplies.get(comment.id)) tombstone.run(comment.id);
      else hardDelete.run(comment.id);
    }
    db.prepare("DELETE FROM book_comment_likes WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM reading_lists WHERE owner_id = ?").run(userId);
    db.prepare("DELETE FROM club_members WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM follows WHERE follower_id = ? OR followed_id = ?").run(userId, userId);
  })();
}

function hashPlaceholder(): string {
  return `deleted$${randomUUID()}$${randomUUID()}`;
}

export function exportAccountData(userId: string) {
  const db = getDb();
  const user = getUserById(userId);
  if (!user) throw new ApiError(404, "La cuenta no existe.");

  const listings = db
    .prepare(
      `SELECT l.id, b.title, b.author, l.condition, l.city, l.status, l.created_at
       FROM listings l JOIN books b ON b.id = l.book_id WHERE l.owner_id = ?`,
    )
    .all(userId);

  const requests = db
    .prepare(
      `SELECT r.id, r.status, r.created_at, b.title AS book
       FROM requests r
       JOIN listings l ON l.id = r.listing_id
       JOIN books b ON b.id = l.book_id
       WHERE r.requester_id = ? OR r.owner_id = ?`,
    )
    .all(userId, userId);

  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.ciphertext, m.iv, m.encrypted, m.created_at, m.request_id
       FROM messages m WHERE m.sender_id = ? ORDER BY m.created_at DESC`,
    )
    .all(userId);

  // Todo lo que la persona ha recibido en sus conversaciones (portabilidad).
  const messagesReceived = db
    .prepare(
      `SELECT m.id, m.body, m.ciphertext, m.iv, m.encrypted, m.created_at, m.request_id,
              u.name AS sender
         FROM messages m
         JOIN requests r ON r.id = m.request_id
         JOIN users u ON u.id = m.sender_id
        WHERE (r.requester_id = ? OR r.owner_id = ?) AND m.sender_id <> ?
        ORDER BY m.created_at DESC`,
    )
    .all(userId, userId, userId);

  const favorites = db
    .prepare(
      `SELECT f.created_at, l.id AS listing_id, b.title, b.author
       FROM favorites f
       JOIN listings l ON l.id = f.listing_id
       JOIN books b ON b.id = l.book_id
       WHERE f.user_id = ? ORDER BY f.created_at DESC`,
    )
    .all(userId);

  const bookWants = db
    .prepare(
      `SELECT w.created_at, b.id AS book_id, b.title, b.author
       FROM book_wants w
       JOIN books b ON b.id = w.book_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC`,
    )
    .all(userId);

  const readingStates = db
    .prepare(
      `SELECT rs.status, rs.created_at, rs.updated_at, b.id AS book_id, b.title, b.author
       FROM reading_states rs
       JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = ? ORDER BY rs.updated_at DESC`,
    )
    .all(userId);

  const clubLoans = db
    .prepare(
      `SELECT cl.id, cl.due_at, cl.returned_at, cl.created_at, b.title,
              lender.name AS lender, borrower.name AS borrower
         FROM club_loans cl
         JOIN listings l ON l.id = cl.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users lender ON lender.id = cl.lender_id
         JOIN users borrower ON borrower.id = cl.borrower_id
        WHERE cl.lender_id = ? OR cl.borrower_id = ?`,
    )
    .all(userId, userId);

  const reviewsGiven = db
    .prepare(
      `SELECT rv.id, rv.rating, rv.comment, rv.created_at, u.name AS about
       FROM reviews rv JOIN users u ON u.id = rv.target_id
       WHERE rv.author_id = ? ORDER BY rv.created_at DESC`,
    )
    .all(userId);

  const reviewsReceived = db
    .prepare(
      `SELECT rv.id, rv.rating, rv.comment, rv.created_at, u.name AS author
       FROM reviews rv JOIN users u ON u.id = rv.author_id
       WHERE rv.target_id = ? ORDER BY rv.created_at DESC`,
    )
    .all(userId);

  const notifications = db
    .prepare(
      `SELECT id, type, title, body, read_at, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);

  const blocks = db
    .prepare(
      `SELECT b.created_at, u.name AS blocked
       FROM blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    )
    .all(userId);

  const reportsFiled = db
    .prepare(
      `SELECT id, target_type, target_id, reason, details, status, created_at
       FROM reports WHERE reporter_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);

  const comments = db
    .prepare(
      `SELECT c.id, b.title AS book, c.body, c.spoiler, c.status, c.created_at
       FROM book_comments c JOIN books b ON b.id = c.book_id
       WHERE c.author_id = ? ORDER BY c.created_at DESC`,
    )
    .all(userId);

  const commentLikes = db
    .prepare(
      `SELECT l.created_at, b.title AS book
       FROM book_comment_likes l
       JOIN book_comments c ON c.id = l.comment_id
       JOIN books b ON b.id = c.book_id
       WHERE l.user_id = ? ORDER BY l.created_at DESC`,
    )
    .all(userId);

  const following = db
    .prepare(
      `SELECT f.created_at, u.name, u.city FROM follows f
       JOIN users u ON u.id = f.followed_id
       WHERE f.follower_id = ? ORDER BY f.created_at DESC`,
    )
    .all(userId);

  const followers = db
    .prepare(
      `SELECT f.created_at, u.name, u.city FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = ? ORDER BY f.created_at DESC`,
    )
    .all(userId);

  const readingLists = db
    .prepare(
      `SELECT id, title, description, created_at FROM reading_lists
       WHERE owner_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);

  const readingListItems = db
    .prepare(
      `SELECT rl.title AS list, b.title AS book, b.author, i.added_at
       FROM reading_list_items i
       JOIN reading_lists rl ON rl.id = i.list_id
       JOIN books b ON b.id = i.book_id
       WHERE rl.owner_id = ? ORDER BY rl.created_at DESC, i.added_at ASC`,
    )
    .all(userId);

  const clubsOwned = db
    .prepare(
      `SELECT id, name, city, description, meets_on, created_at FROM clubs
       WHERE owner_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);

  const clubMemberships = db
    .prepare(
      `SELECT c.name, c.city, m.joined_at FROM club_members m
       JOIN clubs c ON c.id = m.club_id
       WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
    )
    .all(userId);

  return {
    exportedAt: nowIso(),
    // Los mensajes cifrados van como sobre (`ciphertext` + `iv`): solo se
    // pueden leer en el dispositivo que conserva la clave privada.
    encryptionNote:
      "Los mensajes con encrypted = 1 están cifrados de extremo a extremo; el servidor no puede descifrarlos.",
    user,
    listings,
    requests,
    messages,
    messagesReceived,
    favorites,
    bookWants,
    readingStates,
    clubLoans,
    reviewsGiven,
    reviewsReceived,
    notifications,
    blocks,
    reportsFiled,
    comments,
    commentLikes,
    following,
    followers,
    readingLists,
    readingListItems,
    clubsOwned,
    clubMemberships,
    journey: getReaderJourney(userId),
  };
}

