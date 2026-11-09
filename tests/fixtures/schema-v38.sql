-- Esquema real de una base **v38**, volcado con el código de `6fb533b`
-- (`git worktree` + `migrate()` + `.schema`). Es la forma que tenía la base de
-- una instalación el 5-nov-2026, con las tablas que la escalera iba creando y
-- que no aparecen en aquel `SCHEMA_V2`.
--
-- La usa `tests/migrations-data.test.ts` para comprobar que la escalera
-- v39→v48 no pierde ni una fila. No se edita a mano: si hiciera falta otra
-- versión, se vuelve a volcar desde su commit.
--
-- Se omiten `sqlite_sequence` y las tablas internas de FTS5: las crea el motor.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Stuttgart',
  bio TEXT NOT NULL DEFAULT '',
  notifications_seen_at TEXT,
  created_at TEXT NOT NULL
, is_admin INTEGER NOT NULL DEFAULT 0, is_suspended INTEGER NOT NULL DEFAULT 0, email_verified_at TEXT, totp_secret TEXT, totp_enabled_at TEXT, totp_last_step INTEGER, public_key TEXT, public_key_at TEXT, public_key_id TEXT, email_notifications INTEGER NOT NULL DEFAULT 1, locale TEXT NOT NULL DEFAULT 'es');
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT UNIQUE,
  category TEXT NOT NULL,
  cover_url TEXT,
  created_at TEXT NOT NULL
, language TEXT NOT NULL DEFAULT 'No especificado', work_key TEXT);
CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  condition TEXT NOT NULL,
  city TEXT NOT NULL,
  distance_km REAL,
  status TEXT NOT NULL DEFAULT 'available',
  search_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
, notes TEXT NOT NULL DEFAULT '', moderated_from TEXT);
CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, handover_set_at TEXT, owner_confirmed_at TEXT, requester_confirmed_at TEXT, handover_code TEXT, handover_method TEXT NOT NULL DEFAULT 'in_person', ship_number TEXT, ship_station TEXT, ship_postal_code TEXT, ship_city TEXT, ship_set_at TEXT, ship_kind TEXT, ship_street TEXT);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
, ciphertext TEXT, iv TEXT, encrypted INTEGER NOT NULL DEFAULT 0, key_id TEXT);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT REFERENCES listings(id),
  request_id TEXT REFERENCES requests(id),
  created_at TEXT NOT NULL
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX requests_pending_unique
  ON requests(listing_id, requester_id) WHERE status = 'pending';
CREATE INDEX requests_requester ON requests(requester_id, created_at DESC);
CREATE INDEX requests_owner ON requests(owner_id, created_at DESC);
CREATE INDEX requests_listing ON requests(listing_id);
CREATE INDEX messages_request ON messages(request_id, created_at);
CREATE INDEX events_created ON events(created_at DESC);
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE INDEX listings_owner ON listings(owner_id, status);
CREATE INDEX listings_status ON listings(status, created_at DESC);
CREATE INDEX listings_search ON listings(search_key);
CREATE INDEX favorites_listing ON favorites(listing_id);
CREATE INDEX books_title_key ON books(title_key);
CREATE INDEX reports_status ON reports(status, created_at DESC);
CREATE INDEX auth_attempts_key ON auth_attempts(attempt_key, created_at);
CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      listing_id TEXT,
      request_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    , book_id TEXT, link TEXT);
CREATE TABLE admin_audit (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
CREATE TABLE throttle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      throttle_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
CREATE INDEX notifications_user
      ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX throttle_lookup ON throttle(bucket, throttle_key, created_at);
CREATE INDEX throttle_cleanup ON throttle(created_at);
CREATE INDEX requests_status_created ON requests(status, created_at);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE request_reads (
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (request_id, user_id)
    );
CREATE INDEX request_reads_user ON request_reads(user_id);
CREATE INDEX notifications_created ON notifications(created_at);
CREATE VIRTUAL TABLE listings_fts USING fts5(
      search_key,
      content='listings',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
CREATE TRIGGER listings_fts_ai AFTER INSERT ON listings BEGIN
      INSERT INTO listings_fts(rowid, search_key) VALUES (new.rowid, new.search_key);
    END;
CREATE TRIGGER listings_fts_ad AFTER DELETE ON listings BEGIN
      INSERT INTO listings_fts(listings_fts, rowid, search_key)
      VALUES ('delete', old.rowid, old.search_key);
    END;
CREATE TRIGGER listings_fts_au AFTER UPDATE ON listings BEGIN
      INSERT INTO listings_fts(listings_fts, rowid, search_key)
      VALUES ('delete', old.rowid, old.search_key);
      INSERT INTO listings_fts(rowid, search_key) VALUES (new.rowid, new.search_key);
    END;
CREATE TABLE cities (
      name TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
CREATE TABLE city_distances (
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      km REAL NOT NULL,
      PRIMARY KEY (from_name, to_name)
    );
CREATE TABLE account_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
CREATE INDEX account_tokens_user ON account_tokens(user_id, purpose);
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
CREATE TABLE book_comments (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES book_comments(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      spoiler INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL
    );
CREATE INDEX book_comments_thread ON book_comments(book_id, created_at DESC);
CREATE INDEX book_comments_parent ON book_comments(parent_id, created_at);
CREATE INDEX book_comments_author ON book_comments(author_id, created_at DESC);
CREATE TABLE book_comment_likes (
      comment_id TEXT NOT NULL REFERENCES book_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (comment_id, user_id)
    );
CREATE TABLE follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, followed_id)
    );
CREATE INDEX follows_followed ON follows(followed_id, created_at DESC);
CREATE TABLE listing_tags (
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (listing_id, tag)
    );
CREATE INDEX listing_tags_tag ON listing_tags(tag, listing_id);
CREATE TABLE reading_lists (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
CREATE INDEX reading_lists_owner ON reading_lists(owner_id, created_at DESC);
CREATE TABLE reading_list_items (
      list_id TEXT NOT NULL REFERENCES reading_lists(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL,
      PRIMARY KEY (list_id, book_id)
    );
CREATE TABLE clubs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      meets_on TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    , meets_at TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'visible', join_policy TEXT NOT NULL DEFAULT 'open', progress INTEGER NOT NULL DEFAULT 0, progress_note TEXT NOT NULL DEFAULT '', meets_place TEXT NOT NULL DEFAULT '', meets_link TEXT NOT NULL DEFAULT '');
CREATE INDEX clubs_city ON clubs(city, created_at DESC);
CREATE TABLE club_members (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'member', role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (club_id, user_id)
    );
CREATE TABLE IF NOT EXISTS "reviews" (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id),
        target_id TEXT NOT NULL REFERENCES users(id),
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (request_id, author_id)
      );
CREATE INDEX reviews_target ON reviews(target_id, created_at DESC);
CREATE INDEX admin_audit_created ON admin_audit(created_at DESC);
CREATE TABLE availability_alerts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      city TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, city)
    );
