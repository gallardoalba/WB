import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { NotificationView } from "../domain";
import { DEFAULT_LOCALE, translate, type Locale } from "../i18n";
import { normalizeLocale } from "../locale";
import { localizeNotification } from "../notification-locale";
import { enqueueMail } from "../outbox";
import { siteUrl } from "../site";
import { nowIso } from "./shared";

/** Avisos que también generan un correo (con tope por hora). */
const EMAIL_NOTIFICATION_TYPES = new Set<NotificationView["type"]>([
  "message",
  "request",
  "accepted",
  "declined",
  "completed",
  "availability",
  "want",
  "review",
  "comment",
  "follow",
  "security",
]);

export function notify(input: {
  userId: string;
  type: NotificationView["type"];
  title: string;
  body?: string;
  listingId?: string | null;
  requestId?: string | null;
  bookId?: string | null;
  link?: string | null;
}): void {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    const row = getDb()
      .prepare("SELECT locale FROM users WHERE id = ?")
      .get(input.userId) as { locale: string } | undefined;
    locale = normalizeLocale(row?.locale);
  } catch {
    // Si falla la lectura, el aviso se guarda en el idioma base.
  }
  const localized = localizeNotification(locale, input.title, input.body ?? "");

  getDb()
    .prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, listing_id, request_id, book_id, link, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .run(
      `ntf_${randomUUID()}`,
      input.userId,
      input.type,
      localized.title,
      localized.body,
      input.listingId ?? null,
      input.requestId ?? null,
      input.bookId ?? null,
      input.link ?? null,
    );

  enqueueNotificationEmail({ ...input, title: localized.title, body: localized.body }, locale);
}

function enqueueNotificationEmail(
  input: Parameters<typeof notify>[0] & { title: string; body: string },
  locale: Locale,
): void {
  if (!EMAIL_NOTIFICATION_TYPES.has(input.type)) return;
  try {
    const db = getDb();
    const recipient = db
      .prepare("SELECT email, email_notifications FROM users WHERE id = ?")
      .get(input.userId) as { email: string; email_notifications: number } | undefined;
    if (!recipient || recipient.email_notifications === 0) return;
    // Tope anti-spam: como mucho 5 correos por hora y dirección.
    const recent = db
      .prepare(
        `SELECT COUNT(*) AS count FROM mail_outbox
          WHERE to_email = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`,
      )
      .get(recipient.email) as { count: number };
    if (recent.count >= 5) return;

    const link = input.link ? `${siteUrl()}${input.link}` : siteUrl();
    enqueueMail({
      to: recipient.email,
      subject: `Wanderbibliothek · ${input.title}`,
      text: `${input.body ?? input.title}\n\n${link}\n\n${translate(locale, "Puedes desactivar estos correos en tu perfil.")}`,
    });
  } catch (error) {
    // Un fallo al encolar nunca debe tumbar la acción principal.
    console.error("[notifications] no se pudo encolar el correo", error);
  }
}

export function listNotifications(
  userId: string,
  options: { limit?: number; offset?: number } = {},
): NotificationView[] {
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const rows = getDb()
    .prepare(
      `SELECT id, type, title, body, listing_id, request_id, book_id, link, read_at, created_at
       FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as {
    id: string;
    type: NotificationView["type"];
    title: string;
    body: string;
    listing_id: string | null;
    request_id: string | null;
    book_id: string | null;
    link: string | null;
    read_at: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    listingId: row.listing_id,
    requestId: row.request_id,
    bookId: row.book_id,
    link: row.link,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export function countUnreadNotifications(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL")
    .get(userId) as { count: number };
  return row.count;
}

export function markNotificationsRead(userId: string): void {
  getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .run(nowIso(), userId);
}

/** Marca un aviso concreto (solo si es de esa persona). */
export function markNotificationRead(userId: string, notificationId: string): boolean {
  const { changes } = getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL")
    .run(nowIso(), notificationId, userId);
  return changes > 0;
}

/** Borra un aviso propio. */
export function deleteNotification(userId: string, notificationId: string): void {
  const { changes } = getDb()
    .prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?")
    .run(notificationId, userId);
  if (changes === 0) throw new ApiError(404, "El aviso no existe.");
}

export function listingTitle(listingId: string): string {
  const row = getDb()
    .prepare("SELECT b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = ?")
    .get(listingId) as { title: string } | undefined;
  return row?.title ?? "un libro";
}
