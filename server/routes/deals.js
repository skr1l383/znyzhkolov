import { HttpError } from '../http.js';
import { getGameDetails } from '../services/gameDetails.js';
import { listFreebies } from '../services/epicFree.js';
import { getRegionalPrices } from '../services/regional.js';
import { dealsStatus, featuredDeals, listDeals } from '../services/deals.js';
import { runJob } from '../services/scheduler.js';

const int = (value, min, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export function dealRoutes(router) {
  // Вітрина відкрита й для гостей: це головна сторінка сайту.
  // Фільтри: store, minDiscount (%), maxPrice (грн), q (назва), sort, limit, offset.
  router.get('/api/deals', (ctx) => {
    const q = ctx.query;
    const maxPrice = q.maxPrice ? int(String(q.maxPrice).replace(',', '.'), 0, 100000) : null;
    const result = listDeals({
      store: ['steam', 'gog'].includes(q.store) ? q.store : null,
      minDiscount: int(q.minDiscount, 1, 100),
      maxPriceUah: maxPrice == null ? null : maxPrice * 100,
      q: String(q.q || '').slice(0, 80),
      sort: q.sort,
      limit: int(q.limit, 1, 60) ?? 24,
      offset: int(q.offset, 0, 10000) ?? 0,
      userId: ctx.user?.id ?? null,
    });
    const status = dealsStatus();
    // Перший запуск: вітрина ще порожня — оновлюємо одразу, не чекаючи розкладу
    const updating = !Object.keys(status.counts).length;
    if (updating) runJob('deals', 'auto').catch(() => {});
    return {
      ...result,
      ...status,
      updating,
      freebies: listFreebies().filter((f) => f.status === 'current'),
    };
  });
}

export function featuredRoutes(router) {
  // Банер на головній
  router.get('/api/deals/featured', (ctx) => ({ items: featuredDeals({ userId: ctx.user?.id ?? null }) }));
}

export function gamePageRoutes(router) {
  // Сторінка гри відкрита й для гостей, як і вітрина
  router.get('/api/games/:store/:id', async (ctx) => {
    const { store, id } = ctx.params;
    if (!['steam', 'gog'].includes(store) || !/^\d{1,12}$/.test(id)) throw new HttpError(404, 'Гру не знайдено');
    return getGameDetails(store, id, ctx.user?.id ?? null, ctx.query.lang === 'en' ? 'en' : 'uk');
  });

  // Карта цін: скільки гра коштує в Steam у різних країнах
  router.get('/api/games/steam/:id/regional', (ctx) => {
    if (!/^\d{1,12}$/.test(ctx.params.id)) throw new HttpError(404, 'Гру не знайдено');
    return getRegionalPrices(ctx.params.id);
  });
}
