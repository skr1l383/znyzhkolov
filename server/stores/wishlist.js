// Список бажаного Steam: профіль за посиланням → список ігор → назви, ціни й обкладинки.
// Усі запити — до публічних адрес Steam, ключ API не потрібен. Список має бути відкритим у налаштуваннях приватності.
import { config } from '../config.js';
import { HttpError } from '../http.js';
import { fetchJson, StoreError, safeImageUrl } from './util.js';
import { steamUrl } from './steam.js';

const API = () => config.steam.apiBase;
const COMMUNITY = () => config.steam.communityBase;
const ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/';

/**
 * Що вставив користувач → { steamId } або { vanity }.
 * Підходить: посилання на профіль (/profiles/7656… чи /id/ім'я), посилання на список бажаного,
 * 17-значний номер профілю або просто коротке ім'я профілю.
 */
export function parseProfileInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const byId = /(?:profiles\/)?(7656119\d{10})(?:\D|$)/.exec(text);
  if (byId) return { steamId: byId[1] };
  const vanity = /steamcommunity\.com\/id\/([\w-]{2,32})|store\.steampowered\.com\/wishlist\/id\/([\w-]{2,32})/i.exec(text);
  if (vanity) return { vanity: vanity[1] || vanity[2] };
  if (/^[\w-]{2,32}$/.test(text)) return { vanity: text };
  return null;
}

const cdata = (xml, tag) => {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
};

/** Профіль Steam (публічна XML-сторінка): номер, ім'я, аватар. */
export async function fetchProfile(parsed) {
  const url = parsed.steamId ? `${COMMUNITY()}/profiles/${parsed.steamId}?xml=1` : `${COMMUNITY()}/id/${encodeURIComponent(parsed.vanity)}?xml=1`;
  let xml;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'Accept-Language': 'uk,en;q=0.8' } });
    xml = await res.text();
  } catch {
    throw new StoreError('Steam', 'не вдалося відкрити профіль');
  }
  const steamId = cdata(xml, 'steamID64');
  if (!steamId) throw new HttpError(404, 'Такого профілю Steam не знайдено. Перевір посилання');
  return {
    steamId,
    name: cdata(xml, 'steamID') || 'Гравець Steam',
    avatar: safeImageUrl(cdata(xml, 'avatarMedium')),
    privacy: cdata(xml, 'privacyState'),
  };
}

/** Номери ігор зі списку бажаного в порядку, як у Steam: спершу впорядковані, далі — нові зверху. */
export function parseWishlist(json) {
  const items = Array.isArray(json?.response?.items) ? json.response.items : [];
  return items
    .filter((i) => Number.isInteger(i.appid))
    .sort((a, b) => (a.priority || Infinity) - (b.priority || Infinity) || (b.date_added || 0) - (a.date_added || 0))
    .map((i) => String(i.appid));
}

export async function fetchWishlist(steamId) {
  return parseWishlist(await fetchJson('Steam', `${API()}/IWishlistService/GetWishlist/v1/?steamid=${steamId}`));
}

/** Відповідь IStoreBrowseService/GetItems → пропозиції у форматі сайту. */
export function parseStoreItems(json) {
  const items = Array.isArray(json?.response?.store_items) ? json.response.store_items : [];
  return items
    .filter((it) => it.success === 1 && it.appid && it.name)
    .map((it) => {
      const p = it.best_purchase_option;
      const price = p?.final_price_in_cents != null ? Number(p.final_price_in_cents) : null;
      const basePrice = p?.original_price_in_cents != null ? Number(p.original_price_in_cents) : price;
      const asset = (file) => (it.assets?.asset_url_format && file ? safeImageUrl(ASSETS + it.assets.asset_url_format.replace('${FILENAME}', file)) : null);
      const endsAt = p?.active_discounts?.[0]?.discount_end_date;
      return {
        store: 'steam',
        storeId: String(it.appid),
        title: String(it.name),
        url: steamUrl(it.appid),
        imageUrl: asset(it.assets?.small_capsule) || asset(it.assets?.header),
        headerUrl: asset(it.assets?.header),
        currency: price != null ? 'UAH' : null,
        price,
        basePrice,
        discount: Number(p?.discount_pct) || 0,
        discountEndsAt: endsAt ? new Date(endsAt * 1000).toISOString() : null,
        comingSoon: Boolean(it.release?.is_coming_soon), // ще не вийшла — ціни поки немає
        isFree: Boolean(it.is_free),
      };
    });
}

/** Назви й ціни пачками по 50 ігор (один запит на пачку). Англійські назви — щоб знайти гру в GOG. */
export async function fetchStoreItems(appids) {
  const result = [];
  for (let i = 0; i < appids.length; i += 50) {
    const input = {
      ids: appids.slice(i, i + 50).map((appid) => ({ appid: Number(appid) })),
      context: { language: 'english', country_code: config.stores.steamCountry },
      data_request: { include_assets: true, include_release: true },
    };
    const json = await fetchJson('Steam', `${API()}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    result.push(...parseStoreItems(json));
  }
  // У тому ж порядку, що й у списку бажаного
  const order = new Map(appids.map((id, i) => [String(id), i]));
  return result.sort((a, b) => order.get(a.storeId) - order.get(b.storeId));
}
