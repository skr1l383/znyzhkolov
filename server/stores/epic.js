// Epic Games Store: щотижневі безкоштовні роздачі (поточні та майбутні).
// Ціни в гривнях Epic віддає одразу для країни UA.
import { config } from '../config.js';
import { fetchJson, safeImageUrl } from './util.js';

const FREE_URL = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';

function pickSlug(el) {
  const fromMappings = [...(el.catalogNs?.mappings || []), ...(el.offerMappings || [])].find(
    (m) => m?.pageSlug && (!m.pageType || m.pageType === 'productHome')
  );
  if (fromMappings) return fromMappings.pageSlug;
  if (el.productSlug) return String(el.productSlug).replace(/\/home$/, '');
  return el.urlSlug && !/^[0-9a-f]{32}$/.test(el.urlSlug) ? el.urlSlug : null;
}

function pickImage(el) {
  const images = el.keyImages || [];
  const order = ['OfferImageWide', 'DieselStoreFrontWide', 'featuredMedia', 'Thumbnail', 'OfferImageTall'];
  for (const type of order) {
    const img = images.find((i) => i.type === type && i.url);
    if (img) return safeImageUrl(img.url);
  }
  return safeImageUrl(images[0]?.url);
}

// У Epic для роздач discountPercentage = 0 означає «ціна 0», тобто 100% знижки
const freeOffer = (groups) =>
  (groups || [])
    .flatMap((g) => g?.promotionalOffers || [])
    .find((o) => o?.discountSetting?.discountPercentage === 0);

export function parseEpicFreebies(json, nowDate = new Date()) {
  const elements = json?.data?.Catalog?.searchStore?.elements || [];
  const out = [];
  for (const el of elements) {
    if (!el?.id || !el.title) continue;
    const current = freeOffer(el.promotions?.promotionalOffers);
    const upcoming = freeOffer(el.promotions?.upcomingPromotionalOffers);
    const promo = current || upcoming;
    if (!promo) continue;

    const endsAt = promo.endDate || null;
    if (endsAt && new Date(endsAt) < nowDate) continue;

    const slug = pickSlug(el);
    out.push({
      id: String(el.id),
      title: String(el.title),
      url: slug ? `https://store.epicgames.com/uk/p/${slug}` : 'https://store.epicgames.com/uk/free-games',
      imageUrl: pickImage(el),
      originalPrice: el.price?.totalPrice?.originalPrice ?? null,
      currency: el.price?.totalPrice?.currencyCode || null,
      startsAt: promo.startDate || null,
      endsAt,
      status: current ? 'current' : 'upcoming',
    });
  }
  return out;
}

export async function fetchEpicFreebies() {
  const c = config.stores.epicCountry;
  const url = `${FREE_URL}?locale=uk&country=${c}&allowCountries=${c}`;
  return parseEpicFreebies(await fetchJson('Epic Games', url));
}
