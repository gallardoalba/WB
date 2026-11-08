/**
 * Esquema base y declaraciones de la base de datos.
 *
 * Separado de `migrations.ts` a propósito: aquí vive el estado **final** que
 * ven las instalaciones nuevas (`SCHEMA_V2` + `INDEXES`), y allí la escalera
 * que lleva a las instalaciones antiguas hasta ese mismo estado.
 */

export const SCHEMA_VERSION = 41;

/** Hash fijo de "demo1234": evita ejecutar scrypt al sembrar la base. */
export const DEMO_PASSWORD_HASH =
  "scrypt$d49e6afb0ad4903a878c6d6faf41d56a$06ddfcecfa2aee3f5e525f497285f0ee5b9ae3f8eb61db77c2850a7d7ba536f4f76a8a49ff532277e1c1e553e6906871801eb1bdbb9aef09e8c82fcdb1fb7558";


export const SCHEMA_V2 = `
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
export const INDEXES = `
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
export const LEGACY_UPGRADE = `
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
