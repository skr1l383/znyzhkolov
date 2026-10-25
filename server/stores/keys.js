// Ключі Steam в офіційних магазинах (Fanatical, Humble, Green Man Gaming…) через відкритий API CheapShark.
// CheapShark збирає ціни авторизованих продавців і для кожної гри вказує її id у Steam — за ним і зіставляємо.
// Ціни там для США в доларах; далі вони, як і GOG, перераховуються в гривні за курсом НБУ.
import { discountPercent, fetchJson, safeImageUrl, toMinor } from './util.js';

const API = 'https://www.cheapshark.com/api/1.0';
const NAME = 'CheapShark';

/**
 * Офіційні продавці ключів. Steam і GOG беремо напряму (там ціни для України),
 * Epic і Ubisoft — ні: у них для України свої ціни, американська вводила б в оману.
 */
export const KEY_SELLERS = {
  2: 'GamersGate',
  3: 'Green Man Gaming',
  11: 'Humble Store',
  15: 'Fanatical',
  21: 'WinGameStore',
  23: 'GameBillet',
  27: 'Gamesplanet',
  28: 'Gamesload',
  30: 'IndieGala',
  35: 'DreamGame',
};

const dealUrl = (dealId) => `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeURIComponent(dealId))}`;

/** Відповідь /games?id=… → пропозиції офіційних продавців від найдешевшої. */
export function parseKeyGame(json) {
  const deals = (Array.isArray(json?.deals) ? json.deals : [])
    .filter((d) => d && KEY_SELLERS[d.storeID] && d.dealID)
    .map((d) => {
      const price = toMinor(d.price);
      const basePrice = toMinor(d.retailPrice ?? d.price);
      return {
        seller: KEY_SELLERS[d.storeID],
        currency: 'USD',
        price,
        basePrice,
        discount: discountPercent(basePrice, price),
        url: dealUrl(d.dealID),
      };
    })
    .filter((d) => d.price != null && d.price > 0)
    .sort((a, b) => a.price - b.price);
  const ever = json?.cheapestPriceEver;
  return {
    title: json?.info?.title ? String(json.info.title).trim() : null,
    steamAppId: json?.info?.steamAppID ? String(json.info.steamAppID) : null,
    imageUrl: safeImageUrl(json?.info?.thumb),
    // Історичний мінімум серед усіх магазинів, які бачить CheapShark (і Steam у США теж)
    lowestEver: ever?.price ? { price: toMinor(ever.price), currency: 'USD', at: ever.date ? new Date(ever.date * 1000).toISOString() : null } : null,
    deals,
  };
}

/** Найдешевша пропозиція у форматі, який розуміє оновлення цін (як у Steam і GOG). */
export function bestKeyPrice(parsed) {
  const best = parsed.deals[0];
  if (!best) return { available: false };
  return { available: true, ...best, isFree: false };
}

/** Steam appid → id гри в CheapShark (null, якщо там такої гри немає). */
export async function findKeyGameId(steamAppId) {
  const list = await fetchJson(NAME, `${API}/games?steamAppID=${encodeURIComponent(steamAppId)}`);
  const hit = (Array.isArray(list) ? list : []).find((g) => String(g?.steamAppID) === String(steamAppId));
  return hit?.gameID ? String(hit.gameID) : null;
}

/** Усі пропозиції ключів для гри зі Steam — для сторінки гри. Кеш на годину, щоб не смикати API. */
const cache = new Map();
const CACHE_MS = 60 * 60 * 1000;
export async function fetchKeyDeals(steamAppId) {
  const hit = cache.get(steamAppId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const gameId = await findKeyGameId(steamAppId);
  const data = gameId ? { gameId, ...parseKeyGame(await fetchJson(NAME, `${API}/games?id=${gameId}`)) } : null;
  cache.set(steamAppId, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

/** Ціни для відстежуваних ігор: один запит на 25 ігор. storeId — id гри в CheapShark. */
export async function fetchKeyPrices(offers) {
  const result = new Map();
  const ids = [...new Set(offers.map((o) => String(o.storeId)))];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const json = await fetchJson(NAME, `${API}/games?ids=${chunk.join(',')}`);
    for (const id of chunk) {
      result.set(id, json?.[id] ? bestKeyPrice(parseKeyGame(json[id])) : { missing: true });
    }
  }
  return result;
}
