import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { hashPasswordSync } from "./password";
import { CITIES, cityDistances } from "./cities";
import { CATEGORIES } from "./domain";
import { normalizeText } from "./text";

export type Db = Database.Database;

export const SCHEMA_VERSION = 27;

/** Hash fijo de "demo1234": evita ejecutar scrypt al sembrar la base. */
export const DEMO_PASSWORD_HASH =
  "scrypt$d49e6afb0ad4903a878c6d6faf41d56a$06ddfcecfa2aee3f5e525f497285f0ee5b9ae3f8eb61db77c2850a7d7ba536f4f76a8a49ff532277e1c1e553e6906871801eb1bdbb9aef09e8c82fcdb1fb7558";

/** Esquema completo para instalaciones nuevas. */
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Stuttgart',
  bio TEXT NOT NULL DEFAULT '',
  notifications_seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT UNIQUE,
  category TEXT NOT NULL,
  cover_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  condition TEXT NOT NULL,
  city TEXT NOT NULL,
  distance_km REAL,
  status TEXT NOT NULL DEFAULT 'available',
  search_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT REFERENCES listings(id),
  request_id TEXT REFERENCES requests(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** Índices y tablas auxiliares comunes a instalaciones nuevas y migradas. */
const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS requests_pending_unique
  ON requests(listing_id, requester_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS requests_requester ON requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_owner ON requests(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_listing ON requests(listing_id);
CREATE INDEX IF NOT EXISTS messages_request ON messages(request_id, created_at);
CREATE INDEX IF NOT EXISTS events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS listings_owner ON listings(owner_id, status);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_search ON listings(search_key);
CREATE INDEX IF NOT EXISTS favorites_listing ON favorites(listing_id);
CREATE INDEX IF NOT EXISTS books_title_key ON books(title_key);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_attempts_key ON auth_attempts(attempt_key, created_at);
`;

/**
 * Actualiza una base creada con la versión anterior del esquema
 * (user_version = 0): amplía estados admitidos y añade search_key.
 */
const LEGACY_UPGRADE = `
CREATE TABLE listings_v2 (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  condition TEXT NOT NULL,
  city TEXT NOT NULL,
  distance_km REAL,
  status TEXT NOT NULL DEFAULT 'available',
  search_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
INSERT INTO listings_v2 (id, book_id, owner_id, condition, city, distance_km, status, search_key, created_at)
  SELECT id, book_id, owner_id, condition, city, distance_km, status, '', created_at FROM listings;
DROP TABLE listings;
ALTER TABLE listings_v2 RENAME TO listings;

CREATE TABLE requests_v2 (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO requests_v2 (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at)
  SELECT id, listing_id, requester_id, owner_id, message, status, created_at, updated_at FROM requests;
DROP TABLE requests;
ALTER TABLE requests_v2 RENAME TO requests;
`;

const globalForDb = globalThis as unknown as { __book2peerDb?: Db };

function databaseFile(): string {
  return process.env.BOOK2PEER_DB ?? path.join(process.cwd(), ".data", "book2peer.db");
}

function userVersion(db: Db): number {
  return db.pragma("user_version", { simple: true }) as number;
}

function hasLegacyTables(db: Db): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { name: string } | undefined;
  return Boolean(row);
}

function backfillSearchKeys(db: Db) {
  const rows = db
    .prepare(
      `SELECT l.id, b.title, b.author, l.city
       FROM listings l JOIN books b ON b.id = l.book_id
       WHERE l.search_key = ''`,
    )
    .all() as { id: string; title: string; author: string; city: string }[];

  if (rows.length === 0) return;
  const update = db.prepare("UPDATE listings SET search_key = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      update.run(normalizeText(`${row.title} ${row.author} ${row.city}`), row.id);
    }
  })();
}

function migrateToV3(db: Db) {
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);

  const userColumns = columns("users");
  if (!userColumns.includes("is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.includes("is_suspended")) {
    db.exec("ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns("listings").includes("notes")) {
    db.exec("ALTER TABLE listings ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      listing_id TEXT,
      request_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      target_id TEXT NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS throttle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      throttle_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS notifications_user
      ON notifications(user_id, read_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS reviews_target ON reviews(target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS throttle_lookup ON throttle(bucket, throttle_key, created_at);
    CREATE INDEX IF NOT EXISTS throttle_cleanup ON throttle(created_at);
    CREATE INDEX IF NOT EXISTS requests_status_created ON requests(status, created_at);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);

  db.pragma("user_version = 3");
}

/**
 * v4: búsqueda de texto completo, control de mensajes leídos y soporte para
 * moderación reversible (no se destruye el estado de los ejemplares).
 */
function migrateToV4(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_reads (
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (request_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS request_reads_user ON request_reads(user_id);
    CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at);
  `);

  // Índice FTS5 con contenido externo: la fuente de verdad sigue siendo
  // `listings.search_key` y los disparadores la mantienen sincronizada.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS listings_fts USING fts5(
      search_key,
      content='listings',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS listings_fts_ai AFTER INSERT ON listings BEGIN
      INSERT INTO listings_fts(rowid, search_key) VALUES (new.rowid, new.search_key);
    END;

    CREATE TRIGGER IF NOT EXISTS listings_fts_ad AFTER DELETE ON listings BEGIN
      INSERT INTO listings_fts(listings_fts, rowid, search_key)
      VALUES ('delete', old.rowid, old.search_key);
    END;

    CREATE TRIGGER IF NOT EXISTS listings_fts_au AFTER UPDATE ON listings BEGIN
      INSERT INTO listings_fts(listings_fts, rowid, search_key)
      VALUES ('delete', old.rowid, old.search_key);
      INSERT INTO listings_fts(rowid, search_key) VALUES (new.rowid, new.search_key);
    END;
  `);

  db.exec("INSERT INTO listings_fts(listings_fts) VALUES ('rebuild')");
  db.pragma("user_version = 4");
}

/**
 * v5: distancias reales entre barrios. La matriz se calcula al migrar para que
 * el catálogo pueda ordenar por cercania sin funciones trigonométricas en SQL.
 */
function migrateToV5(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cities (
      name TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS city_distances (
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      km REAL NOT NULL,
      PRIMARY KEY (from_name, to_name)
    );
  `);

  const upsertCity = db.prepare(
    "INSERT INTO cities (name, lat, lng) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET lat = excluded.lat, lng = excluded.lng",
  );
  const upsertDistance = db.prepare(
    "INSERT INTO city_distances (from_name, to_name, km) VALUES (?, ?, ?) ON CONFLICT(from_name, to_name) DO UPDATE SET km = excluded.km",
  );

  db.transaction(() => {
    for (const city of CITIES) {
      upsertCity.run(city.name, city.lat, city.lng);
    }
    for (const row of cityDistances()) {
      upsertDistance.run(row.from, row.to, row.km);
    }
  })();

  db.pragma("user_version = 5");
}

/**
 * v6: verificación de correo y recuperación de contraseña. Los tokens se
 * guardan hasheados y son de un solo uso.
 */
function migrateToV6(db: Db) {
  if (!(db.pragma("table_info(users)") as { name: string }[]).some((c) => c.name === "email_verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    // Las cuentas que ya existían se consideran verificadas: no tenían el paso.
    db.exec(
      "UPDATE users SET email_verified_at = created_at WHERE email IS NOT NULL AND is_suspended = 0",
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS account_tokens_user ON account_tokens(user_id, purpose);
    CREATE INDEX IF NOT EXISTS account_tokens_expiry ON account_tokens(expires_at);
  `);

  db.pragma("user_version = 6");
}

/**
 * v7: la plataforma pasa de barrios de Madrid a la región de Baden-Württemberg.
 * Solo se guarda la ciudad: se renombra la columna y se sustituye la matriz de
 * distancias por la de ciudades alemanas.
 */
function migrateToV7(db: Db) {
  db.exec(`
    DROP TABLE IF EXISTS neighborhood_distances;
    DROP TABLE IF EXISTS neighborhoods;

    CREATE TABLE IF NOT EXISTS cities (
      name TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS city_distances (
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      km REAL NOT NULL,
      PRIMARY KEY (from_name, to_name)
    );

    DELETE FROM cities;
    DELETE FROM city_distances;
  `);

  const upsertCity = db.prepare(
    "INSERT INTO cities (name, lat, lng) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET lat = excluded.lat, lng = excluded.lng",
  );
  const upsertDistance = db.prepare(
    "INSERT INTO city_distances (from_name, to_name, km) VALUES (?, ?, ?) ON CONFLICT(from_name, to_name) DO UPDATE SET km = excluded.km",
  );

  db.transaction(() => {
    for (const city of CITIES) {
      upsertCity.run(city.name, city.lat, city.lng);
    }
    for (const row of cityDistances()) {
      upsertDistance.run(row.from, row.to, row.km);
    }
    // La clave de búsqueda incluye la ciudad: se recalcula para todas las filas.
    db.exec("UPDATE listings SET search_key = '', distance_km = NULL");
  })();

  db.pragma("user_version = 7");
}

/**
 * v8: capa social. Los comentarios cuelgan de la **obra** (`books`), no del
 * ejemplar: la conversación sobre un libro sobrevive a que la copia cambie de
 * dueño y se comparte entre todas las ciudades.
 */
function migrateToV8(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_comments (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES book_comments(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      spoiler INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS book_comments_thread ON book_comments(book_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS book_comments_parent ON book_comments(parent_id, created_at);
    CREATE INDEX IF NOT EXISTS book_comments_author ON book_comments(author_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS book_comment_likes (
      comment_id TEXT NOT NULL REFERENCES book_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (comment_id, user_id)
    );
  `);

  // Los avisos de comentarios necesitan apuntar a la obra, no a un ejemplar.
  const notificationColumns = (db.pragma("table_info(notifications)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (notificationColumns.length > 0 && !notificationColumns.includes("book_id")) {
    db.exec("ALTER TABLE notifications ADD COLUMN book_id TEXT");
  }

  db.pragma("user_version = 8");
}

/**
 * v9: grafo social. Seguir a otros lectores permite un muro propio
 * («Siguiendo») sin abrir mensajería libre entre desconocidos.
 */
function migrateToV9(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, followed_id)
    );

    CREATE INDEX IF NOT EXISTS follows_followed ON follows(followed_id, created_at DESC);
  `);

  db.pragma("user_version = 9");
}

/**
 * v10: descubrimiento y vida de club. Etiquetas curadas en los ejemplares,
 * listas de lectura (curaduría compartible) y clubs de lectura por ciudad. La
 * conversación de un club es la del libro en curso: no hay chat paralelo.
 */
function migrateToV10(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_tags (
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (listing_id, tag)
    );

    CREATE INDEX IF NOT EXISTS listing_tags_tag ON listing_tags(tag, listing_id);

    CREATE TABLE IF NOT EXISTS reading_lists (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS reading_lists_owner ON reading_lists(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS reading_list_items (
      list_id TEXT NOT NULL REFERENCES reading_lists(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL,
      PRIMARY KEY (list_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      meets_on TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS clubs_city ON clubs(city, created_at DESC);

    CREATE TABLE IF NOT EXISTS club_members (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (club_id, user_id)
    );
  `);

  db.pragma("user_version = 10");
}

/**
 * v11: cada aviso puede llevar su enlace interno. Así el aviso de «te sigue»
 * lleva al perfil y el de una respuesta, al comentario exacto.
 */
function migrateToV11(db: Db) {
  const columns = (db.pragma("table_info(notifications)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (columns.length > 0 && !columns.includes("link")) {
    db.exec("ALTER TABLE notifications ADD COLUMN link TEXT");
  }
  db.pragma("user_version = 11");
}

/**
 * v12: cada parte de un intercambio puede valorar (antes el UNIQUE estaba en
 * `request_id`, así que solo la primera reseña existía). También guarda el
 * estado previo de un ejemplar retirado por moderación, para restaurarlo tal
 * cual estaba, y acelera la auditoría.
 */
function migrateToV12(db: Db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviews_v12 (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id),
        target_id TEXT NOT NULL REFERENCES users(id),
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (request_id, author_id)
      );
      INSERT OR IGNORE INTO reviews_v12 (id, request_id, author_id, target_id, rating, comment, created_at)
        SELECT id, request_id, author_id, target_id, rating, comment, created_at FROM reviews;
      DROP TABLE reviews;
      ALTER TABLE reviews_v12 RENAME TO reviews;
      CREATE INDEX IF NOT EXISTS reviews_target ON reviews(target_id, created_at DESC);
    `);

    const listingColumns = (db.pragma("table_info(listings)") as { name: string }[]).map(
      (column) => column.name,
    );
    if (!listingColumns.includes("moderated_from")) {
      db.exec("ALTER TABLE listings ADD COLUMN moderated_from TEXT");
    }

    db.exec("CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at DESC)");
  })();

  db.pragma("user_version = 12");
}

/**
 * v13: verificación en dos pasos (TOTP) opcional por cuenta.
 * `totp_secret` se guarda pendiente hasta que se confirma con un código;
 * `totp_last_step` impide reutilizar un código ya consumido.
 */
function migrateToV13(db: Db) {
  const columns = (db.pragma("table_info(users)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("totp_secret")) {
    db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
  }
  if (!columns.includes("totp_enabled_at")) {
    db.exec("ALTER TABLE users ADD COLUMN totp_enabled_at TEXT");
  }
  if (!columns.includes("totp_last_step")) {
    db.exec("ALTER TABLE users ADD COLUMN totp_last_step INTEGER");
  }
  db.pragma("user_version = 13");
}

/**
 * v14: dos cambios de privacidad.
 *
 * - `requests.handover_office_id`: el intercambio ocurre en una oficina de
 *   Deutsche Post (un local público), nunca en una dirección privada.
 * - Mensajería de extremo a extremo: el servidor solo guarda el texto cifrado
 *   (`messages.ciphertext` + `iv`), la clave pública de cada persona sirve para
 *   derivar el secreto compartido y la privada nunca sale del navegador.
 */
function migrateToV14(db: Db) {
  const columnsOf = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);

  const requestColumns = columnsOf("requests");
  if (!requestColumns.includes("handover_office_id")) {
    db.exec("ALTER TABLE requests ADD COLUMN handover_office_id TEXT");
  }
  if (!requestColumns.includes("handover_set_at")) {
    db.exec("ALTER TABLE requests ADD COLUMN handover_set_at TEXT");
  }

  const userColumns = columnsOf("users");
  if (!userColumns.includes("public_key")) {
    db.exec("ALTER TABLE users ADD COLUMN public_key TEXT");
  }
  if (!userColumns.includes("public_key_at")) {
    db.exec("ALTER TABLE users ADD COLUMN public_key_at TEXT");
  }

  const messageColumns = columnsOf("messages");
  if (!messageColumns.includes("ciphertext")) {
    db.exec("ALTER TABLE messages ADD COLUMN ciphertext TEXT");
  }
  if (!messageColumns.includes("iv")) {
    db.exec("ALTER TABLE messages ADD COLUMN iv TEXT");
  }
  if (!messageColumns.includes("encrypted")) {
    db.exec("ALTER TABLE messages ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0");
  }

  db.pragma("user_version = 14");
}

/**
 * v15: avisos de disponibilidad por ciudad. Cada cuenta puede suscribirse a su
 * ciudad y recibe un aviso cuando alguien publica un ejemplar nuevo allí. No
 * hay correo ni notificaciones push: solo la bandeja interna.
 */
function migrateToV15(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS availability_alerts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      city TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, city)
    );
    CREATE INDEX IF NOT EXISTS availability_alerts_city ON availability_alerts(city);
  `);
  db.pragma("user_version = 15");
}

/**
 * v16: huellas de clave de cifrado y bandeja de salida de correo.
 *
 * - `users.public_key_id`: huella SHA-256 de la clave pública publicada; se
 *   usa para saber con qué clave se cifró cada mensaje.
 * - `messages.key_id`: clave del remitente que abrió el sobre.
 * - `mail_outbox`: los enlaces de verificación/recuperación se encolan y un
 *   worker los reintenta; antes se perdían si el proveedor fallaba.
 * - La preferencia `users.email_notifications` se añade en la v17 para no
 *   romper bases que ya habían migrado a la v16.
 */
function migrateToV16(db: Db) {
  const columnsOf = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);

  const userColumns = columnsOf("users");
  if (!userColumns.includes("public_key_id")) {
    db.exec("ALTER TABLE users ADD COLUMN public_key_id TEXT");
  }
  if (!userColumns.includes("email_notifications")) {
    db.exec("ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1");
  }

  const messageColumns = columnsOf("messages");
  if (!messageColumns.includes("key_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN key_id TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox(status, next_attempt_at);
  `);

  db.pragma("user_version = 16");
}

/**
 * v17: preferencia de avisos por correo. Se separó de la v16 para que las
 * bases que ya habían migrado a la v16 recibieran la columna.
 */
function migrateToV17(db: Db) {
  const columns = (db.pragma("table_info(users)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("email_notifications")) {
    db.exec("ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1");
  }
  db.pragma("user_version = 17");
}

/**
 * v18: el intercambio se cierra cuando las dos partes confirman la entrega.
 * Las solicitudes ya completadas se dan por confirmadas por ambas.
 */
function migrateToV18(db: Db) {
  const columns = (db.pragma("table_info(requests)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("owner_confirmed_at")) {
    db.exec("ALTER TABLE requests ADD COLUMN owner_confirmed_at TEXT");
  }
  if (!columns.includes("requester_confirmed_at")) {
    db.exec("ALTER TABLE requests ADD COLUMN requester_confirmed_at TEXT");
  }
  db.prepare(
    `UPDATE requests
        SET owner_confirmed_at = COALESCE(owner_confirmed_at, updated_at),
            requester_confirmed_at = COALESCE(requester_confirmed_at, updated_at)
      WHERE status = 'completed'`,
  ).run();
  db.pragma("user_version = 18");
}

/**
 * v19: los clubes ganan fecha concreta del próximo encuentro, visibilidad
 * moderable, política de entrada, progreso de lectura y asistencia. La
 * pertenencia distingue miembro de solicitud pendiente de aprobación.
 */
function migrateToV19(db: Db) {
  const clubColumns = (db.pragma("table_info(clubs)") as { name: string }[]).map(
    (column) => column.name,
  );
  const addClubColumn = (name: string, definition: string) => {
    if (!clubColumns.includes(name)) {
      db.exec(`ALTER TABLE clubs ADD COLUMN ${name} ${definition}`);
    }
  };
  addClubColumn("meets_at", "TEXT NOT NULL DEFAULT ''");
  addClubColumn("status", "TEXT NOT NULL DEFAULT 'visible'");
  addClubColumn("join_policy", "TEXT NOT NULL DEFAULT 'open'");
  addClubColumn("progress", "INTEGER NOT NULL DEFAULT 0");
  addClubColumn("progress_note", "TEXT NOT NULL DEFAULT ''");

  const memberColumns = (db.pragma("table_info(club_members)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!memberColumns.includes("status")) {
    db.exec("ALTER TABLE club_members ADD COLUMN status TEXT NOT NULL DEFAULT 'member'");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS club_members_user ON club_members(user_id, status);
    CREATE INDEX IF NOT EXISTS clubs_status ON clubs(status, city);
    CREATE TABLE IF NOT EXISTS club_attendance (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      meets_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (club_id, user_id, meets_key)
    );
    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT,
      club_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS product_events_type ON product_events(type, created_at DESC);
  `);

  db.pragma("user_version = 19");
}

/** v20: idioma por cuenta y ciudades de toda Alemania. */
function migrateToV20(db: Db) {
  const columns = (db.pragma("table_info(users)") as { name: string }[]).map((column) => column.name);
  if (!columns.includes("locale")) {
    db.exec("ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'es'");
  }

  // La v7 sembró solo Baden-Württemberg: se añaden las cities nuevas y se
  // recalculan las distancias sin borrar las filas existentes.
  const upsertCity = db.prepare(
    "INSERT INTO cities (name, lat, lng) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET lat = excluded.lat, lng = excluded.lng",
  );
  const upsertDistance = db.prepare(
    "INSERT INTO city_distances (from_name, to_name, km) VALUES (?, ?, ?) ON CONFLICT(from_name, to_name) DO UPDATE SET km = excluded.km",
  );
  db.transaction(() => {
    for (const city of CITIES) {
      upsertCity.run(city.name, city.lat, city.lng);
    }
    for (const row of cityDistances()) {
      upsertDistance.run(row.from, row.to, row.km);
    }
  })();

  db.pragma("user_version = 20");
}

/** v21: cinco categorías principales en lugar de los géneros antiguos. */
function migrateToV21(db: Db) {
  db.exec(`
    UPDATE books SET category = CASE category
      WHEN 'Ensayo' THEN 'Humanidades'
      WHEN 'Narrativa' THEN 'Ficción'
      WHEN 'Fantasía' THEN 'Ficción'
      WHEN 'Poesía' THEN 'Ficción'
      WHEN 'Cómic' THEN 'Ficción'
      WHEN 'Infantil' THEN 'Ficción'
      ELSE category
    END
    WHERE category NOT IN (
      'Humanidades', 'Ciencias y técnica', 'Sociedad y política', 'Biografías', 'Ficción'
    );
  `);
  db.pragma("user_version = 21");
}

/** v22: libros que una persona busca para recibir un aviso local. */
function migrateToV22(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_wants (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_notified_at TEXT,
      PRIMARY KEY (user_id, book_id)
    );
    CREATE INDEX IF NOT EXISTS book_wants_book ON book_wants(book_id, user_id);
    CREATE INDEX IF NOT EXISTS book_wants_user ON book_wants(user_id, created_at DESC);
  `);
  db.pragma("user_version = 22");
}

/** v23: idioma del libro, estados de lectura y código de entrega del intercambio. */
function migrateToV23(db: Db) {
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);

  if (!columns("books").includes("language")) {
    db.exec("ALTER TABLE books ADD COLUMN language TEXT NOT NULL DEFAULT 'No especificado'");
  }
  if (!columns("requests").includes("handover_code")) {
    db.exec("ALTER TABLE requests ADD COLUMN handover_code TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS reading_states (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('reading', 'read')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );
    CREATE INDEX IF NOT EXISTS reading_states_book ON reading_states(book_id, status);
    CREATE INDEX IF NOT EXISTS reading_states_user ON reading_states(user_id, updated_at DESC);
  `);
  db.pragma("user_version = 23");
}

/** v24: idioma de las ediciones de demostración ya sembradas. */
function migrateToV24(db: Db) {
  const languages: Array<[string, string]> = [
    ["9780525559474", "Inglés"],
    ["9788417860790", "Español"],
    ["9781501161933", "Inglés"],
    ["9780399590504", "Inglés"],
    ["9788401352838", "Español"],
    ["9788433998878", "Español"],
  ];
  const update = db.prepare(
    "UPDATE books SET language = ? WHERE isbn = ? AND language = 'No especificado'",
  );
  db.transaction(() => {
    for (const [isbn, language] of languages) update.run(language, isbn);
  })();
  db.pragma("user_version = 24");
}

/** v25: préstamo rotatorio de ejemplares dentro de un club. */
function migrateToV25(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS club_loans (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      lender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      borrower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      due_at TEXT,
      returned_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS club_loans_active_listing
      ON club_loans(listing_id) WHERE returned_at IS NULL;
    CREATE INDEX IF NOT EXISTS club_loans_club
      ON club_loans(club_id, returned_at, created_at DESC);
  `);
  db.pragma("user_version = 25");
}

/**
 * v26: índices que faltaban en caminos calientes (auditoría del 4-nov-2026).
 *
 * - `listings(book_id)`: la ficha de obra, las recomendaciones, la estantería
 *   del perfil y el sitemap filtran por obra; sin índice era un barrido completo.
 * - `mail_outbox(to_email, created_at)`: el tope de 5 correos/hora por dirección
 *   se comprueba en cada aviso.
 * - `admin_audit(action, target_id)`: la lista de cuentas suspendidas busca la
 *   última sanción por persona.
 * - `reports(reporter_id, target_type, target_id)`: evita denuncias duplicadas.
 * - `messages(sender_id)`: métricas de actividad de la comunidad.
 */
function migrateToV26(db: Db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS listings_book ON listings(book_id, status);
    CREATE INDEX IF NOT EXISTS mail_outbox_to ON mail_outbox(to_email, created_at);
    CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(action, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS reports_reporter ON reports(reporter_id, target_type, target_id);
    CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id, created_at DESC);
  `);
  db.pragma("user_version = 26");
}

/**
 * v27: una categoría fuera del catálogo actual deja el libro invisible en todos
 * los filtros. Las bases migradas desde v20 podían conservar textos heredados.
 */
function migrateToV27(db: Db) {
  const allowed = CATEGORIES.map((category) => `'${category.replace(/'/g, "''")}'`).join(", ");
  const { changes } = db
    .prepare(`UPDATE books SET category = ? WHERE category NOT IN (${allowed})`)
    .run(CATEGORIES[CATEGORIES.length - 1]);
  if (changes > 0) {
    console.warn(`[db] ${changes} libros con categoría desconocida normalizados`);
  }
  db.pragma("user_version = 27");
}

/**
 * Bases anteriores a v2 guardaban `neighborhood`; el resto del código usa
 * `city` desde la v7.
 */
function renameLegacyCityColumns(db: Db) {
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
  for (const table of ["users", "listings"]) {
    let names: string[];
    try {
      names = columns(table);
    } catch {
      continue;
    }
    if (names.length === 0) continue;
    if (names.includes("neighborhood") && !names.includes("city")) {
      db.exec(`ALTER TABLE ${table} RENAME COLUMN neighborhood TO city`);
    }
  }
}

function migrate(db: Db) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  if (userVersion(db) >= SCHEMA_VERSION) return;

  renameLegacyCityColumns(db);

  if (userVersion(db) < 2) {
    const legacy = hasLegacyTables(db);

  // Recrear tablas requiere desactivar claves foráneas fuera de la transacción.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      if (legacy) {
        db.exec(LEGACY_UPGRADE);
      } else {
        db.exec(SCHEMA_V2);
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          reporter_id TEXT NOT NULL REFERENCES users(id),
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS blocks (
          blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (blocker_id, blocked_id)
        );
        CREATE TABLE IF NOT EXISTS auth_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attempt_key TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      if (legacy) {
        // La columna solo falta en bases antiguas.
        const hasSeenColumn = (db.pragma("table_info(users)") as { name: string }[]).some(
          (column) => column.name === "notifications_seen_at",
        );
        if (!hasSeenColumn) {
          db.exec("ALTER TABLE users ADD COLUMN notifications_seen_at TEXT");
        }
      }
      db.exec(INDEXES);
      db.pragma("user_version = 2");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  }

  if (userVersion(db) < 3) migrateToV3(db);
  if (userVersion(db) < 4) migrateToV4(db);
  if (userVersion(db) < 5) migrateToV5(db);
  if (userVersion(db) < 6) migrateToV6(db);
  if (userVersion(db) < 7) migrateToV7(db);
  if (userVersion(db) < 8) migrateToV8(db);
  if (userVersion(db) < 9) migrateToV9(db);
  if (userVersion(db) < 10) migrateToV10(db);
  if (userVersion(db) < 11) migrateToV11(db);
  if (userVersion(db) < 12) migrateToV12(db);
  if (userVersion(db) < 13) migrateToV13(db);
  if (userVersion(db) < 14) migrateToV14(db);
  if (userVersion(db) < 15) migrateToV15(db);
  if (userVersion(db) < 16) migrateToV16(db);
  if (userVersion(db) < 17) migrateToV17(db);
  if (userVersion(db) < 18) migrateToV18(db);
  if (userVersion(db) < 19) migrateToV19(db);
  if (userVersion(db) < 20) migrateToV20(db);
  if (userVersion(db) < 21) migrateToV21(db);
  if (userVersion(db) < 22) migrateToV22(db);
  if (userVersion(db) < 23) migrateToV23(db);
  if (userVersion(db) < 24) migrateToV24(db);
  if (userVersion(db) < 25) migrateToV25(db);
  if (userVersion(db) < 26) migrateToV26(db);
  if (userVersion(db) < 27) migrateToV27(db);

  backfillSearchKeys(db);
}

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
  { id: "usr_ana", name: "Ana Martínez", email: "ana@book2peer.test", city: "Stuttgart", bio: "Lectora curiosa de narrativa y ensayo." },
  { id: "usr_clara", name: "Clara Montes", email: "clara@book2peer.test", city: "Stuttgart", bio: "Comparto lo que termino." },
  { id: "usr_diego", name: "Diego Ríos", email: "diego@book2peer.test", city: "Mannheim", bio: "Ensayo, historia y libros subrayados." },
  { id: "usr_lucia", name: "Lucía Prieto", email: "lucia@book2peer.test", city: "Karlsruhe", bio: "Novela contemporánea." },
  { id: "usr_marcos", name: "Marcos Gil", email: "marcos@book2peer.test", city: "Freiburg im Breisgau", bio: "Memorias y biografías." },
  { id: "usr_admin", name: "Equipo Wanderbibliothek", email: "admin@book2peer.test", city: "Stuttgart", bio: "Moderación de la comunidad.", isAdmin: true },
];

