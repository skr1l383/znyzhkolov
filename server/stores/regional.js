// Ціни гри в Steam у різних країнах. Steam рахує ціну за країною акаунта —
// її можна дізнатися тим самим запитом appdetails з параметром cc (код країни).
import { fetchJson } from './util.js';

// Країни, де Steam бере євро: єврозона і країни ЄС без власної валюти в Steam
const EURO = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

/**
 * Регіони карти: id — код для підпису (EU — Євросоюз), cc — країна, за якою питаємо Steam,
 * countries — країни на карті з тією самою ціною. Лише валюти, курс яких публікує НБУ.
 */
export const REGIONS = [
  { id: 'UA', cc: 'UA' },
  { id: 'EU', cc: 'DE', countries: EURO },
  ...['US', 'GB', 'PL', 'NO', 'CH', 'TR', 'KZ', 'IL', 'SA', 'AE', 'ZA', 'IN', 'CN', 'JP', 'KR', 'ID', 'VN', 'TH', 'AU', 'NZ', 'CA', 'MX', 'AR'].map(
    (cc) => ({ id: cc, cc })
  ),
].map((r) => ({ ...r, countries: r.countries || [r.id] }));

/** Ціна з відповіді appdetails (filters=price_overview); null — гра безкоштовна або не продається в цій країні. */
export function parsePriceOverview(json, appId) {
  const entry = json?.[appId];
  if (!entry?.success) return null;
  const po = entry.data?.price_overview;
  if (!po?.currency || !Number.isFinite(Number(po.final))) return null;
  return {
    currency: String(po.currency),
    price: Number(po.final),
    basePrice: Number(po.initial) || Number(po.final),
    discount: Number(po.discount_percent) || 0,
  };
}

/**
 * Ціни в усіх регіонах. Запити йдуть по кілька одночасно, щоб не впертися в обмеження Steam.
 * Результат: id регіону → ціна | null (не продається); регіонів з помилкою в результаті немає.
 */
export async function fetchRegionalPrices(appId, { concurrency = 4 } = {}) {
  const result = {};
  const queue = [...REGIONS];
  const worker = async () => {
    while (queue.length) {
      const region = queue.shift();
      try {
        const json = await fetchJson('Steam', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${region.cc}&filters=price_overview`);
        result[region.id] = parsePriceOverview(json, appId);
      } catch {
        // цей регіон пропускаємо — карта покаже решту
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}
