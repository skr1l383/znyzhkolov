// Курси Національного банку України: долар — щоб порівнювати ціни GOG (у $) з цінами в гривнях,
// решта валют — для карти цін гри в Steam у різних країнах.
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { fetchJson } from './util.js';

const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json'; // усі валюти одразу

export function parseNbuRate(json) {
  const row = Array.isArray(json) ? json.find((r) => r?.cc === 'USD') : null;
  const rate = Number(row?.rate);
  return Number.isFinite(rate) && rate > 0 ? { rate, date: row.exchangedate || null } : null;
}

/** Курси всіх валют: { USD: 41.5, EUR: 45.1, … } — гривень за одиницю валюти. */
export function parseNbuRates(json) {
  if (!Array.isArray(json)) return {};
  return Object.fromEntries(
    json.filter((r) => /^[A-Z]{3}$/.test(r?.cc) && Number(r.rate) > 0).map((r) => [r.cc, Number(r.rate)])
  );
}

export async function fetchUsdRate() {
  const json = await fetchJson('НБУ', NBU_URL);
  const parsed = parseNbuRate(json);
  if (!parsed) throw new Error('НБУ: курс долара не знайдено у відповіді');
  return { ...parsed, rates: parseNbuRates(json) };
}

export function saveUsdRate({ rate, date, rates }) {
  setSetting('rate:USD', rate);
  setSetting('rate:USD:date', date || '');
  if (rates && Object.keys(rates).length) setSetting('rates:all', JSON.stringify(rates));
}

/** Поточний курс: збережений з НБУ або запасне значення з налаштувань. */
export function getUsdRate() {
  const saved = Number(getSetting('rate:USD'));
  return Number.isFinite(saved) && saved > 0
    ? { rate: saved, date: getSetting('rate:USD:date') || null, source: 'nbu' }
    : { rate: config.stores.usdUahFallback, date: null, source: 'fallback' };
}

/** Курси всіх валют з останньої перевірки НБУ; долар є завжди (хоча б запасне значення). */
export function getRates() {
  let rates = {};
  try {
    rates = JSON.parse(getSetting('rates:all') || '{}');
  } catch {
    // зіпсований запис — обійдемося доларом
  }
  return { ...rates, USD: getUsdRate().rate };
}

/** Сума в будь-якій валюті → копійки гривні за курсом НБУ; null, якщо курсу цієї валюти немає. */
export function toUahAny(amountMinor, currency, rates = getRates()) {
  if (amountMinor == null) return null;
  if (currency === 'UAH') return amountMinor;
  const rate = rates[currency];
  return rate ? Math.round(amountMinor * rate) : null;
}

/** Переводить суму в копійки гривні. Підтримуються UAH і USD. */
export function toUah(amountMinor, currency, rate = getUsdRate().rate) {
  if (amountMinor == null) return null;
  if (!currency || currency === 'UAH') return amountMinor;
  if (currency === 'USD') return Math.round(amountMinor * rate);
  return null;
}
