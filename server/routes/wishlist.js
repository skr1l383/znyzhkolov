// Імпорт списку бажаного Steam: показати ігри з цінами → вибрати → стежити за всіма одним натисканням.
// Ігри додаються одразу зі Steam, а та сама гра в GOG шукається у фоні (по одній, щоб не засипати GOG запитами).
import { db } from '../db.js';
import { HttpError, templateError } from '../http.js';
import { log } from '../logger.js';
import { requireAuth } from '../auth.js';
import { disableSync, enableSync, linkGogInBackground, syncStatus, syncUser, watchedSteamIds } from '../services/steamSync.js';
import { fetchProfile, fetchStoreItems, fetchWishlist, parseProfileInput } from '../stores/wishlist.js';
import { cleanOffer, createWatch } from './games.js';

const MAX_IMPORT = 200;

/** Умова «знижка від N%» для доданих ігор: порожньо — сповіщати про будь-яку знижку. */
function cleanDiscount(value) {
  const n = value == null || value === '' ? null : Number(value);
  if (n != null && !(Number.isInteger(n) && n >= 1 && n <= 100)) throw new HttpError(400, 'Знижка має бути від 1 до 100%');
  return n;
}

const freshUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

export function wishlistRoutes(router) {
  // Крок 1: профіль → список бажаного з цінами (нічого не додається)
  router.get('/api/steam/wishlist', requireAuth, async (ctx) => {
    const parsed = parseProfileInput(ctx.query.profile);
    if (!parsed) {
      throw new HttpError(400, 'Встав посилання на свій профіль Steam, наприклад https://steamcommunity.com/id/ім’я', { field: 'profile' });
    }
    const profile = await fetchProfile(parsed);
    const appids = await fetchWishlist(profile.steamId);
    if (!appids.length) {
      // Steam не відрізняє «порожній» від «прихований»: в обох випадках віддає порожній список
      throw templateError(
        404,
        profile.privacy && profile.privacy !== 'public'
          ? 'Профіль Steam «{name}» прихований, тому список бажаного не видно'
          : 'Steam не показує список бажаного профілю «{name}»: він порожній або прихований',
        { name: profile.name },
        { code: 'wishlist_hidden', profileName: profile.name, profilePublic: profile.privacy === 'public' }
      );
    }
    db.prepare('UPDATE users SET steam_id = ? WHERE id = ?').run(profile.steamId, ctx.user.id);
    const watched = watchedSteamIds(ctx.user.id);
    const items = await fetchStoreItems(appids.slice(0, MAX_IMPORT));
    log.info('wishlist.view', `${ctx.user.email} відкрив список бажаного Steam «${profile.name}» (${appids.length} ігор)`, { userId: ctx.user.id });
    return {
      profile: { steamId: profile.steamId, name: profile.name, avatar: profile.avatar },
      total: appids.length,
      items: items.map((i) => ({ ...i, inList: watched.has(i.storeId) })),
    };
  });

  // Крок 2: стежити за вибраними іграми
  router.post('/api/steam/wishlist/import', requireAuth, async (ctx) => {
    const appids = Array.isArray(ctx.body.appids) ? [...new Set(ctx.body.appids.map(String))].filter((id) => /^\d{1,10}$/.test(id)) : [];
    if (!appids.length) throw new HttpError(400, 'Вибери хоча б одну гру');
    if (appids.length > MAX_IMPORT) throw templateError(400, 'За один раз можна додати до {max} ігор', { max: MAX_IMPORT });
    const minDiscount = cleanDiscount(ctx.body.minDiscount);
    const conditions = { min_discount: minDiscount, max_price_uah: null, notify_free: 1, active: 1 };

    // Назви й ціни беремо зі Steam заново, а не з браузера
    const items = await fetchStoreItems(appids);
    const watched = watchedSteamIds(ctx.user.id);
    const added = [];
    const skipped = [];
    const newOffers = [];
    for (const item of items) {
      if (watched.has(item.storeId)) {
        skipped.push({ title: item.title, reason: 'уже є у списку' });
        continue;
      }
      try {
        const offer = cleanOffer(item);
        createWatch(ctx.user.id, [offer], conditions);
        added.push({ title: item.title });
        newOffers.push(offer);
      } catch (err) {
        skipped.push({ title: item.title, reason: err.status === 400 ? err.message : 'не вдалося додати' });
        if (err.status === 400 && /не більше/.test(err.message)) break; // список заповнено
      }
    }
    log.info('wishlist.import', `${ctx.user.email} імпортував зі Steam: додано ${added.length}, пропущено ${skipped.length}`, {
      userId: ctx.user.id,
      meta: { added: added.length, skipped: skipped.length },
    });
    linkGogInBackground(newOffers);
    return { added, skipped };
  });

  // Автосинхронізація: нові ігри з бажаного Steam додаються до стеження самі (перевірка кілька разів на день)
  router.get('/api/steam/sync', requireAuth, (ctx) => syncStatus(ctx.user));

  router.post('/api/steam/sync', requireAuth, async (ctx) => {
    if (!ctx.user.steam_id) throw new HttpError(400, 'Спершу імпортуй список бажаного Steam — так ми дізнаємось твій профіль');
    const total = await enableSync(ctx.user.id, ctx.user.steam_id, cleanDiscount(ctx.body.minDiscount));
    log.info('steam.sync', `${ctx.user.email} увімкнув синхронізацію з бажаним Steam (${total} ігор уже в бажаному)`, { userId: ctx.user.id });
    return syncStatus(freshUser(ctx.user.id));
  });

  router.delete('/api/steam/sync', requireAuth, (ctx) => {
    disableSync(ctx.user.id);
    return syncStatus(freshUser(ctx.user.id));
  });

  // «Перевірити зараз» — не чекаючи розкладу
  router.post('/api/steam/sync/run', requireAuth, async (ctx) => {
    if (!ctx.user.steam_sync) throw new HttpError(400, 'Синхронізацію з бажаним Steam не ввімкнено');
    const added = await syncUser(ctx.user);
    return { added, ...syncStatus(freshUser(ctx.user.id)) };
  });
}
