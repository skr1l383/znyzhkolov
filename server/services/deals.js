// Вітрина знижок: оновлення за розкладом і вибірка з фільтрами для головної сторінки.
import { config } from '../config.js';
import { db, getSetting, now, setSetting, tx } from '../db.js';
import { log } from '../logger.js';
import { getUsdRate, toUah } from '../stores/currency.js';
import { fetchGogDeals, fetchSteamSpecials } from '../stores/deals.js';
import { GENRE_KEYS, fetchSteamExtras } from '../stores/genres.js';
import { demoDeals } from '../stores/demo.js';
import { normalizeTitle } from '../stores/match.js';
import { historicLowSince, recordDealPrices } from './lows.js';
import { STORE_NAMES } from '../stores/index.js';

/** Перезаписує вітрину одного магазину. Якщо магазин не відповів, лишаються вчорашні дані. */
function saveStore(store, deals, rate) {
  const at = now();
  tx(() => {
    db.prepare('DELETE FROM deals WHERE store = ?').run(store);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO deals (store, store_id, title, search_title, url, image_url, image_fallback, currency, price, base_price,
         discount, price_uah, base_price_uah, rating, rank, updated_at, genres, companies, hero_url, hero_small_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    deals.forEach((d, i) => {
      insert.run(d.store, d.storeId, d.title, normalizeTitle(d.title), d.url, d.imageUrl, d.imageFallback || null, d.currency, d.price, d.basePrice,
        d.discount, toUah(d.price, d.currency, rate), toUah(d.basePrice, d.currency, rate), d.rating, i + 1, at,
        d.genres?.length ? `,${d.genres.join(',')},` : null, d.companies?.length ? d.companies.join('\n') : null, d.heroUrl || null, d.heroSmallUrl || null);
    });
    recordDealPrices(deals, at);
  });
  setSetting(`deals:${store}:updated_at`, at);
}

/**
 * Сторінка знижок Steam не містить жанрів, студій і точних адрес картинок — догружаємо їх окремо.
 * Не вийшло — вітрина буде без них, а картинки візьмемо за стандартною адресою.
 */
async function withSteamExtras(deals) {
  try {
    const extras = await fetchSteamExtras(deals.map((d) => d.storeId));
    return deals.map((d) => ({ ...d, ...extras.get(String(d.storeId)) }));
  } catch (err) {
    log.warn('deals.extras', `Жанри Steam недоступні: ${err.message}`);
    return deals;
  }
}

export async function refreshDeals() {
  const rate = getUsdRate().rate;
  // Вітрина справжня навіть у демо-режимі (тестові там лише ціни ігор зі списку).
  // DEALS_SOURCE=demo — тестова вітрина без інтернету (так працюють автотести).
  const sources =
    config.dealsSource === 'demo'
      ? Object.entries(await demoDeals()).map(([store, deals]) => [store, async () => deals])
      : [
          ['steam', () => fetchSteamSpecials(250).then(withSteamExtras)],
          ['gog', () => fetchGogDeals(150)],
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
export function listDeals({ store, minDiscount, maxPriceUah, q, genre, company, sort = 'popular', limit = 24, offset = 0, userId = null }) {
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
  if (GENRE_KEYS.includes(genre)) {
    where.push('genres LIKE ?');
    args.push(`%,${genre},%`);
  }
  if (company) {
    where.push("companies LIKE ? ESCAPE '!'");
    args.push(`%${company.replace(/[!%_]/g, (c) => `!${c}`)}%`);
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

  const watching = watchingSet(userId);
  return { total, items: rows.map((r) => dealItem(r, watching)) };
}

/** Ігри, за якими користувач уже стежить, — щоб позначити їх на вітрині «У списку». */
function watchingSet(userId) {
  if (!userId) return new Set();
  return new Set(
    db
      .prepare('SELECT o.store, o.store_id FROM offers o JOIN watch_items w ON w.game_id = o.game_id WHERE w.user_id = ?')
      .all(userId)
      .map((r) => `${r.store}:${r.store_id}`)
  );
}

/** Що є на вітрині зараз: скільки ігор кожного жанру і найчастіші студії — для фільтрів. */
export function dealFacets() {
  const rows = db.prepare('SELECT genres, companies FROM deals').all();
  const genres = Object.fromEntries(GENRE_KEYS.map((k) => [k, 0]));
  const companies = new Map();
  for (const r of rows) {
    for (const k of (r.genres || '').split(',')) if (k in genres) genres[k] += 1;
    // Без різниці в регістрі: «CAPCOM» і «Capcom» рахуємо разом, показуємо перше написання
    for (const c of (r.companies || '').split('\n')) {
      if (!c) continue;
      const hit = companies.get(c.toLowerCase()) || { name: c, count: 0 };
      hit.count += 1;
      companies.set(c.toLowerCase(), hit);
    }
  }
  return {
    genres: GENRE_KEYS.filter((k) => genres[k] > 0).map((k) => ({ key: k, count: genres[k] })),
    companies: [...companies.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 80),
  };
}

function dealItem(r, watching) {
  return {
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
    // Дата, з якої ціна не була нижчою, — значок «Історичний мінімум»
    historicLow: historicLowSince({ store: r.store, storeId: r.store_id, currency: r.currency, price: r.price, discount: r.discount }),
    watching: watching.has(`${r.store}:${r.store_id}`),
  };
}

/** Широка картинка для банера: у Steam — «library_hero» 1920×620, у GOG — обкладинка 1020×574. */
function heroImage(r) {
  if (r.store === 'steam') return r.hero_url || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${r.store_id}/library_hero.jpg`;
  return r.image_url?.replace(/_product_tile_398_2x\.jpg$/, '_ggvgm_2x.jpg') || r.image_url;
}

/**
 * Банер на головній: найпопулярніші ігри з великою знижкою (від 40%) і добрими відгуками (від 75%).
 * Чергуємо магазини: два зі Steam, один з GOG.
 */
export function featuredDeals({ userId = null, limit = 6 } = {}) {
  const pick = db.prepare(
    `SELECT * FROM deals WHERE store = ? AND discount >= 40 AND (rating IS NULL OR rating >= 75) ORDER BY rank LIMIT ?`
  );
  const steam = pick.all('steam', limit);
  const gog = pick.all('gog', Math.ceil(limit / 3));
  const rows = [];
  while (rows.length < limit && (steam.length || gog.length)) {
    for (const source of [steam, steam, gog]) if (source.length && rows.length < limit) rows.push(source.shift());
  }
  const watching = watchingSet(userId);
  return rows.map((r) => ({
    ...dealItem(r, watching),
    heroImage: heroImage(r),
    // Для телефона: у GOG — звичайна обкладинка (вона й так ~800 px завширшки)
    heroSmall: (r.store === 'steam' ? r.hero_small_url : r.image_url) || null,
    // Якщо великої картинки немає (буває в зовсім нових ігор) — звичайна обкладинка
    heroFallback: r.image_fallback || r.image_url,
  }));
}

/** Коли вітрину оновлювали і скільки в ній ігор з кожного магазину. */
export function dealsStatus() {
  const counts = Object.fromEntries(db.prepare('SELECT store, COUNT(*) AS n FROM deals GROUP BY store').all().map((r) => [r.store, r.n]));
  return {
    counts,
    updatedAt: ['steam', 'gog'].map((s) => getSetting(`deals:${s}:updated_at`)).filter(Boolean).sort().pop() || null,
  };
}
