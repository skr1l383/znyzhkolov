import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import { requireAuth } from '../auth.js';
import { SEARCHABLE, STORE_NAMES, store } from '../stores/index.js';
import { rankMatches } from '../stores/match.js';
import { steamUrl } from '../stores/steam.js';
import { safeImageUrl } from '../stores/util.js';
import { evaluateWatches, refreshGame, upsertGameWithOffers } from '../services/prices.js';
import { getWatch, listWatch, offersForGame } from '../services/watch.js';
import * as v from '../validate.js';

const MAX_WATCH_ITEMS = 200;

function cleanOffer(o) {
  if (!o || typeof o !== 'object') throw new HttpError(400, 'Не вказано гру');
  if (!SEARCHABLE.includes(o.store)) throw new HttpError(400, 'Цей магазин не підтримується');
  const storeId = String(o.storeId ?? '');
  if (!/^\d{1,12}$/.test(storeId)) throw new HttpError(400, 'Некоректний ідентифікатор гри');

  const int = (x) => (Number.isInteger(x) && x >= 0 && x < 1e9 ? x : null);
  let url;
  if (o.store === 'steam') url = steamUrl(storeId);
  else url = typeof o.url === 'string' && /^https:\/\/www\.gog\.com\//.test(o.url) ? o.url : 'https://www.gog.com/';

  return {
    store: o.store,
    storeId,
    title: v.text(o.title, { field: 'title', label: 'Назва гри', max: 200 }),
    url,
    imageUrl: safeImageUrl(o.imageUrl),
    currency: ['UAH', 'USD'].includes(o.currency) ? o.currency : null,
    price: int(o.price),
    basePrice: int(o.basePrice),
    discount: Number.isInteger(o.discount) && o.discount >= 0 && o.discount <= 100 ? o.discount : 0,
    isFree: false,
  };
}

function cleanConditions(body, partial = false) {
  const out = {};
  if (!partial || 'minDiscount' in body) {
    out.min_discount = v.optionalInt(body.minDiscount, { field: 'minDiscount', label: 'Знижка від', min: 1, max: 100 });
  }
  if (!partial || 'maxPriceUah' in body) {
    out.max_price_uah = v.optionalMoney(body.maxPriceUah, { field: 'maxPriceUah', label: 'Ціна до' });
  }
  if (!partial || 'notifyFree' in body) out.notify_free = body.notifyFree === false ? 0 : 1;
  if ('active' in body) out.active = body.active ? 1 : 0;
  return out;
}

function ensureSomeCondition(c) {
  if (c.min_discount == null && c.max_price_uah == null && !c.notify_free) {
    throw v.fieldError('minDiscount', 'Вкажіть хоча б одну умову: знижку, ціну або безкоштовну роздачу');
  }
}

const refreshLimiter = new Map();

function refreshInBackground(gameId, watchId) {
  refreshGame(gameId)
    .then(() => evaluateWatches({ watchId }))
    .catch((err) => log.warn('prices.refresh', `Не вдалося оновити ціни гри #${gameId}: ${err.message}`));
}