const SEED_BOOKS: SeedBook[] = [
  { bookId: "bok_1", listingId: "lst_1", ownerId: "usr_clara", title: "La biblioteca de la medianoche", author: "Matt Haig", isbn: "9780525559474", category: "Ficción", language: "Inglés", condition: "Como nuevo", city: "Stuttgart", distanceKm: null, minutesAgo: 35 },
  { bookId: "bok_2", listingId: "lst_2", ownerId: "usr_diego", title: "El infinito en un junco", author: "Irene Vallejo", isbn: "9788417860790", category: "Humanidades", language: "Español", condition: "Muy buen estado", city: "Mannheim", distanceKm: null, minutesAgo: 180 },
  { bookId: "bok_3", listingId: "lst_3", ownerId: "usr_lucia", title: "Los siete maridos de Evelyn Hugo", author: "Taylor Jenkins Reid", isbn: "9781501161933", category: "Ficción", language: "Inglés", condition: "Como nuevo", city: "Karlsruhe", distanceKm: null, minutesAgo: 420 },
  { bookId: "bok_4", listingId: "lst_4", ownerId: "usr_marcos", title: "Una educación", author: "Tara Westover", isbn: "9780399590504", category: "Biografías", language: "Inglés", condition: "Buen estado", city: "Freiburg im Breisgau", distanceKm: null, minutesAgo: 900 },
  { bookId: "bok_5", listingId: "lst_5", ownerId: "usr_clara", title: "El nombre del viento", author: "Patrick Rothfuss", isbn: "9788401352838", category: "Ficción", language: "Español", condition: "Con señales de uso", city: "Stuttgart", distanceKm: null, minutesAgo: 1500 },
  { bookId: "bok_6", listingId: "lst_6", ownerId: "usr_lucia", title: "Poeta chileno", author: "Alejandro Zambra", isbn: "9788433998878", category: "Ficción", language: "Español", condition: "Muy buen estado", city: "Heidelberg", distanceKm: null, minutesAgo: 2600 },
];

