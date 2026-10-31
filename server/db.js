// База даних SQLite. Використовується вбудований у Node.js модуль node:sqlite,
// тому нічого додатково встановлювати не потрібно. Уся база лежить в одному
// файлі data/znyzhkolov.db і зберігається між перезапусками.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Таблиця пропозицій окремо: при міграції її створюємо заново під іншим ім'ям
const offersTable = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  store       TEXT NOT NULL CHECK (store IN ('steam', 'gog', 'epic', 'keys')),
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
  seller      TEXT,
  UNIQUE (store, store_id)
);`;

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
-- keys — найдешевший ключ Steam в офіційних магазинах (seller — який саме магазин).
-- Ціни зберігаються цілими числами в копійках/центах, щоб не було похибок округлення.
${offersTable('offers')}
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

-- Ціни вітрини по днях (одна найнижча за добу) — з них рахуємо «історичний мінімум».
-- На відміну від deals, рядки не видаляються, коли гра зникає з вітрини.
CREATE TABLE IF NOT EXISTS deal_prices (
  store    TEXT NOT NULL,
  store_id TEXT NOT NULL,
  day      TEXT NOT NULL,
  currency TEXT,
  price    INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store, store_id, day)
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

-- Коментарі до ігор. Гра визначається сторінкою гри: Steam, якщо гра там є, інакше GOG.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  store      TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_game ON comments(store, store_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);

-- Пристрої, на які людина дозволила пуш-сповіщення: адреса сервісу сповіщень браузера і ключі шифрування.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Ігри з бажаного Steam, які синхронізація вже бачила: їх не додаємо повторно, навіть якщо людина прибрала гру зі списку.
CREATE TABLE IF NOT EXISTS steam_sync_seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id  TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
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
  ['users', 'name_key', 'TEXT'], // нік у нижньому регістрі — для входу за ніком і перевірки, що він вільний
  ['notifications', 'sent_email', 'INTEGER NOT NULL DEFAULT 0'],
  ['deals', 'genres', 'TEXT'], // жанри вітрини у вигляді ",action,rpg," — так їх зручно шукати через LIKE
  ['deals', 'companies', 'TEXT'], // розробники й видавці, по одному в рядку
  ['deals', 'hero_url', 'TEXT'], // широка картинка для банера на головній
  ['users', 'google_sub', 'TEXT'], // незмінний ідентифікатор акаунта Google — для входу через Google
  ['deals', 'hero_small_url', 'TEXT'], // легша картинка банера для телефона (у 3–4 рази менша)
  ['notifications', 'image_url', 'TEXT'], // обкладинка гри в списку сповіщень (для роздач Epic іншої немає)
  ['notifications', 'sent_push', 'INTEGER NOT NULL DEFAULT 0'], // скільком пристроям доставлено пуш
  ['users', 'steam_sync', 'INTEGER NOT NULL DEFAULT 0'], // автоматично додавати нові ігри з бажаного Steam
  ['users', 'steam_sync_discount', 'INTEGER'], // з якою умовою знижки їх додавати
  ['users', 'steam_synced_at', 'TEXT'],
  ['users', 'notify_digest', 'INTEGER NOT NULL DEFAULT 1'], // тижневий дайджест щонеділі
  ['users', 'digest_sent_at', 'TEXT'],
];

/** Нік для порівняння: без пробілів на краях і без різниці в регістрі (і для кирилиці). */
export const nameKey = (name) => String(name).trim().toLocaleLowerCase('uk');

function migrate() {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // ALTER TABLE не вміє додавати UNIQUE, тому унікальність ключа — окремим індексом
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_share_token ON users(share_token)');
  // Нік — логін нарівні з поштою, тому унікальний без різниці в регістрі. COLLATE NOCASE у SQLite
  // знає лише латиницю («САША» ≠ «Саша»), тож порівнюємо окремий стовпець, обчислений у JavaScript.
  const update = db.prepare('UPDATE users SET name_key = ? WHERE id = ?');
  for (const u of db.prepare('SELECT id, name FROM users WHERE name_key IS NULL').all()) update.run(nameKey(u.name), u.id);
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_key ON users(name_key)');
  } catch {
    // однакові ніки з часів до цього правила — нові однакові не пропустить код реєстрації й профілю
  }
  // Магазин keys з'явився пізніше. CHECK у SQLite не змінити, тому таблицю пропозицій переносимо в нову
  // з тими самими id — історія цін і зв'язки з іграми зберігаються.
  if (!/'keys'/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'offers'").get().sql)) {
    const cols = db.prepare('PRAGMA table_info(offers)').all().map((c) => c.name).join(', ');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`BEGIN;
        ${offersTable('offers_new')}
        INSERT INTO offers_new (${cols}) SELECT ${cols} FROM offers;
        DROP TABLE offers;
        ALTER TABLE offers_new RENAME TO offers;
        CREATE INDEX IF NOT EXISTS idx_offers_game ON offers(game_id);
        COMMIT;`);
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // транзакція вже завершилась
      }
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  // Ключ кешу сторінок ігор змінився (додалась мова). Це лише кеш — стару таблицю простіше створити заново
  if (!db.prepare('PRAGMA table_info(game_details)').all().some((c) => c.name === 'lang')) {
    db.exec('DROP TABLE game_details');
    db.exec(SCHEMA);
  }
}

/** @type {DatabaseSync} */
export let db;
let dbFile = null;
let open = false;
let lastError = null;

/** Закрите з'єднання-заглушка: будь-який запит до нього кидає «database is not open», і сервер відповідає 503. */
function closedConnection() {
  const conn = new DatabaseSync(':memory:');
  conn.close();
  return conn;
}

/** Відкриває базу. Якщо не вдалося, кидає помилку, а db стає заглушкою (див. ensureDb). */
export function initDb(file) {
  closeDb(); // попереднє з'єднання, якщо було
  dbFile = file;
  let conn = null;
  try {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    conn = new DatabaseSync(file);
    db = conn;
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);
    migrate();
  } catch (err) {
    try {
      conn?.close();
    } catch {
      // з'єднання не відкрилось повністю
    }
    db = closedConnection();
    lastError = err;
    throw err;
  }
  open = true;
  lastError = null;
  return db;
}

/**
 * Чи працює база. Якщо вона не відкрилась (диск недоступний, файл зайнятий чи пошкоджений),
 * пробуємо відкрити її знову — так сервер оживає сам, щойно базу полагодять, без перезапуску.
 */
export function ensureDb() {
  if (open) return true;
  if (!dbFile) return false;
  try {
    initDb(dbFile);
    return true;
  } catch {
    return false;
  }
}

export const isDbOpen = () => open;
export const dbError = () => lastError;

// Основні коди SQLite, коли винна не логіка програми, а сама база: зайнята іншою програмою,
// лише для читання, збій диска, пошкоджена, диск заповнений, не відкривається, «це не база даних»
const UNAVAILABLE_CODES = new Set([5, 6, 8, 10, 11, 13, 14, 26]);

/** Помилка означає, що база недоступна (а не, скажімо, порушення унікальності). */
export function isDbUnavailable(err) {
  if (err?.code === 'ERR_INVALID_STATE') return /database is not open/i.test(err.message);
  return err?.code === 'ERR_SQLITE_ERROR' && UNAVAILABLE_CODES.has(err.errcode & 0xff);
}

export function closeDb() {
  open = false;
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
