// Вітрина: найпопулярніші ігри зі знижками зараз.
// Steam: сторінка пошуку зі знижками (store.steampowered.com/search/results) віддає готовий HTML —
//        розбираємо його самі (парсинг HTML).
// GOG:   каталог з фільтром «зі знижкою», відсортований за популярністю (JSON).
import { config } from '../config.js';
import { discountPercent, fetchJson, safeImageUrl, sleep, toMinor } from './util.js';
import { gogImage } from './gog.js';
import { steamUrl } from './steam.js';

const STEAM_SEARCH = 'https://store.steampowered.com/search/results/';
const GOG_CATALOG = 'https://catalog.gog.com/v1/catalog';

/** Велика обкладинка гри Steam (460×215) за її номером. */
export const steamHeader = (appId) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

const decodeHtml = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** "1 329,00₴" → 132900 (копійки) */
function parseUah(text) {
  const digits = String(text || '').replace(/[^\d,.]/g, '').replace(',', '.');
  const n = Number(digits);
  return digits && Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * HTML зі сторінки пошуку Steam → список ігор зі знижкою.
 * Кожна гра — це посилання <a class="search_result_row" data-ds-appid="..."> з назвою, цінами й рейтингом усередині.
 */
export function parseSteamSpecials(html) {
  const items = [];
  for (const m of String(html || '').matchAll(/<a\s([^>]*class="search_result_row[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)) {
    const [, attrs, body] = m;
    // Набори й пакети (кілька ігор разом) пропускаємо: у них немає одного appid
    const appId = /data-ds-appid="(\d+)"/.exec(attrs)?.[1];
    if (!appId) continue;
    const title = decodeHtml(/<span class="title">([\s\S]*?)<\/span>/.exec(body)?.[1] || '').trim();
    const price = Number(/data-price-final="(\d+)"/.exec(body)?.[1]);
    const discount = Number(/data-discount="(\d+)"/.exec(body)?.[1]) || 0;
    if (!title || !Number.isFinite(price) || discount <= 0) continue;
    const basePrice = parseUah(/class="discount_original_price">([^<]+)</.exec(body)?.[1]) ?? Math.round(price / (1 - discount / 100));
    // «93% з 893 рецензій на цю гру є позитивними»
    // Маленька обкладинка зі сторінки — запасна, якщо великої header.jpg для гри немає
    const capsule = safeImageUrl(decodeHtml(/<div class="search_capsule"><img src="([^"]+)"/.exec(body)?.[1] || ''));
    const tooltip = decodeHtml(/data-tooltip-html="([^"]*)"/.exec(body)?.[1] || '');
    const review = /(\d{1,3})%\D*?(\d[\d\s,.]*)/.exec(tooltip);
    items.push({
      store: 'steam',
      storeId: appId,
      title,
      url: steamUrl(appId),
      imageUrl: steamHeader(appId),
      imageFallback: capsule,
      currency: 'UAH',
      price,
      basePrice,
      discount,
      rating: review ? Number(review[1]) : null,
      reviews: review ? Number(review[2].replace(/\D/g, '')) || null : null,
    });
  }
  return items;
}

export async function fetchSteamSpecials(total = 100) {
  const all = [];
  const seen = new Set();
  for (let start = 0; start < total; start += 50) {
    const params = new URLSearchParams({
      specials: '1', // лише зі знижкою
      category1: '998', // лише ігри (без доповнень і саундтреків)
      infinite: '1',
      json: '1',
      cc: config.stores.steamCountry,
      l: config.stores.steamLanguage,
      start: String(start),
      count: '50',
    });
    const json = await fetchJson('Steam', `${STEAM_SEARCH}?${params}`);
    for (const item of parseSteamSpecials(json?.results_html)) {
      if (!seen.has(item.storeId)) {
        seen.add(item.storeId);
        all.push(item);
      }
    }
    if (start + 50 < total) await sleep(1000);
  }
  return all;
}

/** Відповідь каталогу GOG → список ігор зі знижкою. Рейтинг GOG (0–50) переводимо у відсотки. */
export function parseGogDeals(json) {
  const products = Array.isArray(json?.products) ? json.products : [];
  return products
    .map((p) => {
      const price = toMinor(p.price?.finalMoney?.amount);
      const basePrice = toMinor(p.price?.baseMoney?.amount);
      return {
        store: 'gog',
        storeId: String(p.id),
        title: String(p.title || '').trim(),
        url: p.storeLink || (p.slug ? `https://www.gog.com/en/game/${p.slug}` : 'https://www.gog.com/'),
        imageUrl: gogImage(p.coverHorizontal),
        currency: p.price?.finalMoney?.currency || 'USD',
        price,
        basePrice,
        discount: discountPercent(basePrice, price),
        rating: Number.isFinite(p.reviewsRating) && p.reviewsRating > 0 ? p.reviewsRating * 2 : null,
        reviews: Number.isFinite(p.reviewsCount) ? p.reviewsCount : null,
      };
    })
    .filter((d) => d.storeId && d.title && d.price != null && d.discount > 0);
}

/** Каталог GOG віддає до 50 ігор за раз, тому йдемо сторінками. */
export async function fetchGogDeals(total = 150) {
  const all = [];
  for (let page = 1; all.length < total; page++) {
    const params = new URLSearchParams({
      limit: '50',
      page: String(page),
      order: 'desc:trending', // найпопулярніші зараз
      discounted: 'eq:true',
      productType: 'in:game,pack',
      countryCode: config.stores.gogCountry,
      currencyCode: 'USD',
      locale: 'en-US',
    });
    const json = await fetchJson('GOG', `${GOG_CATALOG}?${params}`);
    all.push(...parseGogDeals(json));
    if (page >= (json?.pages || 1)) break;
    await sleep(500);
  }
  return all.slice(0, total);
}
