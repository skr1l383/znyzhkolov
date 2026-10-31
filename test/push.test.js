// Пуш-сповіщення наскрізно: «браузер» підписується, сервер шифрує й надсилає на тестовий «сервіс сповіщень»,
// а тест розшифровує повідомлення ключами «браузера» — так, як це зробив би справжній браузер.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'znyzhkolov-push-'));

// ---- Тестовий сервіс сповіщень: запам'ятовує запити, відповідає кодом із черги ----
const service = { received: [], statuses: [] };
const fakeService = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  service.received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  res.writeHead(service.statuses.shift() || 201);
  res.end();
});

// ---- «Браузер»: власна пара ключів і секрет, як у PushSubscription ----
const browser = crypto.createECDH('prime256v1');
browser.generateKeys();
const authSecret = crypto.randomBytes(16);

/** Розшифровка aes128gcm (RFC 8291) — те, що робить браузер, отримавши пуш. */
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const serverPublic = body.subarray(21, 21 + idLen);
  const data = body.subarray(21 + idLen);
  const shared = browser.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'останній запис позначено байтом 2');
  return JSON.parse(plain.subarray(0, -1).toString());
}

let app;
let baseUrl;
let mod;
let origin;

before(async () => {
  await new Promise((r) => fakeService.listen(0, r));
  origin = `http://127.0.0.1:${fakeService.address().port}`;
  process.env.PUSH_TEST_ORIGIN = origin;
  process.env.GEMINI_API_KEY = '';
  process.env.GROQ_API_KEY = '';
  process.env.DEMO_STORES = '1';
  process.env.DEALS_SOURCE = 'demo';
  process.env.DATA_DIR = tmp;
  process.env.LOG_DIR = tmp;
  mod = { ...(await import('../server/app.js')), ...(await import('../server/db.js')) };
  app = mod.buildServer({ dbFile: path.join(tmp, 'test.db'), silent: true });
  await new Promise((r) => app.listen(0, r));
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await new Promise((r) => app.close(r));
  mod.closeDb();
  fakeService.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let cookie = '';
async function call(method, url, body) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json() };
}

const subscription = (endpoint) => ({
  endpoint,
  keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
});

test('Пуш: підписка лише для тих, хто увійшов, і лише на справжній сервіс сповіщень', async () => {
  assert.equal((await call('POST', '/api/push/subscriptions', subscription(`${origin}/push/1`))).status, 401);
  assert.equal((await call('POST', '/api/auth/register', { name: 'Пуш', email: 'push@test.ua', password: 'password123' })).status, 200);

  const key = (await call('GET', '/api/push/key')).data.publicKey;
  assert.equal(Buffer.from(key, 'base64url').length, 65, 'публічний ключ P-256 для applicationServerKey');

  // Чужа адреса (SSRF) і зіпсовані ключі не приймаються
  let r = await call('POST', '/api/push/subscriptions', subscription('https://127.0.0.1:3000/api/admin'));
  assert.equal(r.status, 400);
  r = await call('POST', '/api/push/subscriptions', { endpoint: `${origin}/push/1`, keys: { p256dh: 'abc', auth: 'x' } });
  assert.equal(r.status, 400);

  r = await call('POST', '/api/push/subscriptions', subscription(`${origin}/push/1`));
  assert.equal(r.status, 200);
  assert.equal(r.data.devices, 1);
});

test('Пуш: тестове сповіщення зашифроване ключами браузера і підписане ключем сайту', async () => {
  service.received = [];
  const r = await call('POST', '/api/push/test');
  assert.equal(r.status, 200);
  assert.equal(r.data.delivered, 1);

  const [req] = service.received;
  assert.equal(req.url, '/push/1');
  assert.equal(req.headers['content-encoding'], 'aes128gcm');
  assert.equal(req.headers.ttl, '86400');
  const message = decrypt(req.body);
  assert.equal(message.title, 'Пуш-сповіщення працюють!');
  assert.equal(message.url, '/#/notifications');

  // Підпис VAPID перевіряється публічним ключем, який сайт віддає браузеру
  const [, token, k] = req.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, (await call('GET', '/api/push/key')).data.publicKey);
  const [h, c, s] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, origin);
  const jwk = { kty: 'EC', crv: 'P-256', x: Buffer.from(k, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(k, 'base64url').subarray(33).toString('base64url') };
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('Пуш: сповіщення про роздачу Epic приходить на пристрій і веде на сторінку роздач', async () => {
  service.received = [];
  // Вмикаємо сповіщення про роздачі й запускаємо перевірку Epic (демо-роздачі — нові для цього користувача)
  assert.equal((await call('PATCH', '/api/me', { notifyEpicFree: true })).status, 200);
  await call('GET', '/api/epic');
  const pushes = service.received.map((x) => decrypt(x.body));
  assert.ok(pushes.length >= 1, 'пуш про роздачу надіслано');
  assert.ok(pushes.every((p) => p.url === '/#/epic' && /Epic Games/.test(p.title)));
  const notices = (await call('GET', '/api/notifications')).data.items;
  assert.ok(notices.some((n) => n.kind === 'epic' && n.push === 1), 'на сторінці сповіщень видно «надіслано на пристрій»');
});

test('Пуш: адреса, яка більше не діє (410), видаляється сама; вихід відписує пристрій', async () => {
  service.statuses = [410];
  let r = await call('POST', '/api/push/test');
  assert.equal(r.status, 502, 'жодного живого пристрою — зрозуміла помилка');
  service.received = [];
  r = await call('POST', '/api/push/test');
  assert.equal(r.status, 502);
  assert.equal(service.received.length, 0, 'на мертву адресу більше нічого не надсилаємо — її видалено');

  // Підписались знову — і відписались (так робить кнопка «Вимкнути» і вихід з акаунта)
  await call('POST', '/api/push/subscriptions', subscription(`${origin}/push/2`));
  r = await call('DELETE', '/api/push/subscriptions', { endpoint: `${origin}/push/2` });
  assert.equal(r.data.devices, 0);
});