/**
 * Los datos de demostración (con contraseña pública) solo se siembran en
desarrollo
 * o con `SEED_DEMO=1` explícito. En producción nunca: dejaría cuentas —incluida
 * una de administración— abiertas a cualquiera.
 */
function shouldSeedDemo(): boolean {
  const flag = process.env.SEED_DEMO;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/** Primer administrador sin interfaz: `ADMIN_EMAIL` + `ADMIN_PASSWORD` (>= 12). */
function ensureInitialAdmin(db: Db) {
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

function seed(db: Db) {
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
        `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`,
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
  })();
}

export function getDb(): Db {
  if (!globalForDb.__book2peerDb) {
    const file = databaseFile();
    if (file !== ":memory:") {
      const dir = path.dirname(file);
      mkdirSync(dir, { recursive: true });
      restrictPermissions(dir, 0o700);
    }
    const db = new Database(file);
    if (file !== ":memory:") {
      // La base guarda hashes de contraseña y sesiones: solo el usuario del
      // proceso debe poder leerla.
      for (const suffix of ["", "-wal", "-shm"]) {
        restrictPermissions(`${file}${suffix}`, 0o600);
      }
    }
    migrate(db);
    if (shouldSeedDemo()) seed(db);
    ensureInitialAdmin(db);
    globalForDb.__book2peerDb = db;
  }
  return globalForDb.__book2peerDb;
}

function restrictPermissions(target: string, mode: number) {
  try {
    chmodSync(target, mode);
  } catch {
    // En sistemas de archivos sin permisos POSIX (o en Windows) se ignora.
  }
}

/** Solo para pruebas: permite reiniciar la conexión en memoria. */
export function resetDbForTests() {
  globalForDb.__book2peerDb?.close();
  globalForDb.__book2peerDb = undefined;
}
