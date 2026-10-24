// Повна інформація про гру для її сторінки: опис, скриншоти, трейлери, жанри, рейтинг.
// Steam: store.steampowered.com/api/appdetails і /appreviews. GOG: api.gog.com/products.
import { config } from '../config.js';
import { fetchJson, safeImageUrl } from './util.js';
import { steamUrl } from './steam.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', trade: '™', reg: '®', copy: '©' };

const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/**
 * HTML-опис з магазину → масив абзаців простого тексту.
 * HTML магазину ніколи не вставляємо на сторінку як є (у ньому може бути що завгодно) —
 * лише текст, який потім екранується.
 */
export function htmlToParagraphs(html, { max = 40 } = {}) {
  const text = decode(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol|h[1-6][^>]*|p[^>]*)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l && l !== '•')
    .slice(0, max);
}

const https = (url) => safeImageUrl(String(url || '').replace(/^\/\//, 'https://'));

export function parseSteamDetails(json, appId) {
  const entry = json?.[appId];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;
  const po = d.price_overview;
  return {
    store: 'steam',
    storeId: String(appId),
    title: String(d.name || ''),
    url: steamUrl(appId),
    shortDescription: decode(String(d.short_description || '')).trim(),
    // Опис «про гру» буває самими картинками — тоді беремо повний опис
    description: [d.about_the_game, d.detailed_description].map((h) => htmlToParagraphs(h)).find((p) => p.length) || [],
    headerImage: https(d.header_image),
    background: https(d.background_raw || d.background),
    screenshots: (d.screenshots || []).slice(0, 20).map((s) => ({ thumb: https(s.path_thumbnail), full: https(s.path_full) })),
    // Трейлери Steam — лише потокове відео HLS; на сторінці його програє hls.js
    videos: (d.movies || [])
      .filter((m) => m.hls_h264)
      .slice(0, 6)
      .map((m) => ({ kind: 'hls', src: m.hls_h264, poster: https(m.thumbnail), title: m.name ? String(m.name) : null })),
    genres: (d.genres || []).map((g) => g.description).filter(Boolean),
    developers: d.developers || [],
    publishers: d.publishers || [],
    releaseDate: d.release_date?.date || null,
    comingSoon: Boolean(d.release_date?.coming_soon),
    metacritic: d.metacritic?.score ?? null,
    platforms: Object.entries(d.platforms || {}).filter(([, on]) => on).map(([p]) => p),
    isFree: Boolean(d.is_free),
    price: po ? { currency: po.currency, price: po.final, basePrice: po.initial, discount: po.discount_percent || 0 } : null,
  };
}

export function parseSteamReviews(json) {
  const s = json?.query_summary;
  if (!s?.total_reviews) return null;
  return { percent: Math.round((s.total_positive / s.total_reviews) * 100), total: s.total_reviews, summary: s.review_score_desc || null };
}

/** Англійська назва гри: Steam віддає локалізовану («Відьмак 3»), а GOG шукає англійською. */
export async function fetchSteamEnglishTitle(appId) {
  const json = await fetchJson('Steam', `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english&filters=basic`);
  return json?.[appId]?.data?.name || null;
}

export async function fetchSteamDetails(appId, lang = 'uk') {
  const cc = config.stores.steamCountry;
  const language = lang === 'en' ? 'english' : config.stores.steamLanguage;
  const [details, reviews] = await Promise.all([
    fetchJson('Steam', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&l=${language}`),
    fetchJson('Steam', `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`).catch(() => null),
  ]);
  const parsed = parseSteamDetails(details, appId);
  if (parsed) parsed.reviews = parseSteamReviews(reviews);
  return parsed;
}

/** Відео GOG: YouTube показуємо через youtube-nocookie (без стеження за глядачем). */
function gogVideo(v) {
  const id = /youtube\.com\/embed\/([\w-]{6,20})/.exec(v?.video_url || '')?.[1];
  return id ? { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}`, poster: https(v.thumbnail_url), title: null } : null;
}

export function parseGogProduct(json, lang = 'uk') {
  if (!json?.id || !json.title) return null;
  const screenshot = (s, formatter) => https(String(s.formatter_template_url || '').replace('{formatter}', formatter).replace(/\.png$/, '.jpg'));
  return {
    store: 'gog',
    storeId: String(json.id),
    title: String(json.title),
    url: https(json.links?.product_card) || 'https://www.gog.com/',
    shortDescription: '',
    description: htmlToParagraphs(json.description?.full || json.description?.lead),
    headerImage: null,
    background: https(json.images?.background),
    screenshots: (json.screenshots || []).slice(0, 20).map((s) => ({ thumb: screenshot(s, 'ggvgm'), full: screenshot(s, 'ggvgm_2x') })),
    videos: (json.videos || []).map(gogVideo).filter(Boolean).slice(0, 6),
    genres: [],
    developers: [],
    publishers: [],
    releaseDate: json.release_date
      ? new Date(json.release_date).toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })
      : null,
    comingSoon: Boolean(json.in_development?.active || json.is_pre_order),
    metacritic: null,
    platforms: Object.entries(json.content_system_compatibility || {}).filter(([, on]) => on).map(([p]) => (p === 'osx' ? 'mac' : p)),
    isFree: false,
    price: null,
  };
}

export async function fetchGogDetails(productId, lang = 'uk') {
  return parseGogProduct(
    await fetchJson('GOG', `https://api.gog.com/products/${productId}?expand=description,screenshots,videos&locale=en-US`),
    lang
  );
}
