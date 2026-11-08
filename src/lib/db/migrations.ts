/**
 * Migraciones versionadas con `PRAGMA user_version`.
 *
 * Cada función sube la base un escalón y deja `user_version` al día. Nunca se
 * edita una migración ya publicada: se añade la siguiente.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./index";
import { CITIES, cityDistances } from "../cities";
import { CATEGORIES, TAGS } from "../domain";
import { encryptSecret, isEncrypted, shipContext } from "../secret-box";
import { normalizeText } from "../text";
import { workKeyFromTitle } from "../work";
import { INDEXES, LEGACY_UPGRADE, SCHEMA_V2, SCHEMA_VERSION } from "./schema";

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
    ["9788401352836", "Español"],
    ["9788433998873", "Español"],
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
 * v28: historial de claves públicas de cifrado. Permite auditar rotaciones y
 * enseñar en el perfil cuándo cambió la clave.
 */
function migrateToV28(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS public_key_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL,
      public_jwk TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      replaced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS public_key_history_user
      ON public_key_history(user_id, created_at DESC);
  `);

  // Las claves ya publicadas antes de esta migración cuentan como iniciales.
  const existing = db
    .prepare(
      `SELECT id, public_key, public_key_id, COALESCE(public_key_at, created_at) AS at
         FROM users
        WHERE public_key IS NOT NULL AND public_key_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public_key_history h WHERE h.user_id = users.id)`,
    )
    .all() as { id: string; public_key: string; public_key_id: string; at: string }[];
  const insert = db.prepare(
    `INSERT INTO public_key_history (id, user_id, key_id, public_jwk, reason, created_at)
     VALUES (?, ?, ?, ?, 'initial', ?)`,
  );
  db.transaction(() => {
    for (const row of existing) {
      insert.run(`pkh_${randomUUID()}`, row.id, row.public_key_id, row.public_key, row.at);
    }
  })();
  if (existing.length > 0) {
    console.log(`[db] historial de claves iniciado para ${existing.length} cuentas`);
  }
  db.pragma("user_version = 28");
}

/**
 * v29: las portadas pasan a servirse desde `/api/cover/<isbn>`. Antes el
 * navegador las pedía a Open Library, que así recibía la IP de cada lector y el
 * ISBN que estaba mirando. Se reescriben las URL ya guardadas.
 */
function migrateToV29(db: Db) {
  const { changes } = db
    .prepare(
      `UPDATE books
          SET cover_url = '/api/cover/' || isbn
        WHERE isbn IS NOT NULL
          AND cover_url LIKE 'https://covers.openlibrary.org/%'`,
    )
    .run();
  if (changes > 0) {
    console.log(`[db] ${changes} portadas pasan a servirse desde la aplicación`);
  }
  db.pragma("user_version = 29");
}

/**
 * v30: las etiquetas pasan a ser temáticas (Historia, Física, Sociología…).
 * Las que ya no existen —«Firmado», «Novela negra», «Memorias»…— se retiran de
 * los ejemplares para que el filtro no ofrezca etiquetas muertas.
 */
function migrateToV30(db: Db) {
  const allowed = TAGS.map((tag) => `'${tag.replace(/'/g, "''")}'`).join(", ");
  const { changes } = db.prepare(`DELETE FROM listing_tags WHERE tag NOT IN (${allowed})`).run();
  if (changes > 0) {
    console.log(`[db] ${changes} etiquetas antiguas retiradas (ahora son temáticas)`);
  }
  db.pragma("user_version = 30");
}

/**
 * v31: cada libro pasa a tener una **clave de obra**, para que las distintas
 * ediciones del mismo título (otro ISBN, otra editorial) se agrupen: la
 * conversación y los ejemplares son del libro, no de la edición.
 *
 * Se rellena a partir del título y la autoría con la misma fórmula que usa el
 * alta de publicaciones, así que las filas antiguas y las nuevas coinciden.
 */
function migrateToV31(db: Db) {
  const columns = (db.pragma("table_info(books)") as { name: string }[]).map((column) => column.name);
  if (!columns.includes("work_key")) {
    db.exec("ALTER TABLE books ADD COLUMN work_key TEXT");
  }
  const rows = db.prepare("SELECT id, title, author FROM books").all() as {
    id: string;
    title: string;
    author: string;
  }[];
  const update = db.prepare("UPDATE books SET work_key = ? WHERE id = ?");
  const migrate = db.transaction(() => {
    for (const row of rows) update.run(workKeyFromTitle(row.title, row.author), row.id);
  });
  migrate();
  db.exec("CREATE INDEX IF NOT EXISTS books_work_key ON books(work_key)");
  db.pragma("user_version = 31");
}

