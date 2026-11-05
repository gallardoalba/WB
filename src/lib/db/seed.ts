/**
 * Datos de demostración y cuenta de administración inicial.
 *
 * Solo se usan en desarrollo o con `SEED_DEMO=1`; nunca en producción con
 * datos reales.
 */
import { randomUUID } from "node:crypto";
import { hashPasswordSync } from "../password";
import { coverFromIsbn, normalizeText } from "../text";
import type { Db } from "./index";

export const DEMO_PASSWORD_HASH =
  "scrypt$d49e6afb0ad4903a878c6d6faf41d56a$06ddfcecfa2aee3f5e525f497285f0ee5b9ae3f8eb61db77c2850a7d7ba536f4f76a8a49ff532277e1c1e553e6906871801eb1bdbb9aef09e8c82fcdb1fb7558";


type SeedBook = {
  bookId: string;
  listingId: string;
  ownerId: string;
  title: string;
  author: string;
  isbn: string;
  category: string;
  language: string;
  condition: string;
  city: string;
  distanceKm: number | null;
  minutesAgo: number;
};

const SEED_USERS = [
  { id: "usr_ana", name: "Ana Martínez", email: "ana@wanderbibliothek.test", city: "Stuttgart", bio: "Lectora curiosa de narrativa y ensayo." },
  { id: "usr_clara", name: "Clara Montes", email: "clara@wanderbibliothek.test", city: "Stuttgart", bio: "Comparto lo que termino." },
  { id: "usr_diego", name: "Diego Ríos", email: "diego@wanderbibliothek.test", city: "Mannheim", bio: "Ensayo, historia y libros subrayados." },
  { id: "usr_lucia", name: "Lucía Prieto", email: "lucia@wanderbibliothek.test", city: "Karlsruhe", bio: "Novela contemporánea." },
  { id: "usr_marcos", name: "Marcos Gil", email: "marcos@wanderbibliothek.test", city: "Freiburg im Breisgau", bio: "Memorias y biografías." },
  { id: "usr_admin", name: "Equipo Wanderbibliothek", email: "admin@wanderbibliothek.test", city: "Stuttgart", bio: "Moderación de la comunidad.", isAdmin: true },
];

const SEED_BOOKS: SeedBook[] = [
  {
    bookId: "bok_1",
    listingId: "lst_1",
    ownerId: "usr_clara",
    title: "Der eindimensionale Mensch",
    author: "Herbert Marcuse",
    isbn: "9783866742390",
    category: "Sociedad y política",
    language: "Alemán",
    condition: "Como nuevo",
    city: "Stuttgart",
    distanceKm: null,
    minutesAgo: 35,
  },
  {
    bookId: "bok_2",
    listingId: "lst_2",
    ownerId: "usr_diego",
    title: "Triebstruktur und Gesellschaft",
    author: "Herbert Marcuse",
    isbn: "9783518244043",
    category: "Sociedad y política",
    language: "Alemán",
    condition: "Muy buen estado",
    city: "Mannheim",
    distanceKm: null,
    minutesAgo: 180,
  },
  {
    bookId: "bok_3",
    listingId: "lst_3",
    ownerId: "usr_lucia",
    title: "Die Antiquiertheit des Menschen I",
    author: "Günther Anders",
    isbn: "9783406853388",
    category: "Humanidades",
    language: "Alemán",
    condition: "Como nuevo",
    city: "Karlsruhe",
    distanceKm: null,
    minutesAgo: 420,
  },
  {
    bookId: "bok_4",
    listingId: "lst_4",
    ownerId: "usr_marcos",
    title: "Die Antiquiertheit des Menschen II",
    author: "Günther Anders",
    isbn: "9783406832154",
    category: "Humanidades",
    language: "Alemán",
    condition: "Buen estado",
    city: "Freiburg im Breisgau",
    distanceKm: null,
    minutesAgo: 900,
  },
  {
    bookId: "bok_5",
    listingId: "lst_5",
    ownerId: "usr_clara",
    title: "Staatlichkeit und Anarchie und andere Schriften",
    author: "Michail Bakunin",
    isbn: "3548028462",
    category: "Sociedad y política",
    language: "Alemán",
    condition: "Con señales de uso",
    city: "Stuttgart",
    distanceKm: null,
    minutesAgo: 1500,
  },
  {
    bookId: "bok_6",
    listingId: "lst_6",
    ownerId: "usr_lucia",
    title: "Gott und der Staat",
    author: "Michail Bakunin",
    isbn: "9783847850793",
    category: "Sociedad y política",
    language: "Alemán",
    condition: "Muy buen estado",
    city: "Heidelberg",
    distanceKm: null,
    minutesAgo: 2600,
  },
];

/**
 * Los datos de demostración (con contraseña pública) solo se siembran en
desarrollo
 * o con `SEED_DEMO=1` explícito. En producción nunca: dejaría cuentas —incluida
 * una de administración— abiertas a cualquiera.
 */
