// Наскрізна перевірка API: реєстрація, вхід, ролі, список відстеження,
// Telegram-бот (на тестовому сервері замість справжнього Telegram) і збереження даних після перезапуску.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'znyzhkolov-test-'));
const dbFile = path.join(tmp, 'test.db');

// ---- Тестовий «Telegram» ----
const tg = { queue: [], sent: [], updateId: 0 };
const fakeTelegram = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const params = body ? JSON.parse(body) : {};
  const method = req.url.split('/').pop();
  const reply = (result) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  };
  if (method === 'getMe') return reply({ id: 1, is_bot: true, username: 'znyzhkolov_test_bot' });
  if (method === 'setMyCommands') return reply(true);
  if (method === 'sendMessage') {
    tg.sent.push(params);
    return reply({ message_id: tg.sent.length });
  }
  if (method === 'getUpdates') {
    const started = Date.now();
    while (!tg.queue.length && Date.now() - started < 300) await new Promise((r) => setTimeout(r, 20));
    const updates = tg.queue.splice(0);
    return reply(updates);
  }
  reply(true);
});

function userSays(chatId, text) {
  tg.updateId += 1;
  tg.queue.push({ update_id: tg.updateId, message: { message_id: tg.updateId, chat: { id: chatId }, from: { username: 'sasha' }, text } });
}

async function waitFor(check, ms = 3000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Не дочекалися очікуваної події');
}

let app;
let baseUrl;
let mod;

async function startApp() {
  app = mod.buildServer({ dbFile, silent: true });
  await new Promise((r) => app.listen(0, r));
  baseUrl = `http://127.0.0.1:${app.address().port}`;
}

async function stopApp() {
  await new Promise((r) => app.close(r));
  mod.closeDb();
}

before(async () => {
  await new Promise((r) => fakeTelegram.listen(0, r));
  process.env.DEMO_STORES = '1';
  process.env.DATA_DIR = tmp;
  process.env.LOG_DIR = tmp;
  process.env.TELEGRAM_BOT_TOKEN = 'TEST:TOKEN';
  process.env.TELEGRAM_API_URL = `http://127.0.0.1:${fakeTelegram.address().port}`;
  const appMod = await import('../server/app.js');
  const dbMod = await import('../server/db.js');
  const tgMod = await import('../server/services/telegram.js');
  mod = { ...appMod, ...dbMod, ...tgMod };
  await startApp();
  await mod.startBot();
});