export function gameRoutes(router) {
  router.get('/api/search', requireAuth, async (ctx) => {
    const q = v.text(ctx.query.q, { field: 'q', label: 'Пошук', min: 2, max: 80 });
    const storeName = ctx.query.store || 'steam';
    if (!SEARCHABLE.includes(storeName)) throw new HttpError(400, 'Цей магазин не підтримується');

    let results;
    try {
      results = (await store(storeName).search(q)).slice(0, 20);
    } catch (err) {
      log.warn('search.error', `Пошук у ${STORE_NAMES[storeName]} не вдався: ${err.message}`, { userId: ctx.user.id });
      throw new HttpError(502, `${STORE_NAMES[storeName]} зараз не відповідає. Спробуйте пізніше або пошукайте в іншому магазині`);
    }

    const watching = new Set(
      db
        .prepare(
          `SELECT o.store_id FROM offers o JOIN watch_items w ON w.game_id = o.game_id
           WHERE w.user_id = ? AND o.store = ?`
        )
        .all(ctx.user.id, storeName)
        .map((r) => r.store_id)
    );
    return { results: results.map((r) => ({ ...r, watching: watching.has(r.storeId) })) };
  });

  // Пошук тієї самої гри в інших магазинах, щоб користувач підтвердив збіг
  router.get('/api/match', requireAuth, async (ctx) => {
    const title = v.text(ctx.query.title, { field: 'title', label: 'Назва', max: 200 });
    const from = ctx.query.store;
    const matches = [];
    const errors = [];
    for (const name of SEARCHABLE.filter((s) => s !== from)) {
      try {
        matches.push(...rankMatches(title, await store(name).search(title)).slice(0, 3));
      } catch (err) {
        errors.push(`${STORE_NAMES[name]} не відповідає`);
        log.warn('match.error', `Пошук збігів у ${STORE_NAMES[name]} не вдався: ${err.message}`);
      }
    }
    return { matches, errors };
  });

  router.get('/api/watch', requireAuth, (ctx) => ({ items: listWatch(ctx.user.id) }));

  router.post('/api/watch', requireAuth, (ctx) => {
    const offer = cleanOffer(ctx.body.offer);
    const extra = Array.isArray(ctx.body.extra) ? ctx.body.extra.slice(0, 3).map(cleanOffer) : [];
    const conditions = cleanConditions(ctx.body);
    ensureSomeCondition(conditions);

    const count = db.prepare('SELECT COUNT(*) AS n FROM watch_items WHERE user_id = ?').get(ctx.user.id).n;
    if (count >= MAX_WATCH_ITEMS) throw new HttpError(400, `У списку може бути не більше ${MAX_WATCH_ITEMS} ігор`);

    const gameId = upsertGameWithOffers([offer, ...extra.filter((e) => e.store !== offer.store)]);
    if (db.prepare('SELECT 1 FROM watch_items WHERE user_id = ? AND game_id = ?').get(ctx.user.id, gameId)) {
      throw new HttpError(409, 'Ця гра вже є у твоєму списку');
    }

    const info = db
      .prepare(
        `INSERT INTO watch_items (user_id, game_id, min_discount, max_price_uah, notify_free, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(ctx.user.id, gameId, conditions.min_discount, conditions.max_price_uah, conditions.notify_free, now());
    const watchId = Number(info.lastInsertRowid);

    log.info('watch.add', `${ctx.user.email} додав «${offer.title}» до списку`, {
      userId: ctx.user.id,
      meta: { gameId, stores: [offer.store, ...extra.map((e) => e.store)] },
    });
    refreshInBackground(gameId, watchId);
    return { item: getWatch(ctx.user.id, watchId) };
  });

  router.patch('/api/watch/:id', requireAuth, (ctx) => {
    const watchId = v.id(ctx.params.id);
    const current = db.prepare('SELECT * FROM watch_items WHERE id = ? AND user_id = ?').get(watchId, ctx.user.id);
    if (!current) throw new HttpError(404, 'Гру не знайдено у твоєму списку');

    const changes = cleanConditions(ctx.body, true);
    ensureSomeCondition({ ...current, ...changes });
    const fields = Object.keys(changes);
    if (fields.length) {
      db.prepare(`UPDATE watch_items SET ${fields.map((f) => `${f} = ?`).join(', ')}, last_alert_key = NULL WHERE id = ?`).run(
        ...fields.map((f) => changes[f]),
        watchId
      );
    }
    log.info('watch.update', `${ctx.user.email} змінив умови для гри #${current.game_id}`, { userId: ctx.user.id, meta: changes });
    evaluateWatches({ watchId }).catch(() => {});
    return { item: getWatch(ctx.user.id, watchId) };
  });

  router.delete('/api/watch/:id', requireAuth, (ctx) => {
    const watchId = v.id(ctx.params.id);
    const row = db
      .prepare('SELECT w.id, g.title FROM watch_items w JOIN games g ON g.id = w.game_id WHERE w.id = ? AND w.user_id = ?')
      .get(watchId, ctx.user.id);
    if (!row) throw new HttpError(404, 'Гру не знайдено у твоєму списку');
    db.prepare('DELETE FROM watch_items WHERE id = ?').run(watchId);
    log.info('watch.remove', `${ctx.user.email} прибрав «${row.title}» зі списку`, { userId: ctx.user.id });
    return { ok: true };
  });

  router.post('/api/watch/:id/refresh', requireAuth, async (ctx) => {
    const watchId = v.id(ctx.params.id);
    const row = db.prepare('SELECT * FROM watch_items WHERE id = ? AND user_id = ?').get(watchId, ctx.user.id);
    if (!row) throw new HttpError(404, 'Гру не знайдено у твоєму списку');

    const last = refreshLimiter.get(row.game_id) || 0;
    if (Date.now() - last < 30000) throw new HttpError(429, 'Ціни цієї гри щойно оновлювались. Спробуйте за пів хвилини');
    refreshLimiter.set(row.game_id, Date.now());

    const result = await refreshGame(row.game_id);
    await evaluateWatches({ watchId });
    return { item: getWatch(ctx.user.id, watchId), errors: result.errors };
  });

  // Додати ще один магазин до гри, яка вже у списку
  router.post('/api/watch/:id/offers', requireAuth, (ctx) => {
    const watchId = v.id(ctx.params.id);
    const row = db.prepare('SELECT * FROM watch_items WHERE id = ? AND user_id = ?').get(watchId, ctx.user.id);
    if (!row) throw new HttpError(404, 'Гру не знайдено у твоєму списку');
    const offer = cleanOffer(ctx.body.offer);

    const existing = offersForGame(row.game_id);
    if (existing.some((o) => o.store === offer.store)) throw new HttpError(409, `${STORE_NAMES[offer.store]} уже підключено до цієї гри`);
    const taken = db.prepare('SELECT game_id FROM offers WHERE store = ? AND store_id = ?').get(offer.store, offer.storeId);
    if (taken && taken.game_id !== row.game_id) throw new HttpError(409, 'Ця пропозиція вже прив’язана до іншої гри');

    const anchor = existing[0];
    upsertGameWithOffers([{ store: anchor.store, storeId: anchor.store_id, title: anchor.title }, offer]);
    log.info('watch.link', `${ctx.user.email} додав ${STORE_NAMES[offer.store]} до гри #${row.game_id}`, { userId: ctx.user.id });
    refreshInBackground(row.game_id, watchId);
    return { item: getWatch(ctx.user.id, watchId) };
  });

  // Історія цін для графіка
  router.get('/api/watch/:id/history', requireAuth, (ctx) => {
    const watchId = v.id(ctx.params.id);
    const row = db.prepare('SELECT game_id FROM watch_items WHERE id = ? AND user_id = ?').get(watchId, ctx.user.id);
    if (!row) throw new HttpError(404, 'Гру не знайдено у твоєму списку');
    const points = db
      .prepare(
        `SELECT o.store, h.price_uah, h.discount, h.recorded_at FROM price_history h
         JOIN offers o ON o.id = h.offer_id WHERE o.game_id = ? ORDER BY h.recorded_at`
      )
      .all(row.game_id);
    const series = {};
    for (const p of points) {
      (series[p.store] ||= []).push({ t: p.recorded_at, priceUah: p.price_uah, discount: p.discount });
    }
    return { series };
  });
}
