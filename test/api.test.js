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
    const value = await check(); // перевірка може бути й асинхронною
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

// ---- Тестовий «Steam»: профілі, список бажаного і дані ігор (як справжні відповіді Steam) ----
const STEAM_GAMES = {
  367520: { name: 'Hollow Knight', final: 27900 },
  413150: { name: 'Stardew Valley', final: 17175, original: 22900, pct: 25 },
  105600: { name: 'Terraria', final: 18900 },
  999999: { name: 'Майбутня гра', coming: true },
};
const fakeSteam = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (type, body) => {
    res.writeHead(200, { 'Content-Type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const profileXml = (id, name, privacy) =>
    `<?xml version="1.0"?><profile><steamID64>${id}</steamID64><steamID><![CDATA[${name}]]></steamID><privacyState>${privacy}</privacyState></profile>`;
  if (url.pathname === '/id/testgamer') return send('text/xml', profileXml('76561190000000001', 'Тестовий гравець', 'public'));
  if (url.pathname === '/id/privategamer') return send('text/xml', profileXml('76561190000000002', 'Прихований', 'private'));
  if (url.pathname.startsWith('/id/')) return send('text/xml', '<?xml version="1.0"?><response><error><![CDATA[The specified profile could not be found.]]></error></response>');
  if (url.pathname === '/IWishlistService/GetWishlist/v1/') {
    if (url.searchParams.get('steamid') !== '76561190000000001') return send('application/json', { response: {} });
    return send('application/json', {
      response: {
        items: [
          { appid: 105600, priority: 0, date_added: 1700000000 },
          { appid: 413150, priority: 1, date_added: 1600000000 },
          { appid: 999999, priority: 0, date_added: 1750000000 },
          { appid: 367520, priority: 2, date_added: 1650000000 },
        ],
      },
    });
  }
  if (url.pathname === '/IStoreBrowseService/GetItems/v1/') {
    const ids = JSON.parse(url.searchParams.get('input_json')).ids.map((i) => i.appid);
    return send('application/json', {
      response: {
        store_items: ids.map((appid) => {
          const g = STEAM_GAMES[appid];
          return {
            appid,
            success: 1,
            name: g.name,
            assets: { asset_url_format: `steam/apps/${appid}/\${FILENAME}?t=1`, small_capsule: 'capsule_231x87.jpg', header: 'header.jpg' },
            release: g.coming ? { is_coming_soon: true } : { steam_release_date: 1500000000 },
            best_purchase_option: g.coming
              ? undefined
              : {
                  final_price_in_cents: String(g.final),
                  ...(g.original ? { original_price_in_cents: String(g.original), discount_pct: g.pct, active_discounts: [{ discount_end_date: 1893456000 }] } : {}),
                },
          };
        }),
      },
    });
  }
  res.writeHead(404);
  res.end();
});

before(async () => {
  await new Promise((r) => fakeTelegram.listen(0, r));
  await new Promise((r) => fakeSteam.listen(0, r));
  process.env.STEAM_API_URL = `http://127.0.0.1:${fakeSteam.address().port}`;
  process.env.STEAM_COMMUNITY_URL = `http://127.0.0.1:${fakeSteam.address().port}`;
  process.env.DEMO_STORES = '1';
  process.env.DEALS_SOURCE = 'demo';
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
  fakeSteam.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Простий клієнт із cookie, як браузер
function client() {
  let cookie = '';
  const call = async function call(method, url, body) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  // Надсилання файлу, як це робить браузер на сторінці
  call.upload = async (url, bytes, name = 'file') => {
    const res = await fetch(baseUrl + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), Cookie: cookie },
      body: bytes,
    });
    return { status: res.status, data: await res.json() };
  };
  // Завантаження файлу з сервера
  call.download = async (url) => {
    const res = await fetch(baseUrl + url, { headers: { Cookie: cookie } });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  };
  return call;
}

// Справжня картинка PNG 1×1 піксель
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const admin = client();
const user = client();
let watchId;

