// Імпорт списку бажаного Steam: показати ігри з цінами → вибрати → стежити за всіма одним натисканням.
// Ігри додаються одразу зі Steam, а та сама гра в GOG шукається у фоні (по одній, щоб не засипати GOG запитами).
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import { requireAuth } from '../auth.js';
import { evaluateWatches, refreshGame, upsertGameWithOffers } from '../services/prices.js';
import { store } from '../stores/index.js';
import { rankMatches } from '../stores/match.js';
import { sleep } from '../stores/util.js';
import { fetchProfile, fetchStoreItems, fetchWishlist, parseProfileInput } from '../stores/wishlist.js';
import { cleanOffer, createWatch } from './games.js';

const MAX_IMPORT = 200;

/** Steam-ігри, за якими користувач уже стежить. */
function watchedSteamIds(userId) {
  return new Set(
    db
      .prepare("SELECT o.store_id FROM offers o JOIN watch_items w ON w.game_id = o.game_id WHERE w.user_id = ? AND o.store = 'steam'")
      .all(userId)
      .map((r) => r.store_id)
  );
}

/** Фон: знайти кожну нову гру в GOG (лише з дуже схожою назвою), оновити ціни й перевірити умови. */
async function linkGogInBackground(steamOffers) {
  for (const offer of steamOffers) {
    try {
      const match = rankMatches(offer.title, await store('gog').search(offer.title), 0.9)[0];
      const gameId = upsertGameWithOffers(match ? [offer, cleanOffer(match)] : [offer]);
      await refreshGame(gameId);
    } catch (err) {
      log.warn('wishlist.gog', `Не вдалося знайти «${offer.title}» у GOG: ${err.message}`);
    }
    if (!config.demoStores) await sleep(400);
  }
  await evaluateWatches().catch(() => {});
}

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
      throw new HttpError(
        404,
        profile.privacy && profile.privacy !== 'public'
          ? 'Профіль Steam прихований. Відкрий його: Steam → профіль → «Редагувати профіль» → «Приватність» → «Інформація про ігри: Відкрита»'
          : 'Список бажаного порожній або прихований. Перевір у Steam: «Редагувати профіль» → «Приватність» → «Інформація про ігри: Відкрита»'
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
    if (appids.length > MAX_IMPORT) throw new HttpError(400, `За один раз можна додати до ${MAX_IMPORT} ігор`);
    const minDiscount = ctx.body.minDiscount == null || ctx.body.minDiscount === '' ? null : Number(ctx.body.minDiscount);
    if (minDiscount != null && !(Number.isInteger(minDiscount) && minDiscount >= 1 && minDiscount <= 100)) {
      throw new HttpError(400, 'Знижка має бути від 1 до 100%');
    }
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
}
