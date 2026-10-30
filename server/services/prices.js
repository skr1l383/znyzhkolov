// Оновлення цін, історія цін і перевірка умов користувачів.
import { config } from '../config.js';
import { db, now, tx } from '../db.js';
import { log } from '../logger.js';
import { getUsdRate, toUah } from '../stores/currency.js';
import { steamHeader } from '../stores/deals.js';
import { demoHistory } from '../stores/demo.js';
import { gogImage } from '../stores/gog.js';
import { fetchKeyPrices, findKeyGameId } from '../stores/keys.js';
import { STORE_NAMES, store } from '../stores/index.js';
import { historicLowSince } from './lows.js';
import { dealMessage, notifyUser } from './notifier.js';
import { userLang } from '../i18n.js';
import { evaluateWatch, offersForGame } from './watch.js';

const HISTORY_EVERY_MS = 20 * 60 * 60 * 1000; // навіть без змін записуємо ціну раз на ~добу

function recordHistory(offer, force) {
  if (offer.price == null) return;
  const last = db
    .prepare('SELECT price, discount, recorded_at FROM price_history WHERE offer_id = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(offer.id);
  const stale = !last || Date.now() - new Date(last.recorded_at).getTime() > HISTORY_EVERY_MS;
  const changed = !last || last.price !== offer.price || last.discount !== offer.discount;
  if (force || stale || changed) {
    db.prepare(
      'INSERT INTO price_history (offer_id, price, base_price, discount, price_uah, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(offer.id, offer.price, offer.base_price, offer.discount, offer.price_uah, now());
  }
}

// Демо-режим: одразу заповнюємо історію за 4 місяці, щоб було що показати на графіку
function seedDemoHistory(offerId, o, rate) {
  const insert = db.prepare(
    'INSERT INTO price_history (offer_id, price, base_price, discount, price_uah, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const p of demoHistory(o.basePrice ?? o.price)) {
    insert.run(offerId, p.price, p.basePrice, p.discount, toUah(p.price, o.currency, rate), p.at);
  }
}

/**
 * Створює гру (або знаходить уже існуючу) і прив'язує до неї пропозиції з магазинів.
 * Повертає id гри.
 */
export function upsertGameWithOffers(offers) {
  const rate = getUsdRate().rate;
  return tx(() => {
    let gameId = null;
    for (const o of offers) {
      const existing = db.prepare('SELECT game_id FROM offers WHERE store = ? AND store_id = ?').get(o.store, o.storeId);
      if (existing) {
        gameId = existing.game_id;
        break;
      }
    }
    const primary = offers[0];
    if (!gameId) {
      const image = offers.find((o) => o.imageUrl)?.imageUrl || null;
      gameId = Number(
        db.prepare('INSERT INTO games (title, image_url, created_at) VALUES (?, ?, ?)').run(primary.title, image, now())
          .lastInsertRowid
      );
    }

    // Гра могла з'явитися без обкладинки — беремо її з магазину, що додається зараз
    const image = offers.find((o) => o.imageUrl)?.imageUrl;
    if (image) db.prepare('UPDATE games SET image_url = ? WHERE id = ? AND image_url IS NULL').run(image, gameId);

    for (const o of offers) {
      const existing = db.prepare('SELECT id, game_id FROM offers WHERE store = ? AND store_id = ?').get(o.store, o.storeId);
      if (existing) continue; // вже прив'язана (до цієї або іншої гри)
      // з одного магазину до гри прив'язуємо лише одну пропозицію
      const sameStore = db.prepare('SELECT id FROM offers WHERE game_id = ? AND store = ?').get(gameId, o.store);
      if (sameStore) continue;
      const priceUah = toUah(o.price, o.currency, rate);
      const info = db
        .prepare(
          `INSERT INTO offers (game_id, store, store_id, title, url, image_url, currency, price, base_price,
             discount, is_free, price_uah, available, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(gameId, o.store, o.storeId, o.title, o.url, o.imageUrl, o.currency, o.price, o.basePrice,
          o.discount || 0, o.isFree ? 1 : 0, priceUah, now());
      const offerId = Number(info.lastInsertRowid);
      if (config.demoStores) seedDemoHistory(offerId, o, rate);
      recordHistory({ id: offerId, price: o.price, base_price: o.basePrice, discount: o.discount || 0, price_uah: priceUah }, true);
    }
    return gameId;
  });
}

function applyPrice(offer, data, rate) {
  const checkedAt = now();
  if (!data || data.missing) {
    db.prepare('UPDATE offers SET last_error = ?, checked_at = ? WHERE id = ?').run(
      'Гру не знайдено під час останньої перевірки',
      checkedAt,
      offer.id
    );
    return false;
  }
  if (data.available === false) {
    db.prepare('UPDATE offers SET available = 0, last_error = NULL, checked_at = ? WHERE id = ?').run(checkedAt, offer.id);
    return offer.available === 1;
  }

  const currency = data.currency ?? offer.currency;
  const updated = {
    ...offer,
    currency,
    price: data.price ?? null,
    base_price: data.basePrice ?? null,
    discount: data.discount || 0,
    is_free: data.isFree ? 1 : 0,
    price_uah: toUah(data.price ?? null, currency, rate),
    available: 1,
  };
  db.prepare(
    `UPDATE offers SET currency = ?, price = ?, base_price = ?, discount = ?, is_free = ?, price_uah = ?,
       available = 1, last_error = NULL, checked_at = ? WHERE id = ?`
  ).run(updated.currency, updated.price, updated.base_price, updated.discount, updated.is_free, updated.price_uah, checkedAt, offer.id);
  // У ключів найдешевший продавець може змінитися — разом з ним і посилання
  if (data.seller) db.prepare('UPDATE offers SET seller = ?, url = ? WHERE id = ?').run(data.seller, data.url, offer.id);
  recordHistory(updated, false);
  return updated.price !== offer.price || updated.discount !== offer.discount || offer.available !== 1;
}

/** Оновлює ціни для переданих пропозицій, групуючи запити по магазинах. */
export async function refreshOffers(offers) {
  const rate = getUsdRate().rate;
  const byStore = new Map();
  for (const o of offers) {
    if (!byStore.has(o.store)) byStore.set(o.store, []);
    byStore.get(o.store).push(o);
  }

  let checked = 0;
  let changed = 0;
  const errors = [];
  for (const [storeName, group] of byStore) {
    let prices;
    try {
      prices = await store(storeName).fetchPrices(group.map((o) => ({ storeId: o.store_id, title: o.title })));
    } catch (err) {
      errors.push(err.message);
      const stamp = now();
      for (const o of group) {
        db.prepare('UPDATE offers SET last_error = ?, checked_at = ? WHERE id = ?').run(err.message, stamp, o.id);
      }
      log.warn('prices.store_error', `${STORE_NAMES[storeName]} недоступний: ${err.message}. Залишаємо останні відомі ціни`);
      continue;
    }
    for (const o of group) {
      if (applyPrice(o, prices.get(String(o.store_id)), rate)) changed += 1;
      checked += 1;
    }
  }
  return { checked, changed, errors };
}

const userCache = () => {
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) cache.set(id, db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    return cache.get(id);
  };
};

/**
 * Перевіряє умови користувачів і надсилає сповіщення.
 * Повторно про ту саму ціну не повідомляємо, доки знижка не закінчиться або не зміниться.
 */
export async function evaluateWatches({ watchId = null } = {}) {
  const rows = db
    .prepare(
      `SELECT w.*, g.title AS game_title FROM watch_items w JOIN games g ON g.id = w.game_id
       WHERE w.active = 1 ${watchId ? 'AND w.id = ?' : ''}`
    )
    .all(...(watchId ? [watchId] : []));

  const getUser = userCache();
  let alerts = 0;
  for (const w of rows) {
    const offers = offersForGame(w.game_id);
    const evaluation = evaluateWatch(w, offers);
    if (evaluation.met && evaluation.key !== w.last_alert_key) {
      const user = getUser(w.user_id);
      if (!user) continue;
      const o = evaluation.trigger.offer;
      const lowSince = o.is_free ? null : historicLowSince({ store: o.store, storeId: o.store_id, currency: o.currency, price: o.price, discount: o.discount });
      const msg = dealMessage({ title: w.game_title }, w, evaluation, offers, lowSince, userLang(user));
      await notifyUser(user, { kind: evaluation.trigger.offer.is_free ? 'free' : 'deal', gameId: w.game_id, ...msg });
      db.prepare('UPDATE watch_items SET last_alert_key = ?, last_alert_at = ? WHERE id = ?').run(evaluation.key, now(), w.id);
      alerts += 1;
    } else if (!evaluation.met && w.last_alert_key) {
      db.prepare('UPDATE watch_items SET last_alert_key = NULL WHERE id = ?').run(w.id);
    }
  }
  return alerts;
}

/** Повна перевірка: усі ігри, які хтось відстежує. Запускається за розкладом або вручну. */
// Ігри, яких немає в CheapShark, не перепитуємо частіше ніж раз на добу
const noKeys = new Map();
const NO_KEYS_MS = 24 * 60 * 60 * 1000;

/**
 * До ігор зі Steam додає пропозицію «ключ Steam в офіційному магазині», якщо такий ключ продається.
 * Без gameIds — для всіх ігор, за якими хтось стежить.
 */
export async function linkKeyOffers(gameIds = null) {
  if (config.demoStores) return 0;
  const rows = db
    .prepare(
      `SELECT o.game_id, o.store_id, g.title FROM offers o JOIN games g ON g.id = o.game_id
       WHERE o.store = 'steam'
         AND NOT EXISTS (SELECT 1 FROM offers k WHERE k.game_id = o.game_id AND k.store = 'keys')
         AND EXISTS (SELECT 1 FROM watch_items w WHERE w.game_id = o.game_id AND w.active = 1)`
    )
    .all()
    .filter((r) => (!gameIds || gameIds.includes(r.game_id)) && !(Date.now() - (noKeys.get(r.store_id) || 0) < NO_KEYS_MS));
  const rate = getUsdRate().rate;
  let linked = 0;
  for (const r of rows) {
    try {
      const keyId = await findKeyGameId(r.store_id);
      const deal = keyId && (await fetchKeyPrices([{ storeId: keyId }])).get(keyId);
      if (!deal?.available) {
        noKeys.set(r.store_id, Date.now());
        continue;
      }
      // Та сама гра CheapShark могла вже бути прив'язана до іншої нашої гри — тоді пропускаємо
      if (db.prepare("SELECT 1 FROM offers WHERE store = 'keys' AND store_id = ?").get(keyId)) continue;
      const priceUah = toUah(deal.price, deal.currency, rate);
      const info = db
        .prepare(
          `INSERT INTO offers (game_id, store, store_id, title, url, currency, price, base_price, discount, is_free,
             price_uah, available, checked_at, seller)
           VALUES (?, 'keys', ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`
        )
        .run(r.game_id, keyId, r.title, deal.url, deal.currency, deal.price, deal.basePrice, deal.discount, priceUah, now(), deal.seller);
      recordHistory({ id: Number(info.lastInsertRowid), price: deal.price, base_price: deal.basePrice, discount: deal.discount, price_uah: priceUah }, true);
      linked += 1;
    } catch (err) {
      // CheapShark недоступний — сайт працює зі Steam і GOG, спробуємо під час наступної перевірки
      log.warn('keys.link', `Не вдалося перевірити ключі для «${r.title}»: ${err.message}`);
      break;
    }
  }
  return linked;
}

export async function runPriceCheck({ trigger = 'schedule' } = {}) {
  const started = Date.now();
  await linkKeyOffers();
  const offers = db
    .prepare(
      `SELECT DISTINCT o.* FROM offers o
       JOIN watch_items w ON w.game_id = o.game_id
       WHERE w.active = 1`
    )
    .all();
  const result = await refreshOffers(offers);
  const alerts = await evaluateWatches();
  const summary = { ...result, alerts, ms: Date.now() - started, trigger };
  log.info(
    'prices.check',
    `Перевірено цін: ${result.checked}, змінилось: ${result.changed}, сповіщень: ${alerts} (${summary.ms} мс)`,
    { meta: summary }
  );
  return summary;
}

export async function refreshGame(gameId) {
  await linkKeyOffers([gameId]);
  return refreshOffers(offersForGame(gameId));
}

/**
 * Лагодить картинки вже збережених ігор (виконується при запуску):
 * важкі PNG з GOG замінюються стиснутими, а гра без обкладинки бере її з будь-якого свого магазину
 * або, якщо є Steam, — велику обкладинку Steam за номером гри.
 */
export function repairImages() {
  let fixed = 0;
  for (const table of ['games', 'offers', 'deals']) {
    const rows = db.prepare(`SELECT rowid AS id, image_url FROM ${table} WHERE image_url LIKE 'https://images.gog-statics.com/%'`).all();
    for (const r of rows) {
      const better = gogImage(r.image_url);
      if (better !== r.image_url) {
        db.prepare(`UPDATE ${table} SET image_url = ? WHERE rowid = ?`).run(better, r.id);
        fixed++;
      }
    }
  }
  for (const g of db.prepare('SELECT id FROM games WHERE image_url IS NULL').all()) {
    const fromOffer = db.prepare('SELECT image_url FROM offers WHERE game_id = ? AND image_url IS NOT NULL').get(g.id)?.image_url;
    const steamId = db.prepare("SELECT store_id FROM offers WHERE game_id = ? AND store = 'steam'").get(g.id)?.store_id;
    const image = fromOffer || (steamId ? steamHeader(steamId) : null);
    if (image) {
      db.prepare('UPDATE games SET image_url = ? WHERE id = ?').run(image, g.id);
      fixed++;
    }
  }
  if (fixed) log.info('images.repair', `Виправлено обкладинок: ${fixed}`);
  return fixed;
}
