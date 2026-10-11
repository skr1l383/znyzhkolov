// Вітрина знижок: оновлення за розкладом і вибірка з фільтрами для головної сторінки.
import { config } from '../config.js';
import { db, getSetting, now, setSetting, tx } from '../db.js';
import { log } from '../logger.js';
import { getUsdRate, toUah } from '../stores/currency.js';
import { fetchGogDeals, fetchSteamSpecials } from '../stores/deals.js';
import { demoDeals } from '../stores/demo.js';
import { normalizeTitle } from '../stores/match.js';
import { STORE_NAMES } from '../stores/index.js';

/** Перезаписує вітрину одного магазину. Якщо магазин не відповів, лишаються вчорашні дані. */
function saveStore(store, deals, rate) {
  const at = now();
  tx(() => {
    db.prepare('DELETE FROM deals WHERE store = ?').run(store);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO deals (store, store_id, title, search_title, url, image_url, image_fallback, currency, price, base_price,
         discount, price_uah, base_price_uah, rating, rank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    deals.forEach((d, i) => {
      insert.run(d.store, d.storeId, d.title, normalizeTitle(d.title), d.url, d.imageUrl, d.imageFallback || null, d.currency, d.price, d.basePrice,
        d.discount, toUah(d.price, d.currency, rate), toUah(d.basePrice, d.currency, rate), d.rating, i + 1, at);
    });
  });
  setSetting(`deals:${store}:updated_at`, at);
}

export async function refreshDeals() {
  const rate = getUsdRate().rate;
  const sources = config.demoStores
    ? Object.entries(await demoDeals()).map(([store, deals]) => [store, async () => deals])
    : [
        ['steam', () => fetchSteamSpecials(100)],
        ['gog', () => fetchGogDeals(60)],
      ];
  const result = {};
  const errors = [];
  for (const [store, load] of sources) {
    try {
      const deals = await load();
      saveStore(store, deals, rate);
      result[store] = deals.length;
    } catch (err) {
      errors.push(`${STORE_NAMES[store]}: ${err.message}`);
      setSetting(`deals:${store}:error`, err.message);
    }
  }
  const message = `Вітрина оновлена: ${Object.entries(result).map(([s, n]) => `${STORE_NAMES[s]} ${n}`).join(', ') || 'нічого'}`;
  if (errors.length) log.warn('deals.refresh', `${message}; помилки — ${errors.join('; ')}`, { meta: { result, errors } });
  else log.info('deals.refresh', message, { meta: result });
  return { ...result, errors };
}

const SORTS = {
  popular: 'rank ASC, store DESC', // по черзі: найпопулярніша в Steam, найпопулярніша в GOG, друга...
  discount: 'discount DESC, rank ASC',
  cheap: 'price_uah ASC, rank ASC',
  rating: 'rating IS NULL, rating DESC, rank ASC',
};

/**
 * Ігри вітрини з фільтрами. Усі фільтри виконуються в самій базі даних (WHERE),
 * тому сторінка не завантажує зайвого.
 */
export function listDeals({ store, minDiscount, maxPriceUah, q, sort = 'popular', limit = 24, offset = 0, userId = null }) {
  const where = [];
  const args = [];
  if (store) {
    where.push('store = ?');
    args.push(store);
  }
  if (minDiscount) {
    where.push('discount >= ?');
    args.push(minDiscount);
  }
  if (maxPriceUah != null) {
    where.push('price_uah <= ?');
    args.push(maxPriceUah);
  }
  const search = normalizeTitle(q);
  if (search) {
    // % і _ у LIKE — службові символи, тож екрануємо їх знаком «!»
    where.push("search_title LIKE ? ESCAPE '!'");
    args.push(`%${search.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM deals ${whereSql}`).get(...args).n;
  const rows = db
    .prepare(`SELECT * FROM deals ${whereSql} ORDER BY ${SORTS[sort] || SORTS.popular} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);

  // Позначаємо ігри, за якими користувач уже стежить
  const watching = new Set(
    userId
      ? db
          .prepare('SELECT o.store, o.store_id FROM offers o JOIN watch_items w ON w.game_id = o.game_id WHERE w.user_id = ?')
          .all(userId)
          .map((r) => `${r.store}:${r.store_id}`)
      : []
  );

  return {
    total,
    items: rows.map((r) => ({
      store: r.store,
      storeId: r.store_id,
      title: r.title,
      url: r.url,
      imageUrl: r.image_url,
      imageFallback: r.image_fallback,
      currency: r.currency,
      price: r.price,
      basePrice: r.base_price,
      discount: r.discount,
      priceUah: r.price_uah,
      basePriceUah: r.base_price_uah,
      rating: r.rating,
      watching: watching.has(`${r.store}:${r.store_id}`),
    })),
  };
}

/** Коли вітрину оновлювали і скільки в ній ігор з кожного магазину. */
export function dealsStatus() {
  const counts = Object.fromEntries(db.prepare('SELECT store, COUNT(*) AS n FROM deals GROUP BY store').all().map((r) => [r.store, r.n]));
  return {
    counts,
    updatedAt: ['steam', 'gog'].map((s) => getSetting(`deals:${s}:updated_at`)).filter(Boolean).sort().pop() || null,
  };
}