test('Реєстрація: порожні поля, короткий пароль, неправильна пошта', async () => {
  let r = await admin('POST', '/api/auth/register', { name: '', email: '', password: '' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'name');
  // Разом із готовим текстом приходить шаблон — за ним інтерфейс показує переклад
  assert.equal(r.data.error, 'Заповніть поле «Ім\'я»');
  assert.deepEqual(r.data.details.i18n, { text: 'Заповніть поле «{label}»', vars: { label: "Ім'я" } });

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

test('Мова інтерфейсу зберігається в профілі', async () => {
  assert.equal((await user('GET', '/api/me')).data.user.lang, 'uk');
  let r = await user('PATCH', '/api/me', { lang: 'en' });
  assert.equal(r.status, 200);
  assert.equal((await user('GET', '/api/me')).data.user.lang, 'en');
  r = await user('PATCH', '/api/me', { lang: 'fr' });
  assert.equal(r.status, 400);
  assert.equal((await user('PATCH', '/api/me', { lang: 'uk' })).status, 200);
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

test('Порожні поля: вхід, пошук, ім’я в профілі', async () => {
  const guest = client();
  let r = await guest('POST', '/api/auth/login', { email: '', password: '' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'email');
  r = await guest('POST', '/api/auth/login', { email: 'sasha@test.ua', password: '' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'password');
  r = await user('GET', '/api/search?q=&store=steam');
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'q');
  r = await user('PATCH', '/api/me', { name: '   ' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'name');
  assert.equal((await user('GET', '/api/me')).data.user.name, 'Оля', 'ім’я не змінилось');
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

test('Підсумок для шапки профілю: ігри, виконані умови, сповіщення, економія', async () => {
  assert.equal((await client()('GET', '/api/me/summary')).status, 401);
  const s = (await user('GET', '/api/me/summary')).data;
  const list = (await user('GET', '/api/watch')).data.items;
  const alerts = (await user('GET', '/api/notifications')).data;
  assert.equal(s.games, list.length);
  assert.equal(s.met, list.filter((i) => i.active && i.conditionMet).length);
  assert.equal(s.alerts, alerts.items.length);
  assert.equal(s.unread, alerts.unread);
  assert.ok(Number.isInteger(s.savingsUah) && s.savingsUah >= 0);
  assert.deepEqual(s.covers, list.map((i) => i.imageUrl).filter(Boolean).slice(0, 6));
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

test('Аватар: завеликий файл, непідтримуваний формат, завантаження і видалення', async () => {
  const big = Buffer.concat([TINY_PNG, Buffer.alloc(2.5 * 1024 * 1024)]);
  let r = await user.upload('/api/me/avatar', big, 'huge.png');
  assert.equal(r.status, 413);
  assert.match(r.data.error, /максимум 2 МБ/);

  r = await user.upload('/api/me/avatar', Buffer.from('MZ це програма, а не картинка'), 'photo.png');
  assert.equal(r.status, 415, 'назва .png не обманює перевірку');
  assert.match(r.data.error, /PNG, JPG або WEBP/);

  r = await user.upload('/api/me/avatar', TINY_PNG, 'я.png');
  assert.equal(r.status, 200);
  const url = r.data.user.avatarUrl;
  assert.match(url, /^\/api\/avatars\/\d+-[0-9a-f]{16}\.png$/);

  const img = await user.download(url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(img.bytes, TINY_PNG);
  assert.equal((await client().download(url)).status, 401, 'гість фото не бачить');

  r = await user('DELETE', '/api/me/avatar');
  assert.equal(r.data.user.avatarUrl, null);
  assert.equal((await user.download(url)).status, 404, 'файл видалено з диска');
});

test('Експорт списку в CSV і Excel', async () => {
  const csv = await user.download('/api/watch/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="znyzhkolov-\d{4}-\d{2}-\d{2}\.csv"/);
  const text = csv.bytes.toString('utf8');
  assert.ok(text.startsWith('﻿Назва;Steam ID;GOG ID'), 'BOM і заголовок');
  assert.match(text, /Hollow Knight;367520;1308320804;/);

  const xlsx = await user.download('/api/watch/export?format=xlsx');
  assert.equal(xlsx.status, 200);
  const { parseXlsx } = await import('../server/formats/xlsx.js');
  const rows = parseXlsx(xlsx.bytes);
  assert.equal(rows[0][0], 'Назва');
  assert.equal(rows[1][0], 'Hollow Knight');
  assert.equal(rows[1][1], '367520');

  assert.equal((await user.download('/api/watch/export?format=pdf')).status, 400);
});

test('Імпорт: Excel з іншого акаунта, простий список назв і непідтримувані файли', async () => {
  // Експорт одного користувача імпортується іншим — та сама гра з тими самими умовами
  const xlsx = await user.download('/api/watch/export?format=xlsx');
  let r = await admin.upload('/api/watch/import', xlsx.bytes, 'список.xlsx');
  assert.equal(r.status, 200);
  assert.equal(r.data.added.length, 1);
  assert.deepEqual(r.data.added[0].stores, ['steam', 'gog']);
  const original = (await user('GET', '/api/watch')).data.items[0];
  let list = (await admin('GET', '/api/watch')).data.items;
  assert.equal(list[0].title, 'Hollow Knight');
  assert.equal(list[0].minDiscount, original.minDiscount);
  assert.equal(list[0].maxPriceUah, original.maxPriceUah);
  assert.equal(list[0].notifyFree, original.notifyFree);

  // Просто назви в стовпчик, без заголовка; одна вже є, однієї немає в магазинах
  const names = 'Stardew Valley\r\nНеіснуюча гра 12345\r\nHollow Knight\r\nTerraria\r\n';
  r = await admin.upload('/api/watch/import', Buffer.from(names), 'ігри.csv');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.added.map((a) => a.title), ['Stardew Valley', 'Terraria']);
  assert.deepEqual(
    r.data.skipped.map((s) => [s.line, s.reason]),
    [
      [2, 'не знайдено ні в Steam, ні в GOG'],
      [3, 'уже є у списку'],
    ]
  );
  list = (await admin('GET', '/api/watch')).data.items;
  assert.equal(list.length, 3);
  assert.equal(list.find((i) => i.title === 'Terraria').minDiscount, 50, 'типова умова — знижка від 50%');

  r = await admin.upload('/api/watch/import', Buffer.from('%PDF-1.7 ...'), 'звіт.csv');
  assert.equal(r.status, 415, 'PDF під виглядом CSV не приймається');
  r = await admin.upload('/api/watch/import', Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'old.xls');
  assert.equal(r.status, 415);
  assert.match(r.data.error, /\.xls/);
  r = await admin.upload('/api/watch/import', Buffer.alloc(0), 'empty.csv');
  assert.equal(r.status, 400);

  const { events } = (await admin('GET', '/api/admin/events?type=watch.import')).data;
  assert.ok(events.some((e) => e.type === 'watch.import' && e.meta.added === 2), 'імпорт записано в журнал');
  assert.ok(events.some((e) => e.type === 'watch.import.rejected' && e.level === 'warn'), 'відхилений файл теж');
});

test('Таблиця, складена на сайті: заповнена таблиця з цінами, з додаванням до списку і без', async () => {
  const { parseXlsx } = await import('../server/formats/xlsx.js');
  const before = (await user('GET', '/api/watch')).data.items.length;

  // Лише дізнатися ціни: список не змінюється
  let r = await user('POST', '/api/watch/lookup', { titles: ['Celeste', 'Неіснуюча гра 777', ' '], addToList: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.added.length, 0);
  assert.deepEqual(r.data.found.map((f) => f.matched), ['Celeste']);
  assert.equal((await user('GET', '/api/watch')).data.items.length, before, 'список не змінився');
  const rows = parseXlsx(Buffer.from(r.data.file.base64, 'base64'));
  assert.equal(rows[0][1], 'Запит');
  assert.equal(rows[1][2], 'Celeste');
  assert.equal(rows[1][3], '504230', 'Steam ID заповнено');
  assert.ok(Number(rows[1][5]) > 0, 'ціну Steam заповнено');
  assert.equal(rows[1][12], 'знайдено');
  assert.equal(rows[2][12], 'не знайдено', 'ненайдена гра лишається в таблиці');
  assert.equal(rows.length, 3, 'порожній рядок відкинуто');

  // З додаванням: нова гра додається, наявна позначена, але ціни в таблиці є
  r = await user('POST', '/api/watch/lookup', { titles: ['Celeste', 'Hollow Knight'], addToList: true });
  assert.deepEqual(r.data.added.map((a) => a.matched), ['Celeste']);
  assert.deepEqual(r.data.skipped.map((s) => s.reason), ['уже є у списку']);
  const filled = parseXlsx(Buffer.from(r.data.file.base64, 'base64'));
  assert.equal(filled[2][12], 'уже є у списку');
  assert.equal(filled[2][3], '367520');
  assert.equal((await user('GET', '/api/watch')).data.items.length, before + 1);

  assert.equal((await user('POST', '/api/watch/lookup', { titles: [] })).status, 400);
  assert.equal((await user('POST', '/api/watch/lookup', { titles: Array(51).fill('Hades') })).status, 400);
  assert.equal((await client()('POST', '/api/watch/lookup', { titles: ['Hades'] })).status, 401);
});

test('Вітрина: відкрита для гостей, фільтри за магазином, знижкою, ціною і назвою, сортування', async () => {
  const guest = client();
  // Перший запит запускає збирання вітрини; чекаємо, поки вона наповниться
  let r = await guest('GET', '/api/deals');
  assert.equal(r.status, 200, 'гостю вітрина доступна');
  for (let i = 0; i < 50 && !r.data.total; i++) {
    await new Promise((res) => setTimeout(res, 50));
    r = await guest('GET', '/api/deals');
  }
  const all = r.data.total;
  assert.ok(all > 10, 'вітрина наповнилась');
  assert.ok(r.data.counts.steam > 0 && r.data.counts.gog > 0);
  assert.ok(r.data.items.every((d) => d.discount > 0 && d.priceUah > 0));

  r = await guest('GET', '/api/deals?store=gog&limit=60');
  assert.ok(r.data.items.length > 0 && r.data.items.every((d) => d.store === 'gog' && d.currency === 'USD'));

  r = await guest('GET', '/api/deals?minDiscount=50&maxPrice=300&limit=60');
  assert.ok(r.data.items.every((d) => d.discount >= 50 && d.priceUah <= 30000), 'два фільтри одночасно');
  assert.ok(r.data.total <= all);

  r = await guest('GET', '/api/deals?q=hollow&limit=60');
  assert.ok(r.data.items.length >= 1 && r.data.items.every((d) => /hollow/i.test(d.title)));
  r = await guest('GET', `/api/deals?q=${encodeURIComponent('100%_')}`);
  assert.equal(r.data.total, 0, 'символи % і _ у пошуку не ламають запит');

  r = await guest('GET', '/api/deals?sort=cheap&limit=60');
  const prices = r.data.items.map((d) => d.priceUah);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'сортування від дешевших');
  r = await guest('GET', '/api/deals?sort=discount&limit=60');
  const discounts = r.data.items.map((d) => d.discount);
  assert.deepEqual(discounts, [...discounts].sort((a, b) => b - a), 'сортування за знижкою');

  r = await guest('GET', '/api/deals?limit=5&offset=5');
  assert.equal(r.data.items.length, 5, 'сторінками по кілька');

  // Ігри, за якими користувач стежить, позначені на вітрині
  const mine = await user('GET', '/api/deals?q=hollow&store=steam');
  assert.equal(mine.data.items[0].watching, true);
  assert.equal((await guest('GET', '/api/deals?q=hollow&store=steam')).data.items[0].watching, false);
});

test('Поділитися списком: посилання, перегляд гостем і другом, вимкнення, QR-код', async () => {
  assert.equal((await user('GET', '/api/me/share')).data.token, null, 'спочатку посилання немає');
  const { token } = (await user('POST', '/api/me/share')).data;
  assert.match(token, /^[\w-]{16}$/);
  assert.equal((await user('POST', '/api/me/share')).data.token, token, 'повторно — те саме посилання');

  const guest = client();
  let r = await guest('GET', `/api/shared/${token}`);
  assert.equal(r.status, 200, 'список видно без входу');
  assert.equal(r.data.owner.name, 'Оля');
  assert.ok(r.data.items.length > 0);
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes('olia@test.ua'), 'пошти власника у відповіді немає');
  assert.ok(!('minDiscount' in r.data.items[0]), 'умов сповіщень у відповіді немає');
  assert.ok(r.data.items.every((i) => i.inMyList === false));

  // Адмін (інший користувач) уже стежить за Hollow Knight після імпорту — це позначено
  r = await admin('GET', `/api/shared/${token}`);
  assert.equal(r.data.items.find((i) => i.title === 'Hollow Knight').inMyList, true);
  assert.equal((await user('GET', `/api/shared/${token}`)).data.isMine, true);

  assert.equal((await user('DELETE', '/api/me/share')).data.token, null);
  assert.equal((await guest('GET', `/api/shared/${token}`)).status, 404, 'вимкнене посилання не працює');
  assert.equal((await guest('GET', '/api/shared/..%2F..%2Fetc')).status, 404, 'спроба вийти за межі шляху');

  const qr = await fetch(`${baseUrl}/api/qr.svg?text=${encodeURIComponent('https://example.com/#/shared?token=abc')}`);
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /^<svg/);
  assert.equal((await fetch(`${baseUrl}/api/qr.svg`)).status, 400);
});

test('PDF-звіт: правильна будова файлу, вбудований шрифт, лише для власника', async () => {
  assert.equal((await client().download('/api/watch/report.pdf')).status, 401, 'гостю звіт недоступний');
  const res = await user.download('/api/watch/report.pdf?covers=0');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /znyzhkolov-zvit-\d{4}-\d{2}-\d{2}\.pdf/);
  const pdf = res.bytes;
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.7'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Subtype \/CIDFontType2/, 'шрифт вбудовано');
  assert.match(text, /\/FontFile2 \d+ 0 R/);
  assert.match(text, /\/ToUnicode \d+ 0 R/, 'текст можна копіювати');
  assert.match(text, /\/BaseFont \/[A-Z]{6}\+Manrope-Bold/, 'позначка підмножини шрифту');

  // Таблиця зміщень (xref): кожен запис вказує точно на початок свого об'єкта
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.startsWith('xref', startxref));
  const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(entries.length > 10);
  entries.forEach((offset, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, offset), `об'єкт ${i + 1}`));
  assert.ok(pdf.length < 80 * 1024, `без обкладинок файл маленький (${pdf.length} байт): у ньому лише потрібні літери шрифту`);
});

test('Пошта: лист при реєстрації, підтвердження, відновлення пароля', async () => {
  const lastLetter = async (to, kind) => {
    const { items } = (await admin('GET', '/api/admin/outbox')).data;
    return items.find((m) => m.to === to && m.kind === kind);
  };
  const tokenFrom = (letter, route) => new URL(letter.links.find((l) => l.includes(`#/${route}`)).replace('#/', '')).searchParams.get('token');

  const ivan = client();
  let r = await ivan('POST', '/api/auth/register', { name: 'Іван', email: 'ivan@test.ua', password: 'password123' });
  assert.equal(r.data.user.emailVerified, false);
  const verifyLetter = await lastLetter('ivan@test.ua', 'verify');
  assert.ok(verifyLetter, 'після реєстрації в скриньці лист');
  assert.equal(verifyLetter.subject, 'Підтвердь пошту в Знижколові');
  assert.match(verifyLetter.html, /Підтвердити пошту/);

  // Підтвердження працює навіть без входу (лист могли відкрити на телефоні) і лише один раз
  const verifyToken = tokenFrom(verifyLetter, 'verify');
  r = await client()('POST', '/api/auth/verify', { token: verifyToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.emailVerified, true);
  assert.equal((await client()('POST', '/api/auth/verify', { token: verifyToken })).status, 400, 'вдруге посилання не працює');
  assert.equal((await client()('POST', '/api/auth/verify', { token: 'вигаданий' })).status, 400);
  assert.equal((await ivan('GET', '/api/me')).data.user.emailVerified, true);

  // «Забули пароль?» — однакова відповідь для наявної і неіснуючої пошти
  const stranger = client();
  const known = await stranger('POST', '/api/auth/forgot', { email: 'ivan@test.ua' });
  const unknown = await stranger('POST', '/api/auth/forgot', { email: 'nobody@test.ua' });
  assert.equal(known.status, 200);
  assert.deepEqual(known.data, unknown.data, 'не можна дізнатися, чи є така пошта');
  assert.equal((await stranger('POST', '/api/auth/forgot', { email: 'ivan@test.ua' })).status, 429, 'не частіше разу на хвилину');
  assert.equal((await stranger('POST', '/api/auth/forgot', { email: '' })).status, 400, 'порожня пошта');

  const resetToken = tokenFrom(await lastLetter('ivan@test.ua', 'reset'), 'reset');
  assert.equal((await stranger('POST', '/api/auth/reset', { token: resetToken, password: '123' })).status, 400, 'короткий пароль');
  r = await stranger('POST', '/api/auth/reset', { token: resetToken, password: 'new-password-1' });
  assert.equal(r.status, 200, 'пароль змінено');
  assert.equal((await stranger('GET', '/api/me')).data.user.email, 'ivan@test.ua', 'після зміни — одразу вхід');
  assert.equal((await ivan('GET', '/api/watch')).status, 401, 'стара сесія на іншому пристрої завершена');
  assert.equal((await stranger('POST', '/api/auth/reset', { token: resetToken, password: 'another-pass-2' })).status, 400, 'посилання одноразове');
  assert.equal((await client()('POST', '/api/auth/login', { email: 'ivan@test.ua', password: 'password123' })).status, 401, 'старий пароль не працює');
  assert.equal((await client()('POST', '/api/auth/login', { email: 'ivan@test.ua', password: 'new-password-1' })).status, 200);

  const { events } = (await admin('GET', '/api/admin/events?type=auth.reset')).data;
  assert.ok(events.some((e) => e.message.includes('ivan@test.ua')), 'зміну пароля записано в журнал');

  // Сповіщення про знижку приходить і листом (пошту підтверджено, листи не вимкнено)
  const { results } = (await stranger('GET', '/api/search?q=terraria&store=steam')).data;
  r = await stranger('POST', '/api/watch', { offer: results[0], extra: [], minDiscount: null, maxPriceUah: 100000, notifyFree: true });
  assert.equal(r.status, 200);
  await admin('POST', '/api/admin/jobs/prices/run');
  const dealLetter = await waitFor(async () => {
    const { items } = (await admin('GET', '/api/admin/outbox')).data;
    return items.find((m) => m.to === 'ivan@test.ua' && ['deal', 'free'].includes(m.kind));
  }).catch(() => null);
  assert.ok(dealLetter, 'лист про знижку');
  assert.match(dealLetter.subject, /Terraria/);
  // У гри є пропозиції і Steam, і GOG; демо-ціни випадкові, тож лист може бути про будь-який із магазинів
  assert.ok(dealLetter.links.some((l) => /steampowered\.com|gog\.com/.test(l)), 'у листі посилання на магазин');
});

test('Імпорт списку бажаного Steam: перегляд, закритий профіль, додавання і пошук у GOG', async () => {
  assert.equal((await client()('GET', '/api/steam/wishlist?profile=testgamer')).status, 401, 'лише після входу');
  let r = await user('GET', '/api/steam/wishlist?profile=це не посилання');
  assert.equal(r.status, 400);

  r = await user('GET', `/api/steam/wishlist?profile=${encodeURIComponent('https://steamcommunity.com/id/testgamer/')}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.profile.name, 'Тестовий гравець');
  assert.equal(r.data.total, 4);
  assert.deepEqual(
    r.data.items.map((i) => i.title),
    ['Stardew Valley', 'Hollow Knight', 'Майбутня гра', 'Terraria'],
    'порядок як у Steam: спершу впорядковані, далі нові зверху'
  );
  const stardew = r.data.items[0];
  assert.deepEqual([stardew.price, stardew.basePrice, stardew.discount], [17175, 22900, 25]);
  assert.ok(stardew.discountEndsAt, 'є дата завершення знижки');
  assert.equal(stardew.imageUrl, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/413150/capsule_231x87.jpg?t=1');
  assert.equal(r.data.items[1].inList, true, 'Hollow Knight уже у списку');
  assert.equal(r.data.items[2].comingSoon, true);
  assert.equal((await user('GET', '/api/me')).data.user.steamId, '76561190000000001', 'профіль запам’ятовано');

  r = await user('GET', '/api/steam/wishlist?profile=privategamer');
  assert.equal(r.status, 404);
  assert.match(r.data.error, /прихований/);
  assert.equal(r.data.details.code, 'wishlist_hidden', 'браузер покаже покрокову підказку');
  assert.equal((await user('GET', '/api/steam/wishlist?profile=nosuchgamer')).status, 404);

  // Додаємо три ігри: одна вже є, дві нові — з умовою «знижка від 30%»
  const before = (await user('GET', '/api/watch')).data.items.length;
  r = await user('POST', '/api/steam/wishlist/import', { appids: ['413150', '105600', '367520'], minDiscount: 30 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.added.map((a) => a.title).sort(), ['Stardew Valley', 'Terraria']);
  assert.deepEqual(r.data.skipped, [{ title: 'Hollow Knight', reason: 'уже є у списку' }]);
  const list = (await user('GET', '/api/watch')).data.items;
  assert.equal(list.length, before + 2);
  assert.equal(list.find((i) => i.title === 'Terraria').minDiscount, 30);

  // У фоні та сама гра знаходиться в GOG і додається для порівняння цін
  const linked = await waitFor(async () => {
    const items = (await user('GET', '/api/watch')).data.items;
    return items.find((i) => i.title === 'Stardew Valley' && i.offers.some((o) => o.store === 'gog'));
  }, 5000);
  assert.ok(linked);

  assert.equal((await user('POST', '/api/steam/wishlist/import', { appids: [] })).status, 400);
  assert.equal((await user('POST', '/api/steam/wishlist/import', { appids: ['413150'], minDiscount: 500 })).status, 400);
});

test('Акаунт: зміна пароля і пошти, мої дані, видалення', async () => {
  const marko = client();
  const phone = client(); // той самий користувач на іншому пристрої
  await marko('POST', '/api/auth/register', { name: 'Марко', email: 'marko@test.ua', password: 'password123' });
  await phone('POST', '/api/auth/login', { email: 'marko@test.ua', password: 'password123' });
  const { results } = (await marko('GET', '/api/search?q=celeste&store=steam')).data;
  await marko('POST', '/api/watch', { offer: results[0], minDiscount: 40 });

  // Пароль
  let r = await marko('POST', '/api/me/password', { current: 'wrong-pass', password: 'new-password-9' });
  assert.equal(r.status, 400);
  assert.equal(r.data.details.field, 'current');
  assert.equal((await marko('POST', '/api/me/password', { current: 'password123', password: 'password123' })).status, 400, 'той самий пароль');
  r = await marko('POST', '/api/me/password', { current: 'password123', password: 'new-password-9' });
  assert.equal(r.status, 200);
  assert.equal((await marko('GET', '/api/watch')).status, 200, 'на цьому пристрої вхід лишається');
  assert.equal((await phone('GET', '/api/watch')).status, 401, 'на іншому — вихід');

  // Пошта
  assert.equal((await marko('POST', '/api/me/email', { email: 'olia@test.ua', current: 'new-password-9' })).status, 400, 'чужа пошта');
  r = await marko('POST', '/api/me/email', { email: 'marko.new@test.ua', current: 'new-password-9' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'marko.new@test.ua');
  assert.equal(r.data.user.emailVerified, false, 'нову пошту треба підтвердити');
  const { items: letters } = (await admin('GET', '/api/admin/outbox')).data;
  assert.ok(letters.some((m) => m.to === 'marko.new@test.ua' && m.kind === 'verify'), 'лист на нову пошту');

  // Мої дані
  const exp = await marko.download('/api/me/export.json');
  assert.equal(exp.status, 200);
  const data = JSON.parse(exp.bytes.toString('utf8'));
  assert.equal(data.profile.email, 'marko.new@test.ua');
  assert.equal(data.watchlist[0].title, 'Celeste');
  assert.equal(data.watchlist[0].conditions.minDiscount, 40);
  assert.ok(!exp.bytes.toString().includes('scrypt'), 'хешу пароля у файлі немає');

  // Видалення
  assert.equal((await marko('POST', '/api/me/delete', { current: 'password123' })).status, 400, 'старий пароль не підходить');
  r = await marko('POST', '/api/me/delete', { current: 'new-password-9' });
  assert.equal(r.status, 200);
  assert.equal((await marko('GET', '/api/watch')).status, 401, 'сесію завершено');
  const { events } = (await admin('GET', '/api/admin/events?limit=500')).data;
  const journal = JSON.stringify(events);
  assert.ok(!journal.includes('marko.new@test.ua') && !journal.includes('marko@test.ua'), 'у журналі знеособлено і нову, і стару пошту');
  assert.ok(events.some((e) => e.type === 'account.delete'));
  assert.equal((await client()('POST', '/api/auth/login', { email: 'marko.new@test.ua', password: 'new-password-9' })).status, 401);

  r = await admin('POST', '/api/me/delete', { current: 'password123' });
  assert.equal(r.status, 400, 'єдиного адміністратора видалити не можна');
  assert.match(r.data.error, /єдиний адміністратор/);
});

test('Банер на головній: популярні ігри з великою знижкою і добрими відгуками', async () => {
  const r = await client()('GET', '/api/deals/featured');
  assert.equal(r.status, 200, 'банер бачать і гості');
  const items = r.data.items;
  assert.ok(items.length > 0 && items.length <= 6);
  for (const d of items) {
    assert.ok(d.discount >= 40, `${d.title}: знижка від 40%`);
    assert.ok(d.rating == null || d.rating >= 75, `${d.title}: відгуки від 75%`);
    assert.ok(d.heroImage?.startsWith('https://'), 'є широка картинка');
    if (d.store === 'steam') assert.match(d.heroImage, /library_hero\.jpg$/);
  }
  assert.equal(items[0].store, 'steam', 'першою — гра зі Steam (там найкращі картинки)');
  assert.equal(new Set(items.map((d) => `${d.store}:${d.storeId}`)).size, items.length, 'без повторів');
});

test('PWA: маніфест, іконки і service worker', async () => {
  const res = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await res.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/#/');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'є іконка для Android');
  for (const icon of manifest.icons) {
    assert.equal((await fetch(baseUrl + icon.src)).status, 200, `іконка ${icon.src} на місці`);
  }

  const sw = await fetch(`${baseUrl}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache', 'нова версія service worker підхоплюється одразу');
  assert.match(sw.headers.get('content-security-policy'), /connect-src 'self' https:/, 'service worker може зберігати обкладинки магазинів');
  assert.match((await fetch(baseUrl)).headers.get('content-security-policy'), /connect-src 'self' https:\/\/video/, 'сторінки — із суворими правилами');
});

test('База даних недоступна: 503 з поясненням, сайт працює, після відновлення все повертається без перезапуску', async () => {
  const guest = client();
  // Як після збою диска: файл бази не відкривається (на його місці тека)
  mod.closeDb();
  fs.renameSync(dbFile, `${dbFile}.saved`);
  fs.mkdirSync(dbFile);
  try {
    let r = await user('GET', '/api/watch');
    assert.equal(r.status, 503);
    assert.equal(r.data.error, 'База даних тимчасово недоступна. Спробуй трохи пізніше');
    assert.equal(r.data.details.code, 'db_unavailable');
    r = await guest('POST', '/api/auth/login', { email: 'olia@test.ua', password: 'password123' });
    assert.equal(r.status, 503);
    assert.equal((await guest('GET', '/api/health')).status, 503);
    // Сервер не впав: сторінки сайту віддаються, і браузер покаже збережені дані
    assert.equal((await fetch(`${baseUrl}/`)).status, 200);
    // Подія записана у файл журналу (у базу її записати не можна)
    const logText = fs.readFileSync(path.join(tmp, 'app.log'), 'utf8');
    assert.match(logText, /"type":"db\.unavailable"/);
  } finally {
    fs.rmdirSync(dbFile);
    fs.renameSync(`${dbFile}.saved`, dbFile);
  }
  // Базу повернули — сервер сам її відкриває, дані на місці
  const r = await user('GET', '/api/watch');
  assert.equal(r.status, 200);
  assert.ok(r.data.items.some((i) => i.title === 'Hollow Knight'));
  assert.deepEqual((await guest('GET', '/api/health')).data.db, 'ok');
});

test('Дані зберігаються після перезапуску сервера', async () => {
  await stopApp();
  await startApp();
  const guest = client();
  const r = await guest('POST', '/api/auth/login', { email: 'olia@test.ua', password: 'password123' });
  assert.equal(r.status, 200);
  const list = await guest('GET', '/api/watch');
  assert.ok(list.data.items.some((i) => i.title === 'Hollow Knight'));
  assert.equal(r.data.user.telegramLinked, true);
});