after(async () => {
  mod.stopBot();
  await stopApp();
  fakeTelegram.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Простий клієнт із cookie, як браузер
function client() {
  let cookie = '';
  return async function call(method, url, body) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const admin = client();
const user = client();
let watchId;

test('Реєстрація: порожні поля, короткий пароль, неправильна пошта', async () => {
  let r = await admin('POST', '/api/auth/register', { name: '', email: '', password: '' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'name');

  r = await admin('POST', '/api/auth/register', { name: 'Саша', email: 'sasha@test.ua', password: '123' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /8 символів/);

  r = await admin('POST', '/api/auth/register', { name: 'Саша', email: 'not-an-email', password: 'password123' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'email');
});

test('Реєстрація: перший користувач стає адміністратором, другий — звичайним', async () => {
  let r = await admin('POST', '/api/auth/register', { name: 'Саша', email: 'Sasha@Test.ua', password: 'password123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.email, 'sasha@test.ua');

  r = await user('POST', '/api/auth/register', { name: 'Оля', email: 'olia@test.ua', password: 'password123' });
  assert.equal(r.data.user.role, 'user');

  r = await user('POST', '/api/auth/register', { name: 'Оля 2', email: 'olia@test.ua', password: 'password123' });
  assert.equal(r.status, 409);
});

test('Вхід: неправильний пароль і неіснуючий користувач', async () => {
  const guest = client();
  let r = await guest('POST', '/api/auth/login', { email: 'sasha@test.ua', password: 'wrong-password' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'Невірна пошта або пароль');
  r = await guest('POST', '/api/auth/login', { email: 'nobody@test.ua', password: 'password123' });
  assert.equal(r.status, 401);
  r = await guest('POST', '/api/auth/login', { email: 'sasha@test.ua', password: 'password123' });
  assert.equal(r.status, 200);
});

test('Ролі: адмін-панель недоступна гостю і звичайному користувачу', async () => {
  assert.equal((await client()('GET', '/api/admin/overview')).status, 401);
  assert.equal((await user('GET', '/api/admin/overview')).status, 403);
  const r = await admin('GET', '/api/admin/overview');
  assert.equal(r.status, 200);
  assert.equal(r.data.stats.users, 2);
});

test('Пошук і додавання гри з двома магазинами', async () => {
  const s = await user('GET', '/api/search?q=hollow&store=steam');
  assert.equal(s.status, 200);
  const steamGame = s.data.results[0];
  assert.equal(steamGame.title, 'Hollow Knight');

  const m = await user('GET', `/api/match?store=steam&title=${encodeURIComponent(steamGame.title)}`);
  assert.equal(m.data.matches[0].store, 'gog');

  let r = await user('POST', '/api/watch', { offer: steamGame, extra: [], minDiscount: null, maxPriceUah: null, notifyFree: false });
  assert.equal(r.status, 400, 'без жодної умови додати не можна');

  r = await user('POST', '/api/watch', { offer: steamGame, extra: [m.data.matches[0]], minDiscount: 25, maxPriceUah: '150', notifyFree: true });
  assert.equal(r.status, 200);
  watchId = r.data.item.id;
  assert.equal(r.data.item.offers.length, 2);
  assert.equal(r.data.item.maxPriceUah, 15000);

  r = await user('POST', '/api/watch', { offer: steamGame, minDiscount: 10 });
  assert.equal(r.status, 409, 'ту саму гру двічі додати не можна');

  const list = await user('GET', '/api/watch');
  assert.equal(list.data.items.length, 1);
  assert.equal((await admin('GET', '/api/watch')).data.items.length, 0, 'чужий список не видно');
});

test('Чужу гру не можна змінити або видалити', async () => {
  assert.equal((await admin('PATCH', `/api/watch/${watchId}`, { minDiscount: 90 })).status, 404);
  assert.equal((await admin('DELETE', `/api/watch/${watchId}`)).status, 404);
  const r = await user('PATCH', `/api/watch/${watchId}`, { minDiscount: 50 });
  assert.equal(r.data.item.minDiscount, 50);
});

test('Telegram: прив’язка через /start, тестове повідомлення і команда /list', async () => {
  const link = await user('POST', '/api/me/telegram/link');
  assert.equal(link.status, 200);
  assert.equal(link.data.url, `https://t.me/znyzhkolov_test_bot?start=${link.data.code}`);

  userSays(555, `/start ${link.data.code}`);
  await waitFor(() => tg.sent.find((m) => m.chat_id === 555 && m.text.startsWith('Готово')));
  const me = await user('GET', '/api/me');
  assert.equal(me.data.user.telegramLinked, true);

  userSays(555, '/start wrongcode');
  await waitFor(() => tg.sent.find((m) => m.text.startsWith('Код не підійшов')));

  assert.equal((await user('POST', '/api/me/telegram/test')).status, 200);
  await waitFor(() => tg.sent.find((m) => m.text.includes('Тестове сповіщення')));

  userSays(555, '/list');
  await waitFor(() => tg.sent.find((m) => m.text.includes('Hollow Knight')));
});

test('Перевірка цін за розкладом надсилає сповіщення в Telegram', async () => {
  // Умову «ціна до 100 000 грн» виконає будь-яка ціна
  const before = tg.sent.length;
  await user('PATCH', `/api/watch/${watchId}`, { minDiscount: null, maxPriceUah: 100000 });
  const r = await admin('POST', '/api/admin/jobs/prices/run');
  assert.equal(r.status, 200);
  await waitFor(() => tg.sent.slice(before).find((m) => m.text.includes('Hollow Knight') && m.text.includes('Твоя умова')));
  const n = await user('GET', '/api/notifications');
  assert.ok(n.data.items.some((i) => i.kind === 'deal' && i.telegram));
});

test('Журнал подій записує входи та помилки входу', async () => {
  const r = await admin('GET', '/api/admin/events?type=auth');
  const types = r.data.events.map((e) => e.type);
  assert.ok(types.includes('auth.login_failed'));
  assert.ok(types.includes('auth.register'));
});

test('Захист: запит з чужого сайту і некоректний JSON відхиляються', async () => {
  let res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
    body: '{}',
  });
  assert.equal(res.status, 403);
  res = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
  res = await fetch(baseUrl + '/../server/config.js');
  assert.notEqual(res.status, 200);
});

test('Дані зберігаються після перезапуску сервера', async () => {
  await stopApp();
  await startApp();
  const guest = client();
  const r = await guest('POST', '/api/auth/login', { email: 'olia@test.ua', password: 'password123' });
  assert.equal(r.status, 200);
  const list = await guest('GET', '/api/watch');
  assert.equal(list.data.items[0].title, 'Hollow Knight');
  assert.equal(r.data.user.telegramLinked, true);
});
