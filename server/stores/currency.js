// Курс долара від Національного банку України, щоб порівнювати ціни GOG (у $) з цінами в гривнях.
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { fetchJson } from './util.js';

const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json';

export function parseNbuRate(json) {
  const row = Array.isArray(json) ? json.find((r) => r?.cc === 'USD') : null;
  const rate = Number(row?.rate);
  return Number.isFinite(rate) && rate > 0 ? { rate, date: row.exchangedate || null } : null;
}

export async function fetchUsdRate() {
  const parsed = parseNbuRate(await fetchJson('НБУ', NBU_URL));
  if (!parsed) throw new Error('НБУ: курс долара не знайдено у відповіді');
  return parsed;
}

export function saveUsdRate({ rate, date }) {
  setSetting('rate:USD', rate);
  setSetting('rate:USD:date', date || '');
}

/** Поточний курс: збережений з НБУ або запасне значення з налаштувань. */
export function getUsdRate() {
  const saved = Number(getSetting('rate:USD'));
  return Number.isFinite(saved) && saved > 0
    ? { rate: saved, date: getSetting('rate:USD:date') || null, source: 'nbu' }
    : { rate: config.stores.usdUahFallback, date: null, source: 'fallback' };
}

/** Переводить суму в копійки гривні. Підтримуються UAH і USD. */
export function toUah(amountMinor, currency, rate = getUsdRate().rate) {
  if (amountMinor == null) return null;
  if (!currency || currency === 'UAH') return amountMinor;
  if (currency === 'USD') return Math.round(amountMinor * rate);
  return null;
}
