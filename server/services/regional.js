// Карта цін на сторінці гри: скільки гра коштує в Steam у різних країнах — у гривнях
// і порівняно з Україною. Відповіді Steam зберігаються на добу, курси НБУ беруться свіжі.
import { config } from '../config.js';
import { getSetting, now, setSetting } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import { getRates, toUahAny } from '../stores/currency.js';
import { demoRegionalPrices } from '../stores/demo.js';
import { fetchRegionalPrices, REGIONS } from '../stores/regional.js';
import { runJob } from './scheduler.js';

const CACHE_HOURS = 24;
const loading = new Map(); // appId → запит, що вже виконується (щоб двоє відвідувачів не питали Steam двічі)

async function loadRaw(appId) {
  const key = `regional:${appId}`;
  try {
    const saved = JSON.parse(getSetting(key) || 'null');
    if (saved && Date.now() - new Date(saved.fetchedAt).getTime() < CACHE_HOURS * 3600 * 1000) return saved;
  } catch {
    // зіпсований запис — завантажимо заново
  }
  const prices = config.demoStores ? demoRegionalPrices(appId) : await fetchRegionalPrices(appId);
  const answered = Object.keys(prices).length;
  if (!answered) throw new HttpError(502, 'Steam зараз не відповідає. Спробуй відкрити карту трохи пізніше');
  const result = { prices, fetchedAt: now() };
  // Якщо відповіла лише частина регіонів, не запам'ятовуємо — наступного разу спробуємо всі
  if (answered >= REGIONS.length / 2) setSetting(key, JSON.stringify(result));
  else log.warn('regional.partial', `Карта цін ${appId}: Steam відповів лише для ${answered} з ${REGIONS.length} регіонів`);
  return result;
}

/** Регіони від найдешевшого до найдорожчого; diff — на скільки відсотків дорожче (+) чи дешевше (−), ніж в Україні. */
export async function getRegionalPrices(appId) {
  if (!loading.has(appId)) loading.set(appId, loadRaw(appId).finally(() => loading.delete(appId)));
  const { prices, fetchedAt } = await loading.get(appId);
  // Курси інших валют, крім долара, з'явилися пізніше — якщо їх ще не завантажено, беремо зараз
  if (!getSetting('rates:all')) await runJob('rate', 'auto').catch(() => {});
  const rates = getRates();
  const regions = REGIONS.map((r) => {
    const p = prices[r.id];
    const priceUah = p ? toUahAny(p.price, p.currency, rates) : null;
    return priceUah == null ? null : { id: r.id, countries: r.countries, ...p, priceUah };
  }).filter(Boolean);
  const home = regions.find((r) => r.id === 'UA');
  for (const r of regions) r.diff = home && home.priceUah > 0 ? Math.round(((r.priceUah - home.priceUah) / home.priceUah) * 100) : null;
  regions.sort((a, b) => a.priceUah - b.priceUah);
  return { updatedAt: fetchedAt, home: home ? 'UA' : null, regions };
}
