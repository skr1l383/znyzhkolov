// Сторінка гри: усе про гру з обох магазинів в одній відповіді.
// Опис і медіа беруться зі Steam (там вони найповніші), а якщо гри в Steam немає — з GOG.
// Зібране зберігається в базі на кілька годин; ціни щоразу беруться свіжі з бази.
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import { getUsdRate, toUah } from '../stores/currency.js';
import { fetchGogDetails, fetchSteamDetails, fetchSteamEnglishTitle } from '../stores/details.js';
import { searchGog } from '../stores/gog.js';
import { rankMatches } from '../stores/match.js';
import { searchSteam } from '../stores/steam.js';

const CACHE_HOURS = 6;

function cached(store, storeId, lang) {
  const row = db.prepare('SELECT data, fetched_at FROM game_details WHERE store = ? AND store_id = ? AND lang = ?').get(store, storeId, lang);
  if (!row || Date.now() - new Date(row.fetched_at).getTime() > CACHE_HOURS * 3600 * 1000) return null;
  return JSON.parse(row.data);
}

function save(info, lang) {
  const data = JSON.stringify(info);
  const stamp = now();
  // Під обома ідентифікаторами: сторінку можна відкрити і зі Steam, і з GOG
  for (const o of info.offers) {
    db.prepare(
      `INSERT INTO game_details (store, store_id, lang, data, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(store, store_id, lang) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
    ).run(o.store, o.storeId, lang, data, stamp);
  }
}

/** Та сама гра в іншому магазині — лише з дуже схожою назвою, щоб не підставити чужу гру. */
async function findMatch(search, title) {
  try {
    return rankMatches(title, await search(title), 0.9)[0] || null;
  } catch {
    return null; // інший магазин не відповів — сторінка покаже один магазин
  }
}

const offerOf = (store, storeId, title, url, image, p) => ({
  store,
  storeId: String(storeId),
  title,
  url,
  imageUrl: image,
  currency: p?.currency ?? null,
  price: p?.price ?? null,
  basePrice: p?.basePrice ?? null,
  discount: p?.discount ?? 0,
});

async function build(store, storeId, lang) {
  let steam = null;
  let gog = null;
  let gogPrice = null;

  if (store === 'steam') {
    steam = await fetchSteamDetails(storeId, lang);
    if (!steam) throw new HttpError(404, 'Такої гри в Steam немає');
    // Для пошуку в GOG потрібна англійська назва, а Steam може віддати українську
    const englishTitle = /[^ -~]/.test(steam.title) ? await fetchSteamEnglishTitle(storeId).catch(() => null) : steam.title;
    gogPrice = await findMatch(searchGog, englishTitle || steam.title);
    if (gogPrice) gog = await fetchGogDetails(gogPrice.storeId, lang).catch(() => null);
  } else {
    gog = await fetchGogDetails(storeId, lang);
    if (!gog) throw new HttpError(404, 'Такої гри в GOG немає');
    gogPrice = (await searchGog(gog.title).catch(() => [])).find((r) => r.storeId === String(storeId)) || null;
    const steamMatch = await findMatch((t) => searchSteam(t, { language: 'english' }), gog.title);
    if (steamMatch) steam = await fetchSteamDetails(steamMatch.storeId, lang).catch(() => null);
  }

  const main = steam || gog;
  const offers = [];
  if (steam) offers.push(offerOf('steam', steam.storeId, steam.title, steam.url, steam.headerImage, steam.price));
  if (gog || gogPrice) {
    offers.push(
      offerOf('gog', gogPrice?.storeId || gog.storeId, gogPrice?.title || gog.title, gogPrice?.url || gog.url, gogPrice?.imageUrl, gogPrice)
    );
  }

  return {
    title: main.title,
    shortDescription: steam?.shortDescription || '',
    description: steam?.description?.length ? steam.description : gog?.description?.length ? gog.description : [steam?.shortDescription].filter(Boolean),
    headerImage: steam?.headerImage || gogPrice?.imageUrl || null,
    background: steam?.background || gog?.background || null,
    screenshots: steam?.screenshots?.length ? steam.screenshots : gog?.screenshots || [],
    videos: [...(steam?.videos || []), ...(gog?.videos || [])].slice(0, 6),
    genres: steam?.genres || [],
    developers: steam?.developers || [],
    publishers: steam?.publishers || [],
    releaseDate: steam?.releaseDate || gog?.releaseDate || null,
    comingSoon: Boolean(main.comingSoon),
    metacritic: steam?.metacritic ?? null,
    platforms: main.platforms || [],
    reviews: steam?.reviews || null,
    isFree: Boolean(steam?.isFree),
    offers,
  };
}

/**
 * Актуальна ціна пропозиції: якщо гру хтось відстежує — з таблиці offers (її оновлює розклад),
 * якщо вона на вітрині — з таблиці deals, інакше — та, що прийшла з магазину разом з описом.
 */
function currentPrice(o, rate) {
  const tracked = db.prepare('SELECT currency, price, base_price, discount FROM offers WHERE store = ? AND store_id = ?').get(o.store, o.storeId);
  const deal = tracked ? null : db.prepare('SELECT currency, price, base_price, discount FROM deals WHERE store = ? AND store_id = ?').get(o.store, o.storeId);
  const p = tracked || deal ? { currency: (tracked || deal).currency, price: (tracked || deal).price, basePrice: (tracked || deal).base_price, discount: (tracked || deal).discount } : o;
  return {
    ...o,
    currency: p.currency,
    price: p.price,
    basePrice: p.basePrice,
    discount: p.discount || 0,
    priceUah: toUah(p.price, p.currency, rate),
    basePriceUah: toUah(p.basePrice, p.currency, rate),
  };
}

/** Мінімальна сторінка з того, що вже є в базі, — якщо магазини зараз недоступні. */
function fromDatabase(store, storeId) {
  const row =
    db.prepare('SELECT title, image_url, url, currency, price, base_price AS basePrice, discount FROM deals WHERE store = ? AND store_id = ?').get(store, storeId) ||
    db.prepare('SELECT title, image_url, url, currency, price, base_price AS basePrice, discount FROM offers WHERE store = ? AND store_id = ?').get(store, storeId);
  if (!row) return null;
  return {
    title: row.title,
    shortDescription: '',
    description: [],
    headerImage: row.image_url,
    background: null,
    screenshots: [],
    videos: [],
    genres: [],
    developers: [],
    publishers: [],
    releaseDate: null,
    comingSoon: false,
    metacritic: null,
    platforms: [],
    reviews: null,
    isFree: false,
    offers: [offerOf(store, storeId, row.title, row.url, row.image_url, row)],
    limited: true,
  };
}

/** lang — мова інтерфейсу ('uk' або 'en'): нею Steam віддає опис, жанри й дату виходу. */
/**
 * Що вже відомо про гру без запитів до магазинів: збережена сторінка або рядок вітрини чи списку.
 * Для ШІ-порадника — він працює лише з даними, які ми самі зібрали.
 */
export function knownGame(store, storeId) {
  const row = db.prepare('SELECT data FROM game_details WHERE store = ? AND store_id = ? ORDER BY fetched_at DESC LIMIT 1').get(store, String(storeId));
  const info = row ? JSON.parse(row.data) : fromDatabase(store, String(storeId));
  if (!info) return null;
  const rate = getUsdRate().rate;
  return { ...info, offers: info.offers.map((o) => currentPrice(o, rate)) };
}

export async function getGameDetails(store, storeId, userId = null, lang = 'uk') {
  let info = cached(store, storeId, lang);
  if (!info) {
    try {
      info = await build(store, storeId, lang);
      save(info, lang);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.warn('game.details', `Не вдалося завантажити сторінку гри ${store}:${storeId}: ${err.message}`);
      info = fromDatabase(store, storeId);
      if (!info) throw new HttpError(502, 'Магазин зараз не відповідає. Спробуй відкрити сторінку трохи пізніше');
    }
  }

  const rate = getUsdRate().rate;
  const offers = info.offers.map((o) => currentPrice(o, rate));
  // Чи вже стежить користувач за цією грою (її могли додати і зі Steam, і з GOG)
  const findWatch = db.prepare(
    'SELECT w.id FROM watch_items w JOIN offers o ON o.game_id = w.game_id WHERE w.user_id = ? AND o.store = ? AND o.store_id = ?'
  );
  const watch = userId ? offers.map((o) => findWatch.get(userId, o.store, o.storeId)).find(Boolean) : null;
  return { ...info, offers, watchId: watch?.id ?? null };
}
