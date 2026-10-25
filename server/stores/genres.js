// Жанри вітрини. Steam описує ігри тегами (числові id), GOG — жанрами й тегами (англійські slug).
// Зводимо обидва до одного короткого списку, щоб фільтр «Жанр» однаково працював для обох магазинів.
import { config } from '../config.js';
import { fetchJson, sleep } from './util.js';

export const GENRES = [
  { key: 'action', steam: [19], gog: ['action'] },
  { key: 'adventure', steam: [21], gog: ['adventure'] },
  { key: 'rpg', steam: [122], gog: ['rpg', 'role-playing'] },
  { key: 'strategy', steam: [9], gog: ['strategy'] },
  { key: 'simulation', steam: [599], gog: ['simulation'] },
  { key: 'shooter', steam: [1774, 1663], gog: ['shooter', 'fpp', 'fps'] },
  { key: 'horror', steam: [1667], gog: ['horror'] },
  { key: 'platformer', steam: [1625], gog: ['platformer'] },
  { key: 'puzzle', steam: [1664], gog: ['puzzle'] },
  { key: 'survival', steam: [1662], gog: ['survival'] },
  { key: 'openworld', steam: [1695], gog: ['open-world'] },
  { key: 'racing', steam: [699], gog: ['racing'] },
  { key: 'sports', steam: [701], gog: ['sports'] },
  { key: 'indie', steam: [492], gog: ['indie'] },
];
export const GENRE_KEYS = GENRES.map((g) => g.key);

export function genresFromSteamTags(tagIds = []) {
  const ids = new Set(tagIds.map(Number));
  return GENRES.filter((g) => g.steam.some((id) => ids.has(id))).map((g) => g.key);
}

/** Продукт каталогу GOG → жанри (з полів genres і tags). */
export function genresFromGog(product) {
  const slugs = new Set([...(product?.genres || []), ...(product?.tags || [])].map((x) => String(x?.slug || '').toLowerCase()));
  return GENRES.filter((g) => g.gog.some((s) => slugs.has(s))).map((g) => g.key);
}

// «CAPCOM Co., Ltd.» і «Capcom» — одна студія: прибираємо юридичну форму в кінці назви
const LEGAL_SUFFIX = /[\s,]+(co\.?,?\s*ltd\.?|ltd\.?|llc\.?|inc\.?|gmbh|s\.?a\.?|corp(oration)?\.?|limited)$/i;

/** Розробники й видавці без повторів (часто це одна й та сама студія). */
export function uniqueCompanies(...lists) {
  const seen = new Map();
  for (const name of lists.flat()) {
    const clean = String(name || '').trim().replace(LEGAL_SUFFIX, '').trim();
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()];
}

/** Відповідь IStoreBrowseService/GetItems → appid → { genres, companies }. */
export function parseSteamExtras(json) {
  const result = new Map();
  for (const item of json?.response?.store_items || []) {
    if (!item?.appid) continue;
    const info = item.basic_info || {};
    result.set(String(item.appid), {
      genres: genresFromSteamTags(item.tagids || (item.tags || []).map((t) => t.tagid)),
      companies: uniqueCompanies((info.developers || []).map((d) => d.name), (info.publishers || []).map((p) => p.name)),
    });
  }
  return result;
}

/** Жанри й студії для ігор вітрини Steam: публічний API Steam, по 50 ігор за запит. */
export async function fetchSteamExtras(appIds) {
  const result = new Map();
  for (let i = 0; i < appIds.length; i += 50) {
    const input = {
      ids: appIds.slice(i, i + 50).map((id) => ({ appid: Number(id) })),
      context: { language: 'english', country_code: config.stores.steamCountry },
      data_request: { include_basic_info: true, include_tag_count: 20 },
    };
    const json = await fetchJson('Steam', `${config.steam.apiBase}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    for (const [id, extra] of parseSteamExtras(json)) result.set(id, extra);
    if (i + 50 < appIds.length) await sleep(300);
  }
  return result;
}