export function shouldSeedDemo(): boolean {
  const flag = process.env.SEED_DEMO;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/** Primer administrador sin interfaz: `ADMIN_EMAIL` + `ADMIN_PASSWORD` (>= 12). */
export function ensureInitialAdmin(db: Db) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) {
    console.warn("[db] ADMIN_PASSWORD debe tener al menos 12 caracteres: no se creó el administrador.");
    return;
  }
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return;
  if (db.prepare("SELECT 1 FROM users WHERE is_admin = 1").get()) return;

  const now = (db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS ts").get() as {
    ts: string;
  }).ts;
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, city, bio, is_admin, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)",
  ).run(
    `usr_${randomUUID()}`,
    "Administración",
    email,
    hashPasswordSync(password),
    "Stuttgart",
    now,
    now,
  );
  console.log("[db] administrador inicial creado para", email);
}

/** Próximo encuentro del club de ejemplo: dentro de dos semanas, a las 19:00. */
const seedMeeting = new Date(Date.now() + 14 * 86_400_000).toISOString();

export function seed(db: Db) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count > 0) return;

  // El reloj lo aporta SQLite: evita `new Date()` en el camino de render.
  const clock = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) AS ts");
  const isoAgo = (minutes: number) => (clock.get(`-${minutes} minutes`) as { ts: string }).ts;

  const password = DEMO_PASSWORD_HASH;

  db.transaction(() => {
    // Las cuentas de demostración nacen con el correo ya confirmado.
    const insertUser = db.prepare(
      "INSERT INTO users (id, name, email, password_hash, city, bio, is_admin, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const user of SEED_USERS) {
      const createdAt = isoAgo(60 * 24 * 30);
      insertUser.run(
        user.id,
        user.name,
        user.email,
        password,
        user.city,
        user.bio,
        "isAdmin" in user && user.isAdmin ? 1 : 0,
        createdAt,
        createdAt,
      );
    }

    const insertBook = db.prepare(
      "INSERT INTO books (id, title, title_key, author, isbn, category, language, cover_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertListing = db.prepare(
      `INSERT INTO listings (id, book_id, owner_id, condition, city, distance_km, status, search_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?)`,
    );
    const insertEvent = db.prepare(
      "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    );

    for (const book of SEED_BOOKS) {
      const createdAt = isoAgo(book.minutesAgo);
      insertBook.run(
        book.bookId,
        book.title,
        normalizeText(book.title),
        book.author,
        book.isbn,
        book.category,
        book.language,
        // Se sirve desde la propia app: la CSP no permite imágenes de terceros.
        coverFromIsbn(book.isbn),
        createdAt,
      );
      insertListing.run(
        book.listingId,
        book.bookId,
        book.ownerId,
        book.condition,
        book.city,
        book.distanceKm,
        normalizeText(`${book.title} ${book.author} ${book.city}`),
        createdAt,
      );
      insertEvent.run(`evt_seed_${book.listingId}`, "published", book.ownerId, book.listingId, createdAt);
    }

    db.prepare("INSERT INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)").run(
      "usr_ana",
      "lst_2",
      isoAgo(50),
    );

    const completedAt = isoAgo(60 * 24 * 6);
    db.prepare(
      "INSERT INTO requests (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)",
    ).run("req_seed_1", "lst_6", "usr_ana", "usr_lucia", "¿Te viene bien quedar el sábado?", isoAgo(60 * 24 * 9), completedAt);
    db.prepare("UPDATE listings SET status = 'given' WHERE id = ?").run("lst_6");
    db.prepare(
      "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, 'completed', ?, ?, ?, ?)",
    ).run("evt_seed_completed", "usr_lucia", "lst_6", "req_seed_1", completedAt);

    // Una valoración de ejemplo para que el perfil público muestre la sección.
    db.prepare(
      "INSERT INTO reviews (id, request_id, author_id, target_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "rev_seed_1",
      "req_seed_1",
      "usr_ana",
      "usr_lucia",
      5,
      "Todo perfecto: el libro estaba como nuevo y quedamos en cinco minutos.",
      completedAt,
    );
    db.prepare(
      "INSERT INTO notifications (id, user_id, type, title, body, listing_id, request_id, read_at, created_at) VALUES (?, ?, 'review', ?, ?, ?, ?, ?, ?)",
    ).run(
      "ntf_seed_review",
      "usr_lucia",
      "Nueva valoración",
      "Ana Martínez te ha valorado con 5/5.",
      "lst_6",
      "req_seed_1",
      null,
      completedAt,
    );

    const requestedAt = isoAgo(70);
    db.prepare(
      "INSERT INTO requests (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
    ).run("req_seed_2", "lst_1", "usr_diego", "usr_clara", "Me interesa mucho, ¿sigue disponible?", requestedAt, requestedAt);
    db.prepare(
      "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, 'requested', ?, ?, ?, ?)",
    ).run("evt_seed_requested", "usr_diego", "lst_1", "req_seed_2", requestedAt);

    // Conversación de ejemplo: el hilo pertenece a la obra, así que se comparte
    // entre todas las copias de ese título.
    const insertComment = db.prepare(
      `INSERT INTO book_comments (id, book_id, author_id, parent_id, body, spoiler, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'visible', ?)`,
    );
    insertComment.run(
      "cmt_seed_1",
      "bok_2",
      "usr_ana",
      null,
      "Lo empecé por recomendación de una amiga y me está costando soltarlo: la parte de los bibliotecarios es arqueología pura del libro.",
      0,
      isoAgo(320),
    );
    insertComment.run(
      "cmt_seed_2",
      "bok_2",
      "usr_clara",
      "cmt_seed_1",
      "Me pasó igual. Si te engancha, busca «La gran invención» después: es el complemento perfecto.",
      0,
      isoAgo(240),
    );
    insertComment.run(
      "cmt_seed_3",
      "bok_1",
      "usr_diego",
      null,
      "Aviso de spoiler sobre el final: mejor llegar sin leer reseñas largas.",
      1,
      isoAgo(120),
    );
    db.prepare(
      "INSERT INTO book_comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)",
    ).run("cmt_seed_1", "usr_clara", isoAgo(300));

    // Un par de seguimientos para que el muro «Siguiendo» tenga contenido.
    const insertFollow = db.prepare(
      "INSERT INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)",
    );
    insertFollow.run("usr_ana", "usr_clara", isoAgo(600));
    insertFollow.run("usr_ana", "usr_diego", isoAgo(500));
    insertFollow.run("usr_clara", "usr_ana", isoAgo(400));

    // Club de lectura de ejemplo: sin esto, la función más social de la
    // plataforma no aparecía en una instalación de demostración y no había
    // forma de verla (ni de probarla de punta a punta).
    db.prepare(
      `INSERT INTO clubs (id, owner_id, name, city, description, book_id, meets_on, meets_at,
                          meets_place, meets_link, join_policy, progress, progress_note,
                          status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'open', 40, ?, 'visible', ?)`,
    ).run(
      "clb_seed_1",
      "usr_clara",
      "Los martes de la biblioteca",
      "Stuttgart",
      "Narrativa contemporánea, un libro al mes y una cita que no se negocia.",
      "bok_1",
      "Último martes del mes, 19:00",
      seedMeeting,
      "Cafetería del Stadtmuseum, mesa larga",
      "Vamos por la mitad",
      isoAgo(900),
    );

    const insertMember = db.prepare(
      "INSERT INTO club_members (club_id, user_id, joined_at, status) VALUES (?, ?, ?, ?)",
    );
    insertMember.run("clb_seed_1", "usr_clara", isoAgo(900), "member");
    insertMember.run("clb_seed_1", "usr_ana", isoAgo(860), "member");
    insertMember.run("clb_seed_1", "usr_lucia", isoAgo(720), "member");
    insertMember.run("clb_seed_1", "usr_marcos", isoAgo(300), "pending");

    db.prepare(
      "INSERT INTO club_attendance (club_id, user_id, meets_key, created_at) VALUES (?, ?, ?, ?)",
    ).run("clb_seed_1", "usr_ana", seedMeeting, isoAgo(200));
    db.prepare(
      "INSERT INTO club_attendance (club_id, user_id, meets_key, created_at) VALUES (?, ?, ?, ?)",
    ).run("clb_seed_1", "usr_clara", seedMeeting, isoAgo(180));

    // Foro del club: dos mensajes y una respuesta, para ver el tablón vivo.
    const insertPost = db.prepare(
      `INSERT INTO club_posts (id, club_id, author_id, parent_id, body, status, created_at)
       VALUES (?, 'clb_seed_1', ?, ?, ?, 'visible', ?)`,
    );
    insertPost.run(
      "cpost_seed_1",
      "usr_clara",
      null,
      "Empezamos el martes: los seis primeros capítulos. ¿Nos traemos cada una una cita que nos haya llamado la atención?",
      isoAgo(400),
    );
    insertPost.run(
      "cpost_seed_2",
      "usr_ana",
      "cpost_seed_1",
      "Me parece bien. Yo llevo una del segundo que no me puedo quitar de la cabeza.",
      isoAgo(320),
    );
    insertPost.run(
      "cpost_seed_3",
      "usr_lucia",
      null,
      "Propongo que el siguiente sea de no ficción: nos toca salir de la novela un poco.",
      isoAgo(150),
    );

    db.prepare(
      "INSERT INTO club_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
    ).run("cpost_seed_1", "usr_lucia", isoAgo(300));

    // Votación abierta de la próxima lectura, con un voto ya emitido.
    db.prepare(
      "INSERT INTO club_polls (id, club_id, question, created_at, closed_at) VALUES (?, 'clb_seed_1', ?, ?, NULL)",
    ).run("poll_seed_1", "¿Qué leemos después?", isoAgo(140));
    const insertOption = db.prepare(
      "INSERT INTO club_poll_options (id, poll_id, book_id, position) VALUES (?, 'poll_seed_1', ?, ?)",
    );
    insertOption.run("opt_seed_1", "bok_3", 0);
    insertOption.run("opt_seed_2", "bok_4", 1);
    db.prepare(
      "INSERT INTO club_poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)",
    ).run("poll_seed_1", "usr_ana", "opt_seed_1", isoAgo(120));
  })();
}
