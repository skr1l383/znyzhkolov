// Оновлення цін, історія цін і перевірка умов користувачів.
import { config } from '../config.js';
import { db, now, tx } from '../db.js';
import { log } from '../logger.js';
import { getUsdRate, toUah } from '../stores/currency.js';
import { demoHistory } from '../stores/demo.js';
import { STORE_NAMES, store } from '../stores/index.js';
import { dealMessage, notifyUser } from './notifier.js';
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
      const msg = dealMessage({ title: w.game_title }, w, evaluation, offers);
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
export async function runPriceCheck({ trigger = 'schedule' } = {}) {
  const started = Date.now();
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
  return refreshOffers(offersForGame(gameId));
}
