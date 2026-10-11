// Steam: пошук ігор і поточні ціни в гривнях.
// Використовуються публічні адреси магазину Steam (store.steampowered.com/api/...).
import { config } from '../config.js';
import { discountPercent, fetchJson, safeImageUrl, sleep } from './util.js';

const BASE = 'https://store.steampowered.com/api';

export const steamUrl = (appId) => `https://store.steampowered.com/app/${appId}/`;

/** Перетворює відповідь storesearch на список пропозицій. */
export function parseSteamSearch(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .filter((it) => it && it.id && it.name && (!it.type || it.type === 'app'))
    .map((it) => {
      const p = it.price;
      const price = p ? Number(p.final) : null;
      const basePrice = p ? Number(p.initial) : null;
      return {
        store: 'steam',
        storeId: String(it.id),
        title: String(it.name),
        url: steamUrl(it.id),
        imageUrl: safeImageUrl(it.tiny_image),
        currency: p?.currency || null,
        price,
        basePrice,
        discount: discountPercent(basePrice, price),
        isFree: false,
      };
    });
}

/**
 * Перетворює відповідь appdetails (filters=price_overview) на Map: appId → ціна.
 * Якщо в гри немає price_overview, вона безкоштовна або ще не продається.
 */
export function parseSteamPrices(json) {
  const result = new Map();
  for (const [appId, entry] of Object.entries(json || {})) {
    if (!entry || entry.success === false) {
      result.set(appId, { available: false });
      continue;
    }
    const po = entry.data && !Array.isArray(entry.data) ? entry.data.price_overview : null;
    if (!po) {
      result.set(appId, { available: true, price: null, basePrice: null, discount: 0, isFree: false, currency: null });
      continue;
    }
    const price = Number(po.final);
    const basePrice = Number(po.initial);
    const discount = Number.isFinite(Number(po.discount_percent))
      ? Number(po.discount_percent)
      : discountPercent(basePrice, price);
    result.set(appId, {
      available: true,
      currency: po.currency,
      price,
      basePrice,
      discount,
      isFree: price === 0 && basePrice > 0,
    });
  }
  return result;
}

export async function searchSteam(term) {
  const { steamCountry, steamLanguage } = config.stores;
  const url = `${BASE}/storesearch/?term=${encodeURIComponent(term)}&l=${steamLanguage}&cc=${steamCountry}`;
  return parseSteamSearch(await fetchJson('Steam', url));
}

/** Ціни для списку appId. Steam приймає кілька id в одному запиті, тож ідемо пачками. */
export async function fetchSteamPrices(appIds) {
  const all = new Map();
  const ids = [...new Set(appIds.map(String))];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `${BASE}/appdetails?appids=${chunk.join(',')}&cc=${config.stores.steamCountry}&filters=price_overview`;
    const parsed = parseSteamPrices(await fetchJson('Steam', url));
    for (const [k, v] of parsed) all.set(k, v);
    if (i + 50 < ids.length) await sleep(1500);
  }
  return all;
}
