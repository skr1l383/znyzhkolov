// Реєстрація, вхід і сесії. Паролі зберігаються лише як хеш scrypt із сіллю,
// а в cookie лежить випадковий токен сесії (у базі зберігається тільки його хеш).
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config, isHttps } from './config.js';
import { db, now } from './db.js';
import { HttpError, serializeCookie, templateError } from './http.js';

const scrypt = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'zk_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(sha256(token), userId, now(), expires, String(userAgent).slice(0, 200));
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function userBySession(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(sha256(token), now()) || null
  );
}

/** Вийти на всіх пристроях — після зміни пароля старі сесії не повинні працювати. */
export function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Вийти на всіх інших пристроях, лишивши поточну сесію (після зміни пароля в профілі). */
export function destroyOtherSessions(userId, currentToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256(currentToken || ''));
}

// ---------- Одноразові ключі для посилань з листів ----------

/** Новий ключ для листа (попередні такого ж призначення скасовуються). У базі — лише хеш. */
export function createEmailToken(userId, purpose, minutes) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  db.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    purpose,
    now(),
    new Date(Date.now() + minutes * 60000).toISOString()
  );
  return token;
}

/** Перевіряє ключ і «гасить» його: вдруге те саме посилання не спрацює. Повертає id користувача або null. */
export function useEmailToken(token, purpose) {
  if (typeof token !== 'string' || !/^[\w-]{20,100}$/.test(token)) return null;
  const row = db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?').get(sha256(token), purpose);
  if (!row || row.used_at || row.expires_at <= now()) return null;
  db.prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?').run(now(), row.token_hash);
  return row.user_id;
}

export function cleanupSessions() {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()).changes;
}

export function sessionCookie(token) {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: config.sessionDays * 86400,
    secure: isHttps,
  });
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps });
}

/** Дані користувача, які можна віддавати в браузер (без хешу пароля). */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    lang: u.lang,
    telegramLinked: Boolean(u.telegram_chat_id),
    telegramUsername: u.telegram_username || null,
    notifyEpicFree: Boolean(u.notify_epic_free),
    avatarUrl: u.avatar ? `/api/avatars/${u.avatar}` : null,
    emailVerified: Boolean(u.email_verified_at),
    steamId: u.steam_id || null,
    notifyEmail: Boolean(u.notify_email ?? 1),
    createdAt: u.created_at,
  };
}

// Проміжні обробники для маршрутів
export function requireAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Потрібно увійти в акаунт');
}

export function requireAdmin(ctx) {
  requireAuth(ctx);
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'Доступно лише адміністратору');
}

// Простий захист від перебору паролів: не більше 10 спроб входу за 15 хвилин з однієї адреси
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function checkLoginRate(ip) {
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS) {
    const minutes = Math.ceil((entry.resetAt - Date.now()) / 60000);
    throw templateError(429, 'Забагато спроб входу. Спробуйте через {minutes} хв.', { minutes });
  }
}

export function registerLoginFailure(ip) {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function resetLoginFailures(ip) {
  attempts.delete(ip);
}