CREATE INDEX availability_alerts_city ON availability_alerts(city);
CREATE TABLE mail_outbox (
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
CREATE INDEX mail_outbox_pending ON mail_outbox(status, next_attempt_at);
CREATE INDEX club_members_user ON club_members(user_id, status);
CREATE INDEX clubs_status ON clubs(status, city);
CREATE TABLE club_attendance (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      meets_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (club_id, user_id, meets_key)
    );
CREATE TABLE product_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT,
      club_id TEXT,
      created_at TEXT NOT NULL
    );
CREATE INDEX product_events_type ON product_events(type, created_at DESC);
CREATE TABLE book_wants (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_notified_at TEXT,
      PRIMARY KEY (user_id, book_id)
    );
CREATE INDEX book_wants_book ON book_wants(book_id, user_id);
CREATE INDEX book_wants_user ON book_wants(user_id, created_at DESC);
CREATE TABLE reading_states (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('reading', 'read')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );
CREATE INDEX reading_states_book ON reading_states(book_id, status);
CREATE INDEX reading_states_user ON reading_states(user_id, updated_at DESC);
CREATE TABLE club_loans (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      lender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      borrower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      due_at TEXT,
      returned_at TEXT,
      created_at TEXT NOT NULL
    );
CREATE UNIQUE INDEX club_loans_active_listing
      ON club_loans(listing_id) WHERE returned_at IS NULL;
CREATE INDEX club_loans_club
      ON club_loans(club_id, returned_at, created_at DESC);
CREATE INDEX listings_book ON listings(book_id, status);
CREATE INDEX mail_outbox_to ON mail_outbox(to_email, created_at);
CREATE INDEX admin_audit_target ON admin_audit(action, target_id, created_at DESC);
CREATE INDEX reports_reporter ON reports(reporter_id, target_type, target_id);
CREATE INDEX messages_sender ON messages(sender_id, created_at DESC);
CREATE TABLE public_key_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL,
      public_jwk TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      replaced_at TEXT
    );
CREATE INDEX public_key_history_user
      ON public_key_history(user_id, created_at DESC);
CREATE INDEX books_work_key ON books(work_key);
CREATE TABLE club_posts (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES club_posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL
    );
CREATE INDEX club_posts_thread
      ON club_posts(club_id, created_at DESC);
CREATE INDEX club_posts_parent ON club_posts(parent_id, created_at);
CREATE INDEX club_posts_author ON club_posts(author_id, created_at DESC);
CREATE TABLE club_post_likes (
      post_id TEXT NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );
CREATE TABLE club_polls (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
CREATE INDEX club_polls_club ON club_polls(club_id, created_at DESC);
CREATE TABLE club_poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES club_polls(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0
    );
CREATE INDEX club_poll_options_poll ON club_poll_options(poll_id, position);
CREATE TABLE club_poll_votes (
      poll_id TEXT NOT NULL REFERENCES club_polls(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL REFERENCES club_poll_options(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (poll_id, user_id)
    );
CREATE INDEX club_poll_votes_option ON club_poll_votes(option_id);
CREATE INDEX club_members_role ON club_members(club_id, role);
CREATE TABLE dm_threads (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_message_at TEXT,
      UNIQUE (user_a, user_b)
    );
CREATE TABLE dm_messages (
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
CREATE TABLE dm_reads (
      thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );
CREATE INDEX dm_threads_user_a ON dm_threads(user_a, last_message_at DESC);
CREATE INDEX dm_threads_user_b ON dm_threads(user_b, last_message_at DESC);
CREATE INDEX dm_messages_thread ON dm_messages(thread_id, created_at);
