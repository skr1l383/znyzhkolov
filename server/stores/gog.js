// GOG: пошук і ціни через каталог catalog.gog.com.
// Для України GOG показує ціни в доларах, тому далі вони перераховуються в гривні.
import { config } from '../config.js';
import { discountPercent, fetchJson, safeImageUrl, sleep, toMinor } from './util.js';

const CATALOG = 'https://catalog.gog.com/v1/catalog';

/**
 * Обкладинки GOG у каталозі — PNG по ~2 МБ. Той самий сервер віддає стиснуту версію
 * 796×364 (~20 КБ), якщо додати до імені суфікс розміру, — її й показуємо.
 */
export function gogImage(url) {
  const safe = safeImageUrl(url);
  const m = safe && /^(https:\/\/images\.gog-statics\.com\/[0-9a-f]{64})(?:_[a-z0-9_]+)?\.(?:png|jpg|jpeg|webp)$/i.exec(safe);
  return m ? `${m[1]}_product_tile_398_2x.jpg` : safe;
}
const GAME_TYPES = new Set(['game', 'pack']);

export function parseGogCatalog(json) {
  const products = Array.isArray(json?.products) ? json.products : [];
  return products
    .filter((p) => p && p.id && p.title && (!p.productType || GAME_TYPES.has(p.productType)))
    .map((p) => {
      const final = p.price?.finalMoney;
      const base = p.price?.baseMoney;
      const price = toMinor(final?.amount);
      const basePrice = toMinor(base?.amount ?? final?.amount);
      return {
        store: 'gog',
        storeId: String(p.id),
        title: String(p.title),
        url: p.storeLink || (p.slug ? `https://www.gog.com/en/game/${p.slug}` : 'https://www.gog.com/'),
        imageUrl: gogImage(p.coverHorizontal),
        currency: final?.currency || base?.currency || null,
        price,
        basePrice,
        discount: discountPercent(basePrice, price),
        isFree: price === 0 && basePrice > 0,
      };
    });
}

function catalogUrl(term, limit = 20) {
  const { gogCountry } = config.stores;
  const params = new URLSearchParams({
    limit: String(limit),
    query: `like:${term}`,
    order: 'desc:score',
    productType: 'in:game,pack',
    countryCode: gogCountry,
    currencyCode: 'USD',
    locale: 'en-US',
  });
  return `${CATALOG}?${params}`;
}

export async function searchGog(term) {
  return parseGogCatalog(await fetchJson('GOG', catalogUrl(term)));
}

/**
 * Оновлює ціни для вже відомих ігор GOG. Окремого запиту «ціна за id» у каталозі немає,
 * тому шукаємо гру за назвою і беремо результат з тим самим id.
 */
export async function fetchGogPrices(offers) {
  const result = new Map();
  for (const [i, offer] of offers.entries()) {
    const found = (await searchGog(offer.title)).find((p) => p.storeId === String(offer.storeId));
    // Якщо гру не знайдено, ціну не чіпаємо: це може бути тимчасовий збій пошуку
    result.set(String(offer.storeId), found ? { available: true, ...found } : { missing: true });
    if (i < offers.length - 1) await sleep(700);
  }
  return result;
}
