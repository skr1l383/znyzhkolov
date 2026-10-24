// База даних SQLite. Використовується вбудований у Node.js модуль node:sqlite,
// тому нічого додатково встановлювати не потрібно. Уся база лежить в одному
// файлі data/znyzhkolov.db і зберігається між перезапусками.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  telegram_chat_id   TEXT,
  telegram_username  TEXT,
  telegram_link_code TEXT UNIQUE,
  notify_epic_free   INTEGER NOT NULL DEFAULT 1,
  lang               TEXT NOT NULL DEFAULT 'uk',
  avatar             TEXT,
  share_token        TEXT,
  created_at         TEXT NOT NULL,
  last_login_at      TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  image_url  TEXT,
  created_at TEXT NOT NULL
);

-- Пропозиція гри в конкретному магазині (одна гра може бути в Steam, GOG та Epic).
-- Ціни зберігаються цілими числами в копійках/центах, щоб не було похибок округлення.
CREATE TABLE IF NOT EXISTS offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  store       TEXT NOT NULL CHECK (store IN ('steam', 'gog', 'epic')),
  store_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT,
  image_url   TEXT,
  currency    TEXT,
  price       INTEGER,
  base_price  INTEGER,
  discount    INTEGER NOT NULL DEFAULT 0,
  is_free     INTEGER NOT NULL DEFAULT 0,
  price_uah   INTEGER,
  available   INTEGER NOT NULL DEFAULT 1,
  checked_at  TEXT,
  last_error  TEXT,
  UNIQUE (store, store_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_game ON offers(game_id);

CREATE TABLE IF NOT EXISTS price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id    INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  price       INTEGER,
  base_price  INTEGER,
  discount    INTEGER NOT NULL DEFAULT 0,
  price_uah   INTEGER,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_offer ON price_history(offer_id, recorded_at);

-- Що саме відстежує користувач і за якої умови надсилати сповіщення.
CREATE TABLE IF NOT EXISTS watch_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  min_discount  INTEGER,
  max_price_uah INTEGER,
  notify_free   INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  last_alert_key TEXT,
  last_alert_at TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id       INTEGER REFERENCES games(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  url           TEXT,
  sent_telegram INTEGER NOT NULL DEFAULT 0,
  read_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS epic_freebies (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  url            TEXT,
  image_url      TEXT,
  original_price INTEGER,
  currency       TEXT,
  starts_at      TEXT,
  ends_at        TEXT,
  status         TEXT NOT NULL CHECK (status IN ('current', 'upcoming', 'ended')),
  announced      INTEGER NOT NULL DEFAULT 0,
  first_seen_at  TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Журнал подій: входи, додавання ігор, перевірки цін, помилки, сповіщення.
CREATE TABLE IF NOT EXISTS event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  user_id    INTEGER,
  meta       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON event_log(created_at);

-- Вітрина: популярні ігри зі знижками, оновлюється за розкладом. rank — місце в популярності магазину.
CREATE TABLE IF NOT EXISTS deals (
  store          TEXT NOT NULL,
  store_id       TEXT NOT NULL,
  title          TEXT NOT NULL,
  search_title   TEXT NOT NULL,
  url            TEXT NOT NULL,
  image_url      TEXT,
  image_fallback TEXT,
  currency       TEXT,
  price          INTEGER NOT NULL,
  base_price     INTEGER,
  discount       INTEGER NOT NULL,
  price_uah      INTEGER NOT NULL,
  base_price_uah INTEGER,
  rating         INTEGER,
  rank           INTEGER NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (store, store_id)
);

-- Одноразові ключі з листів: підтвердження пошти (verify) і відновлення пароля (reset).
-- Як і для сесій, у базі лише хеш ключа: навіть маючи копію бази, посилання з листа не підробиш.
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- Тестова поштова скринька: сюди складаються листи, поки не налаштовано поштовий сервіс
CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  text       TEXT NOT NULL,
  kind       TEXT,
  created_at TEXT NOT NULL
);

-- Сторінки ігор: опис, скриншоти, трейлери з магазинів. Кеш на кілька годин, щоб не питати магазини щоразу.
-- Опис і жанри Steam віддає мовою запиту, тому кожна мова інтерфейсу має свій запис.
CREATE TABLE IF NOT EXISTS game_details (
  store      TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'uk',
  data       TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (store, store_id, lang)
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
`;

// Стовпці, додані після першої версії. Бази, створені раніше, отримують їх при запуску,
// і дані користувачів при цьому зберігаються.
const ADDED_COLUMNS = [
  ['users', 'avatar', 'TEXT'],
  ['users', 'share_token', 'TEXT'], // ключ публічного посилання на список гравця
  ['users', 'email_verified_at', 'TEXT'], // коли користувач підтвердив пошту
  ['users', 'notify_email', 'INTEGER NOT NULL DEFAULT 1'], // сповіщення про знижки на пошту
  ['users', 'steam_id', 'TEXT'], // профіль Steam, з якого імпортували список бажаного
  ['notifications', 'sent_email', 'INTEGER NOT NULL DEFAULT 0'],
];

function migrate() {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // ALTER TABLE не вміє додавати UNIQUE, тому унікальність ключа — окремим індексом
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_share_token ON users(share_token)');
  // Ключ кешу сторінок ігор змінився (додалась мова). Це лише кеш — стару таблицю простіше створити заново
  if (!db.prepare('PRAGMA table_info(game_details)').all().some((c) => c.name === 'lang')) {
    db.exec('DROP TABLE game_details');
    db.exec(SCHEMA);
  }
}

/** @type {DatabaseSync} */
export let db;

export function initDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate();
  return db;
}

export function closeDb() {
  try {
    db?.close();
  } catch {
    // база вже закрита
  }
}

export const now = () => new Date().toISOString();

/** Виконує кілька запитів як одну транзакцію: або всі, або жоден. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value == null ? null : String(value), now());
}