/**
 * v32: foro propio de cada club.
 *
 * Hasta aquí la conversación del club era «prestada»: se remitía al hilo
 * público del libro, donde se mezclaba con la de toda la plataforma. El club
 * gana un tablón suyo, visible solo para sus miembros, con mensajes, un nivel
 * de respuestas y «me gusta». `status` es la misma paleta que usan los
 * comentarios (`visible` / `deleted` / `hidden`), así que la moderación no
 * necesita un camino nuevo.
 */
function migrateToV32(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS club_posts (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES club_posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS club_posts_thread
      ON club_posts(club_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS club_posts_parent ON club_posts(parent_id, created_at);
    CREATE INDEX IF NOT EXISTS club_posts_author ON club_posts(author_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS club_post_likes (
      post_id TEXT NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );
  `);
  db.pragma("user_version = 32");
}

/**
 * v33: el club aprende a decir **dónde** se ve y a decidir entre todos.
 *
 * - `meets_place` y `meets_link`: el sitio del encuentro (una cafetería, una sala,
 *   un enlace de videollamada). Sin esto el club solo sabía la fecha.
 * - `club_polls` + `club_poll_options` + `club_poll_votes`: una votación de la
 *   próxima lectura. Un voto por persona y votación (la clave primaria lo
 *   garantiza), y se puede cambiar mientras esté abierta.
 */
function migrateToV33(db: Db) {
  const columnas = (db.pragma("table_info(clubs)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columnas.includes("meets_place")) {
    db.exec("ALTER TABLE clubs ADD COLUMN meets_place TEXT NOT NULL DEFAULT ''");
  }
  if (!columnas.includes("meets_link")) {
    db.exec("ALTER TABLE clubs ADD COLUMN meets_link TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS club_polls (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS club_polls_club ON club_polls(club_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS club_poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES club_polls(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS club_poll_options_poll ON club_poll_options(poll_id, position);

    CREATE TABLE IF NOT EXISTS club_poll_votes (
      poll_id TEXT NOT NULL REFERENCES club_polls(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL REFERENCES club_poll_options(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (poll_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS club_poll_votes_option ON club_poll_votes(option_id);
  `);
  db.pragma("user_version = 33");
}

/**
 * v34: cada club puede tener **personas de confianza** que ayuden a llevarlo.
 *
 * `club_members.role` distingue al miembro corriente del moderador: quien
 * aprueba o rechaza las solicitudes de entrada y puede retirar mensajes del
 * foro sin ser quien creó el club. Editar el club, cerrarlo o cederlo sigue
 * siendo exclusivo de su dueño, y la columna se queda en 'member' por defecto
 * para que ninguna fila antigua cambie de significado.
 */
function migrateToV34(db: Db) {
  const columnas = (db.pragma("table_info(club_members)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columnas.includes("role")) {
    db.exec("ALTER TABLE club_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS club_members_role ON club_members(club_id, role);
  `);
  db.pragma("user_version = 34");
}

/**
 * v35: la plataforma se restringe a **Baden-Württemberg**. La lista de ciudades
 * vuelve a ser la de la región (103 municipios) y la matriz de distancias se
 * recalcula solo con ellas. No se borra ningún dato de personas, ejemplares ni
 * clubs: las filas que ya existían con una ciudad de fuera de la región se
 * quedan como están (sin distancia calculable) y, a partir de aquí, la
 * validación de ciudad solo acepta municipios de la lista.
 */
function migrateToV35(db: Db) {
  // Las ciudades de fuera de la región dejan de existir en el catálogo.
  db.exec(`
    DELETE FROM city_distances;
    DELETE FROM cities;
  `);

  const upsertCity = db.prepare("INSERT INTO cities (name, lat, lng) VALUES (?, ?, ?)");
  const upsertDistance = db.prepare(
    "INSERT INTO city_distances (from_name, to_name, km) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    for (const city of CITIES) {
      upsertCity.run(city.name, city.lat, city.lng);
    }
    for (const row of cityDistances()) {
      upsertDistance.run(row.from, row.to, row.km);
    }
  })();

  db.pragma("user_version = 35");
}

/**
 * v36: **mensajes directos cifrados** entre personas que se siguen mutuamente.
 * Un hilo por pareja (con los dos identificadores ordenados, así no hay dos
 * conversaciones espejo) y el mismo sobre cifrado que las conversaciones de un
 * intercambio: el servidor guarda `ciphertext` + `iv` + huella, nunca el texto.
 */
function migrateToV36(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_threads (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_message_at TEXT,
      UNIQUE (user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS dm_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      ciphertext TEXT,
      iv TEXT,
      key_id TEXT,
      encrypted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dm_reads (
      thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS dm_threads_user_a ON dm_threads(user_a, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS dm_threads_user_b ON dm_threads(user_b, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS dm_messages_thread ON dm_messages(thread_id, created_at);
  `);
  db.pragma("user_version = 36");
}

/**
 * v37: entrega por correo.
 *
 * Hasta ahora un intercambio se cerraba en mano en una oficina de Deutsche Post
 * y el código de entrega se enseñaba en pantalla. Con el envío por correo el
 * libro viaja a una Packstation y **el código tiene que ir impreso dentro**, así
 * que la entrega necesita su propio juego de columnas.
 *
 * El número de cliente de DHL (Postnummer) identifica a la persona en la
 * Packstation: se guarda cifrado con `APP_ENCRYPTION_KEY` (igual que el secreto
 * TOTP), porque es un dato personal que no hace falta en claro para nada.
 */
function migrateToV37(db: Db) {
  const columns = (db.pragma("table_info(requests)") as { name: string }[]).map(
    (column) => column.name,
  );
  const add = (name: string, sql: string) => {
    if (columns.includes(name)) return;
    db.exec(`ALTER TABLE requests ADD COLUMN ${sql}`);
  };
  add("handover_method", "handover_method TEXT NOT NULL DEFAULT 'in_person'");
  add("ship_number", "ship_number TEXT");
  add("ship_station", "ship_station TEXT");
  add("ship_postal_code", "ship_postal_code TEXT");
  add("ship_city", "ship_city TEXT");
  add("ship_set_at", "ship_set_at TEXT");
  db.pragma("user_version = 37");
}

/**
 * v38: toda Alemania y envío sin oficinas.
 *
 * 1. El catálogo de ciudades vuelve a ser el de **toda Alemania** (123
 *    municipios con coordenadas) y la matriz de distancias se recalcula.
 * 2. La entrega deja de usar oficinas de Deutsche Post: el libro se envía a una
 *    **Packstation** o a la **dirección** que indique quien lo recibe. Todos los
 *    datos del envío se guardan **cifrados** (`APP_ENCRYPTION_KEY`), también los
 *    que ya estaban guardados en claro.
 */
function migrateToV38(db: Db) {
  db.exec(`
    DELETE FROM city_distances;
    DELETE FROM cities;
  `);

  const upsertCity = db.prepare("INSERT INTO cities (name, lat, lng) VALUES (?, ?, ?)");
  const upsertDistance = db.prepare(
    "INSERT INTO city_distances (from_name, to_name, km) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    for (const city of CITIES) {
      upsertCity.run(city.name, city.lat, city.lng);
    }
    for (const row of cityDistances()) {
      upsertDistance.run(row.from, row.to, row.km);
    }
  })();

  const columns = (db.pragma("table_info(requests)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("ship_kind")) {
    db.exec("ALTER TABLE requests ADD COLUMN ship_kind TEXT");
  }
  if (!columns.includes("ship_street")) {
    db.exec("ALTER TABLE requests ADD COLUMN ship_street TEXT");
  }

  // Los datos de envío que ya existían se cifran ahora (y se marcan como
  // Packstation, que era la única forma de envío que había).
  const filas = db
    .prepare(
      "SELECT id, ship_number, ship_station, ship_postal_code, ship_city, ship_kind FROM requests",
    )
    .all() as {
    id: string;
    ship_number: string | null;
    ship_station: string | null;
    ship_street: string | null;
    ship_postal_code: string | null;
    ship_city: string | null;
    ship_kind: string | null;
  }[];
  const guardar = db.prepare(
    "UPDATE requests SET ship_kind = ?, ship_number = ?, ship_station = ?, ship_postal_code = ?, ship_city = ? WHERE id = ?",
  );
  // Cada campo se cifra atado a su solicitud y a su columna, igual que hace el
  // repositorio: aquí se recoge lo que la v37 guardó en claro.
  const cifrar = (valor: string | null, campo: string, solicitud: string) =>
    valor && !isEncrypted(valor) ? encryptSecret(valor, shipContext(solicitud, campo)) : valor;
  db.transaction(() => {
    for (const fila of filas) {
      if (!fila.ship_number && !fila.ship_street) continue;
      guardar.run(
        fila.ship_kind ?? "packstation",
        cifrar(fila.ship_number, "ship_number", fila.id),
        cifrar(fila.ship_station, "ship_station", fila.id),
        cifrar(fila.ship_postal_code, "ship_postal_code", fila.id),
        cifrar(fila.ship_city, "ship_city", fila.id),
        fila.id,
      );
    }
  })();

  // La oficina de entrega deja de existir. Si el SQLite del sistema no admite
  // `DROP COLUMN`, la columna se queda sin uso (nadie la lee ya).
  try {
    db.exec("ALTER TABLE requests DROP COLUMN handover_office_id");
  } catch {
    // Sin borrar: el código ya no la consulta.
  }

  db.pragma("user_version = 38");
}

/**
 * v39: ficha bibliográfica de la edición y autoría visible en las listas.
 *
 * La DNB (MARC21) da Verlag, Erscheinungsjahr y Reihe: son los datos que
 * convierten una ficha en una «Titelaufnahme» y los que se enseñan en la obra.
 * `show_owner` es la única pieza que decide si el nombre de quien firma una
 * lista aparece en la versión pública: por defecto, no.
 */
function migrateToV39(db: Db) {
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
  const add = (table: string, column: string, ddl: string) => {
    if (!columns(table).includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  };

  add("books", "publisher", "TEXT");
  add("books", "year", "TEXT");
  add("books", "series", "TEXT");
  add("reading_lists", "show_owner", "INTEGER NOT NULL DEFAULT 0");

  db.pragma("user_version = 39");
}

/**
 * v40: una clave de cifrado por dispositivo y un sobre por clave.
 *
 * Hasta aquí una cuenta tenía **una** clave pública: entrar con otro navegador
 * sustituía la anterior y el primero dejaba de leer los mensajes nuevos. Ahora
 * cada dispositivo ocupa una ranura (`web`, `android`) y los mensajes llevan un
 * sobre por cada clave del destinatario, así que los dos leen lo mismo.
 *
 * La clave única anterior era la del navegador: se copia a la ranura `web`.
 * Los mensajes anteriores conservan su único sobre en `ciphertext`/`iv`; los
 * clientes lo aceptan como respaldo y no hace falta reescribirlos.
 */
function migrateToV40(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_keys (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      key_id TEXT NOT NULL,
      public_jwk TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, platform)
    );
    CREATE INDEX IF NOT EXISTS user_keys_user ON user_keys(user_id);

    CREATE TABLE IF NOT EXISTS message_envelopes (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      PRIMARY KEY (message_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS dm_message_envelopes (
      message_id TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      PRIMARY KEY (message_id, key_id)
    );
  `);

  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
  if (!columns("public_key_history").includes("platform")) {
    db.exec("ALTER TABLE public_key_history ADD COLUMN platform TEXT NOT NULL DEFAULT 'web'");
  }

  // La clave única de la versión anterior pasa a ser la del navegador.
  db.prepare(
    `INSERT OR IGNORE INTO user_keys
       (user_id, platform, key_id, public_jwk, created_at, updated_at)
     SELECT id, 'web', public_key_id, public_key,
            COALESCE(public_key_at, created_at),
            COALESCE(public_key_at, created_at)
       FROM users
      WHERE public_key IS NOT NULL AND public_key_id IS NOT NULL`,
  ).run();

  db.pragma("user_version = 40");
}

/**
 * v41: cola de avisos en redes sociales.
 *
 * El bot de Mastodon no publica desde la petición: encola aquí y lo intenta el
 * `after()` (y el cron, si falla). La clave única por red y obra es lo que evita
 * que el mismo libro se anuncie tres veces porque lo pongan tres personas.
 *
 * `attempts`/`next_attempt_at` repiten el esquema de `mail_outbox`, que ya está
 * probado en producción; `external_id`/`external_url` guardan el estado creado
 * para poder borrarlo a mano si hiciera falta.
 */
function migrateToV41(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_outbox (
      id TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      external_id TEXT,
      external_url TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS social_outbox_subject
      ON social_outbox(network, subject);
    CREATE INDEX IF NOT EXISTS social_outbox_pending
      ON social_outbox(status, next_attempt_at);
  `);

  db.pragma("user_version = 41");
}

/**
 * v42: la portada del aviso en Mastodon.
 *
 * La imagen se sube **antes** de encolar el post y su id se guarda aquí: un
 * reintento adjunta el mismo medio en vez de subirlo otra vez, y la imagen que
 * se ve en el estado es la que se decidió al publicar el libro.
 */
function migrateToV42(db: Db) {
  const columns = (db.pragma("table_info(social_outbox)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("media_id")) {
    db.exec("ALTER TABLE social_outbox ADD COLUMN media_id TEXT");
  }
  db.pragma("user_version = 42");
}

/**
 * v43: un aviso por persona y día.
 *
 * `owner_id` guarda quién puso el ejemplar y `day` el día del aviso ya calculado
 * en la zona de la casa (Europe/Berlin), no en UTC: quien publica a las 00:30 en
 * Múnich no debe contar como el día anterior. El índice sostiene la consulta que
 * hace el bot antes de encolar.
 */
function migrateToV43(db: Db) {
  const columns = (db.pragma("table_info(social_outbox)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("owner_id")) {
    db.exec("ALTER TABLE social_outbox ADD COLUMN owner_id TEXT");
  }
  if (!columns.includes("day")) {
    db.exec("ALTER TABLE social_outbox ADD COLUMN day TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS social_outbox_owner_day ON social_outbox(owner_id, day)",
  );
  db.pragma("user_version = 43");
}

/**
 * v44: el ejemplar cambia de manos.
 *
 * Cuando un intercambio se cierra, la fila del ejemplar original queda `given`
 * (es el histórico del intercambio) y quien lo recibe estrena **su propia
 * copia**, en pausa y en su ciudad, para que el libro pueda volver a viajar.
 *
 * `from_listing_id` y `from_request_id` dejan el rastro de por dónde ha pasado
 * la copia, y el índice único impide que un mismo intercambio genere dos
 * herederos (los `NULL` de las copias normales no chocan entre sí: el índice es
 * parcial).
 */
function migrateToV44(db: Db) {
  const columns = (db.pragma("table_info(listings)") as { name: string }[]).map(
    (column) => column.name,
  );
  if (!columns.includes("from_listing_id")) {
    db.exec("ALTER TABLE listings ADD COLUMN from_listing_id TEXT");
  }
  if (!columns.includes("from_request_id")) {
    db.exec("ALTER TABLE listings ADD COLUMN from_request_id TEXT");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS listings_from_request
      ON listings(from_request_id) WHERE from_request_id IS NOT NULL;
  `);
  db.pragma("user_version = 44");
}

/**
 * v45: el bot recuerda a qué estados ha dado «me gusta».
 *
 * Sin esta tabla el bot repetiría la misma publicación cada pasada (y eso sí
 * que parece spam). `status_id` es único por red, así que un estado solo se
 * pulsa una vez; `account_acct` y `created_at` sostienen la regla de «cómo
 * mucho, una vez por cuenta y por día».
 */
function migrateToV45(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_likes (
      id TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      status_id TEXT NOT NULL,
      account_acct TEXT NOT NULL,
      status_url TEXT,
      tag TEXT,
      locale TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (network, status_id)
    );

    CREATE INDEX IF NOT EXISTS social_likes_created ON social_likes(network, created_at);
    CREATE INDEX IF NOT EXISTS social_likes_account ON social_likes(network, account_acct, created_at);
  `);
  db.pragma("user_version = 45");
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
export function migrate(db: Db) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  // SQLite no borra el contenido de una fila eliminada: la marca como libre y
  // la deja en el fichero. Con `secure_delete` los bytes se sobrescriben con
  // ceros, así que un borrado de cuenta o de mensaje no deja rastro en las
  // páginas libres (ni en una copia del .db). Cuesta algo de escritura y esta
  // base es pequeña.
  db.pragma("secure_delete = ON");

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
  if (userVersion(db) < 28) migrateToV28(db);
  if (userVersion(db) < 29) migrateToV29(db);
  if (userVersion(db) < 30) migrateToV30(db);
  if (userVersion(db) < 31) migrateToV31(db);
  if (userVersion(db) < 32) migrateToV32(db);
  if (userVersion(db) < 33) migrateToV33(db);
  if (userVersion(db) < 34) migrateToV34(db);
  if (userVersion(db) < 35) migrateToV35(db);
  if (userVersion(db) < 36) migrateToV36(db);
  if (userVersion(db) < 37) migrateToV37(db);
  if (userVersion(db) < 38) migrateToV38(db);
  if (userVersion(db) < 39) migrateToV39(db);
  if (userVersion(db) < 40) migrateToV40(db);
  if (userVersion(db) < 41) migrateToV41(db);
  if (userVersion(db) < 42) migrateToV42(db);
  if (userVersion(db) < 43) migrateToV43(db);
  if (userVersion(db) < 44) migrateToV44(db);
  if (userVersion(db) < 45) migrateToV45(db);

  backfillSearchKeys(db);
}
