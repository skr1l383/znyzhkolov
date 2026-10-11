// Допоміжні функції для роботи з магазинами: запити до API та гроші.

export class StoreError extends Error {
  constructor(store, message, status) {
    super(`${store}: ${message}`);
    this.store = store;
    this.status = status;
  }
}

const USER_AGENT = 'Znyzhkolov/0.1 (student project; game price tracker)';

export async function fetchJson(store, url, { timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'сервер не відповів вчасно' : 'немає з’єднання (перевірте інтернет)';
    throw new StoreError(store, reason);
  }
  if (res.status === 429) throw new StoreError(store, 'забагато запитів, доступ тимчасово обмежено', 429);
  if (!res.ok) throw new StoreError(store, `сервер повернув помилку ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new StoreError(store, 'незрозуміла відповідь сервера');
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "3.29" → 329 (центи). Повертає null, якщо суми немає. */
export function toMinor(amount) {
  if (amount == null || amount === '') return null;
  const n = Number(String(amount).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function discountPercent(base, price) {
  if (!base || price == null || price >= base) return 0;
  return Math.round(((base - price) / base) * 100);
}

/** 51500 копійок → "515 ₴", 13654 → "136,54 ₴" */
export function formatUah(kopecks) {
  if (kopecks == null) return '—';
  const whole = Math.floor(kopecks / 100);
  const cents = Math.abs(kopecks % 100);
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return cents ? `${wholeStr},${String(cents).padStart(2, '0')} ₴` : `${wholeStr} ₴`;
}

const ALLOWED_IMAGE_HOSTS = [
  'steamstatic.com',
  'steampowered.com',
  'gog-statics.com',
  'gog.com',
  'epicgames.com',
  'unrealengine.com',
];

/** Пропускає лише https-картинки з CDN магазинів. */
export function safeImageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    return ALLOWED_IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) ? u.href : null;
  } catch {
    return null;
  }
}
