// «Історичний мінімум»: найнижча ціна гри за весь час, поки ми за нею спостерігаємо.
// Джерела — щоденні ціни вітрини (deal_prices) та історія ігор зі списків користувачів (price_history).
import { db } from '../db.js';

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
