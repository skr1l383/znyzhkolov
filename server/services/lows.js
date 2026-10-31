// «Історичний мінімум»: найнижча ціна гри за весь час, поки ми за нею спостерігаємо.
// Джерела — щоденні ціни вітрини (deal_prices) та історія ігор зі списків користувачів (price_history).
import { db } from '../db.js';
import { getUsdRate, toUah } from '../stores/currency.js';

// Поки спостерігаємо менше двох тижнів, «мінімум» нічого не означає — значок не показуємо
export const LOW_MIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Записує ціни вітрини за сьогодні: одна найнижча ціна гри за добу. */
export function recordDealPrices(deals, at) {
  const day = at.slice(0, 10);
  const insert = db.prepare(
    `INSERT INTO deal_prices (store, store_id, day, currency, price, discount) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (store, store_id, day) DO UPDATE SET price = excluded.price, discount = excluded.discount
     WHERE excluded.price < deal_prices.price`
  );
  for (const d of deals) if (d.price != null) insert.run(d.store, String(d.storeId), day, d.currency || null, d.price, d.discount || 0);
}

/**
 * Найнижча ціна гри в її валюті й дата, з якої ведемо спостереження.
 * Порівнюємо в ціні магазину, а не в гривнях: інакше мінімум «стрибав» би разом з курсом долара.
 */
export function lowestPrice(store, storeId, currency) {
  const row = db
    .prepare(
      `SELECT MIN(price) AS low, MIN(since) AS since FROM (
         SELECT price, day AS since FROM deal_prices WHERE store = ? AND store_id = ? AND currency IS ?
         UNION ALL
         SELECT h.price, substr(h.recorded_at, 1, 10) FROM price_history h JOIN offers o ON o.id = h.offer_id
         WHERE o.store = ? AND o.store_id = ? AND o.currency IS ? AND h.price IS NOT NULL
       )`
    )
    .get(store, String(storeId), currency ?? null, store, String(storeId), currency ?? null);
  return row?.low == null ? null : row;
}

/**
 * Чи поточна ціна — історичний мінімум. Повертає дату початку спостережень або null.
 * Поточна ціна вже записана в історію, тож «мінімум» — це коли нижчої за неї ніколи не було.
 */
export function historicLowSince({ store, storeId, currency, price, discount }) {
  if (price == null || !(discount > 0)) return null;
  const low = lowestPrice(store, storeId, currency);
  if (!low || price > low.low) return null;
  return Date.now() - new Date(low.since).getTime() >= LOW_MIN_DAYS * DAY_MS ? low.since : null;
}

/**
 * Історія ціни будь-якої гри для графіка на її сторінці: у гривнях, по серії на магазин.
 * pairs — пропозиції зі сторінки ([{ store, storeId }]). Якщо гру хтось відстежує, додаються
 * всі її магазини (разом із ключами) і докладна історія з price_history. Дні до початку
 * відстеження та ігри лише з вітрини доповнюються щоденними цінами deal_prices.
 */
export function gameHistory(pairs, rate = getUsdRate().rate) {
  const offerOf = db.prepare('SELECT id, game_id FROM offers WHERE store = ? AND store_id = ?');
  const gameOffers = db.prepare('SELECT id, store, store_id FROM offers WHERE game_id = ?');
  const tracked = db.prepare('SELECT price_uah, discount, recorded_at FROM price_history WHERE offer_id = ? ORDER BY recorded_at');
  const daily = db.prepare('SELECT day, currency, price, discount FROM deal_prices WHERE store = ? AND store_id = ? ORDER BY day');

  // Одна серія на магазин: перша пропозиція магазину перемагає
  const sources = new Map();
  const addSource = (store, storeId, offerId) => {
    if (!sources.has(store)) sources.set(store, { storeId: String(storeId), offerId });
    else if (sources.get(store).storeId === String(storeId)) sources.get(store).offerId ??= offerId;
  };
  for (const { store, storeId } of pairs) {
    const own = offerOf.get(store, String(storeId));
    addSource(store, storeId, own?.id ?? null);
    if (own) for (const o of gameOffers.all(own.game_id)) addSource(o.store, o.store_id, o.id);
  }

  const series = {};
  for (const [store, { storeId, offerId }] of sources) {
    const exact = offerId ? tracked.all(offerId).map((h) => ({ t: h.recorded_at, priceUah: h.price_uah, discount: h.discount })) : [];
    const startDay = exact[0]?.t.slice(0, 10);
    const before = daily
      .all(store, storeId)
      .filter((d) => !startDay || d.day < startDay)
      .map((d) => ({ t: `${d.day}T12:00:00.000Z`, priceUah: toUah(d.price, d.currency, rate), discount: d.discount }));
    const points = [...before, ...exact].filter((p) => p.priceUah != null);
    if (points.length) series[store] = points;
  }
  return series;
}
