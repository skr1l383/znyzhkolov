// Список відстеження: умови сповіщень і перевірка, чи виконана умова.
import { db } from '../db.js';
import { toUah } from '../stores/currency.js';

/**
 * Перевіряє умову користувача для поточних цін у всіх магазинах.
 * Умова виконана, якщо хоча б в одному магазині:
 *  - гру роздають безкоштовно (якщо увімкнено notify_free);
 *  - знижка не менша за min_discount;
 *  - ціна в гривнях не більша за max_price_uah.
 */
export function evaluateWatch(watch, offers) {
  const hits = [];
  for (const o of offers) {
    if (!o.available || o.price == null) continue;
    const reasons = [];
    if (watch.notify_free && o.is_free) reasons.push('free');
    if (watch.min_discount != null && o.discount >= watch.min_discount && o.discount > 0) reasons.push('discount');
    if (watch.max_price_uah != null && o.price_uah != null && o.price_uah <= watch.max_price_uah) reasons.push('price');
    if (reasons.length) hits.push({ offer: o, reasons });
  }
  if (!hits.length) return { met: false, trigger: null, key: null };

  hits.sort((a, b) => (a.offer.price_uah ?? Infinity) - (b.offer.price_uah ?? Infinity));
  const trigger = hits[0];
  const key = `${trigger.offer.store}:${trigger.offer.price}:${trigger.offer.discount}`;
  return { met: true, trigger, hits, key };
}

export function bestOffer(offers) {
  return (
    offers
      .filter((o) => o.available && o.price_uah != null)
      .sort((a, b) => a.price_uah - b.price_uah)[0] || null
  );
}

export function offersForGame(gameId) {
  return db
    .prepare(
      `SELECT * FROM offers WHERE game_id = ?
       ORDER BY CASE store WHEN 'steam' THEN 0 WHEN 'gog' THEN 1 ELSE 2 END`
    )
    .all(gameId);
}

export function publicOffer(o) {
  return {
    id: o.id,
    store: o.store,
    storeId: o.store_id,
    title: o.title,
    url: o.url,
    currency: o.currency,
    price: o.price,
    basePrice: o.base_price,
    discount: o.discount,
    isFree: Boolean(o.is_free),
    priceUah: o.price_uah,
    basePriceUah: toUah(o.base_price, o.currency),
    available: Boolean(o.available),
    checkedAt: o.checked_at,
    error: o.last_error,
  };
}

export function publicWatch(w, offers) {
  const evaluation = evaluateWatch(w, offers);
  const best = bestOffer(offers);
  return {
    id: w.id,
    gameId: w.game_id,
    title: w.title,
    imageUrl: w.image_url,
    minDiscount: w.min_discount,
    maxPriceUah: w.max_price_uah,
    notifyFree: Boolean(w.notify_free),
    active: Boolean(w.active),
    createdAt: w.created_at,
    lastAlertAt: w.last_alert_at,
    conditionMet: evaluation.met,
    bestStore: best?.store || null,
    offers: offers.map(publicOffer),
  };
}

export function listWatch(userId) {
  const rows = db
    .prepare(
      `SELECT w.*, g.title, g.image_url FROM watch_items w
       JOIN games g ON g.id = w.game_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC`
    )
    .all(userId);
  return rows.map((w) => publicWatch(w, offersForGame(w.game_id)));
}

export function getWatch(userId, id) {
  const w = db
    .prepare(
      `SELECT w.*, g.title, g.image_url FROM watch_items w
       JOIN games g ON g.id = w.game_id WHERE w.user_id = ? AND w.id = ?`
    )
    .get(userId, id);
  return w ? publicWatch(w, offersForGame(w.game_id)) : null;
}

/** Підсумок списку: найдешевша пропозиція кожної гри, скільки все коштує зараз і без знижок, скільки умов виконано. */
export function summarizeWatch(items) {
  const rows = items.map((item) => {
    const priced = item.offers.filter((o) => o.available && o.priceUah != null);
    const best = priced.sort((a, b) => a.priceUah - b.priceUah)[0] || null;
    const by = (store) => item.offers.find((o) => o.store === store);
    return { item, best, steam: by('steam'), gog: by('gog') };
  });
  const priced = rows.filter((r) => r.best);
  const now = priced.reduce((s, r) => s + r.best.priceUah, 0);
  const regular = priced.reduce((s, r) => s + (r.best.basePriceUah ?? r.best.priceUah), 0);
  return {
    rows,
    now,
    regular,
    savings: regular - now,
    met: items.filter((i) => i.active && i.conditionMet).length,
  };
}
