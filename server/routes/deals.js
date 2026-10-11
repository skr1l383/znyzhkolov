import { listFreebies } from '../services/epicFree.js';
import { dealsStatus, listDeals } from '../services/deals.js';
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
