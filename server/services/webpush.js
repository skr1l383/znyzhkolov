// Пуш-сповіщення в браузер і на телефон (Web Push) без сторонніх бібліотек — лише node:crypto.
// Браузер дає «адресу» сервісу сповіщень (endpoint: Google, Mozilla, Apple, Microsoft) і два ключі.
// Ми шифруємо повідомлення цими ключами (RFC 8291, aes128gcm) і підписуємо запит своїм ключем VAPID (RFC 8292),
// щоб сервіс знав, що повідомлення саме від Знижколова. Прочитати вміст може лише браузер людини.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, getSetting, now, setSetting } from '../db.js';
import { log } from '../logger.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// Надсилаємо лише на справжні сервіси сповіщень браузерів — інакше через «адресу» можна було б
// змусити наш сервер слати запити куди завгодно (SSRF), зокрема у внутрішню мережу.
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

/** Чи можна надсилати на цю адресу: https і відомий сервіс (у тестах — ще й тестовий сервер). */
export function allowedEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (config.push.testOrigin && url.origin === config.push.testOrigin) return true;
  return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

// ---- Ключ VAPID: створюється один раз і зберігається в базі ----

let vapid = null;

/** Пара ключів сайту (P-256). Публічний — у форматі, який браузер чекає в applicationServerKey. */
export function vapidKeys() {
  if (vapid) return vapid;
  let jwk = getSetting('push:vapid');
  if (!jwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    jwk = JSON.stringify(privateKey.export({ format: 'jwk' }));
    setSetting('push:vapid', jwk);
  }
  const parsed = JSON.parse(jwk);
  vapid = {
    privateKey: crypto.createPrivateKey({ key: parsed, format: 'jwk' }),
    publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(parsed.x), fromB64u(parsed.y)])),
  };
  return vapid;
}

/** Заголовок Authorization (RFC 8292): короткий JWT, підписаний ключем сайту (ES256). */
export function vapidAuthorization(endpoint, { privateKey, publicKey } = vapidKeys()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: config.baseUrl.startsWith('https://') ? config.baseUrl : `mailto:${config.mail.from || 'admin@znyzhkolov.local'}`,
    })
  );
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${publicKey}`;
}

/**
 * Шифрування повідомлення (RFC 8291, «aes128gcm»).
 * p256dh — публічний ключ браузера, auth — його спільний секрет. salt і ecdh можна задати лише в тестах.
 */
export function encryptPayload(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = fromB64u(p256dh);
  const local = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) local.generateKeys();
  const asPublic = local.getPublicKey();
  // Спільний секрет із браузером → ключ і nonce для AES-GCM
  const shared = local.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, fromB64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // Повідомлення в одному записі: текст + байт 2 («останній запис»)
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// ---- Підписки пристроїв ----

export function saveSubscription(userId, { endpoint, p256dh, auth }, userAgent = '') {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(userId, endpoint, p256dh, auth, String(userAgent).slice(0, 200), now());
}

export function removeSubscription(userId, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes > 0;
}

export const pushDeviceCount = (userId) => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n;

/** Надсилає одне повідомлення на один пристрій. Повертає true, якщо сервіс його прийняв. */
async function sendOne(sub, payload) {
  if (!allowedEndpoint(sub.endpoint)) return false;
  let res;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 3600), // доставити протягом доби, якщо пристрій зараз вимкнений
        Urgency: 'normal',
      },
      body: encryptPayload(JSON.stringify(payload), sub),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    log.warn('push.error', `Сервіс сповіщень не відповів: ${err.message}`, { userId: sub.user_id });
    return false;
  }
  if (res.status === 404 || res.status === 410) {
    // Людина вимкнула сповіщення або перевстановила браузер — адреса більше не діє
    db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
    return false;
  }
  if (!res.ok) {
    log.warn('push.error', `Сервіс сповіщень відповів ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, { userId: sub.user_id });
    return false;
  }
  return true;
}

/**
 * Пуш на всі пристрої користувача. payload: { title, body, url, image, tag }.
 * Повертає, на скільки пристроїв доставлено.
 */
export async function pushToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (!subs.length) return 0;
  const results = await Promise.all(subs.map((s) => sendOne(s, payload)));
  return results.filter(Boolean).length;
}
