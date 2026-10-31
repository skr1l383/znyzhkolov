// Автосинхронізація зі списком бажаного Steam: кілька разів на день перевіряємо бажане людини
// і нові ігри з нього самі додаються до стеження (з її умовою знижки). Про додані — сповіщення.
// Додаємо лише ігри, що з'явилися в бажаному ПІСЛЯ ввімкнення: усе, що вже бачили, запам'ятовуємо
// (steam_sync_seen), тож гра, яку людина сама прибрала зі списку, не повертатиметься знову.
import { config } from '../config.js';
import { db, now } from '../db.js';
import { tr, userLang } from '../i18n.js';
import { log } from '../logger.js';
import { cleanOffer, createWatch } from '../routes/games.js';
import { store } from '../stores/index.js';
import { rankMatches } from '../stores/match.js';
import { sleep } from '../stores/util.js';
import { fetchStoreItems, fetchWishlist } from '../stores/wishlist.js';
import { notifyUser } from './notifier.js';
import { evaluateWatches, refreshGame, upsertGameWithOffers } from './prices.js';

const MAX_PER_RUN = 50; // стільки нових ігор за одну перевірку — решта наступного разу

/** Steam-ігри, за якими користувач уже стежить. */
export function watchedSteamIds(userId) {
  return new Set(
    db
      .prepare("SELECT o.store_id FROM offers o JOIN watch_items w ON w.game_id = o.game_id WHERE w.user_id = ? AND o.store = 'steam'")
      .all(userId)
      .map((r) => r.store_id)
  );
}

/** Фон: знайти кожну нову гру в GOG (лише з дуже схожою назвою), оновити ціни й перевірити умови. */
export async function linkGogInBackground(steamOffers) {
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

const markSeen = (userId, appids) => {
  const insert = db.prepare('INSERT OR IGNORE INTO steam_sync_seen (user_id, app_id) VALUES (?, ?)');
  for (const id of appids) insert.run(userId, String(id));
};

/** Стан синхронізації для профілю й списку. */
export function syncStatus(user) {
  return {
    enabled: Boolean(user.steam_sync),
    steamId: user.steam_id || null,
    minDiscount: user.steam_sync_discount ?? null,
    syncedAt: user.steam_synced_at || null,
  };
}

/**
 * Вмикає синхронізацію. Поточний список бажаного — «уже бачені»: їх людина щойно могла імпортувати
 * (або свідомо не вибрати), тож автоматично додаються лише ігри, які з'являться пізніше.
 */
export async function enableSync(userId, steamId, minDiscount) {
  const appids = await fetchWishlist(steamId);
  db.prepare('DELETE FROM steam_sync_seen WHERE user_id = ?').run(userId);
  markSeen(userId, appids);
  db.prepare('UPDATE users SET steam_sync = 1, steam_sync_discount = ?, steam_synced_at = ? WHERE id = ?').run(minDiscount, now(), userId);
  return appids.length;
}

export function disableSync(userId) {
  db.prepare('UPDATE users SET steam_sync = 0 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM steam_sync_seen WHERE user_id = ?').run(userId);
}

/** Одна перевірка для одного користувача. Повертає назви доданих ігор. */
export async function syncUser(user) {
  const appids = (await fetchWishlist(user.steam_id)).map(String);
  const seen = new Set(db.prepare('SELECT app_id FROM steam_sync_seen WHERE user_id = ?').all(user.id).map((r) => r.app_id));
  const watched = watchedSteamIds(user.id);
  const fresh = appids.filter((id) => !seen.has(id) && !watched.has(id)).slice(0, MAX_PER_RUN);
  // Решту нових (уже в списку або понад ліміт) не позначаємо, крім тих, що вже в списку
  markSeen(user.id, appids.filter((id) => watched.has(id)));

  const added = [];
  const offers = [];
  if (fresh.length) {
    const conditions = { min_discount: user.steam_sync_discount ?? null, max_price_uah: null, notify_free: 1, active: 1 };
    for (const item of await fetchStoreItems(fresh)) {
      try {
        const offer = cleanOffer(item);
        createWatch(user.id, [offer], conditions);
        added.push(item.title);
        offers.push(offer);
      } catch (err) {
        log.warn('steam.sync', `Не вдалося додати «${item.title}»: ${err.message}`, { userId: user.id });
        if (err.status === 400 && /не більше/.test(err.message)) break; // список заповнено
      }
    }
    markSeen(user.id, fresh);
  }
  db.prepare('UPDATE users SET steam_synced_at = ? WHERE id = ?').run(now(), user.id);

  if (added.length) {
    const lang = userLang(user);
    log.info('steam.sync', `${user.email}: зі списку бажаного Steam додано ${added.length}`, { userId: user.id, meta: { added: added.length } });
    await notifyUser(user, {
      kind: 'system',
      title: tr(lang, 'Нові ігри з бажаного Steam: {n}', { n: added.length }),
      body: tr(lang, 'Тепер стежимо й за ними: {list}.', { list: added.slice(0, 5).join(', ') + (added.length > 5 ? '…' : '') }),
    });
    linkGogInBackground(offers);
  }
  return added;
}

/** Задача за розкладом: перевіряє всіх, у кого синхронізацію ввімкнено. */
export async function runSteamSync() {
  const users = db.prepare('SELECT * FROM users WHERE steam_sync = 1 AND steam_id IS NOT NULL').all();
  let added = 0;
  for (const user of users) {
    try {
      added += (await syncUser(user)).length;
    } catch (err) {
      // Steam недоступний або профіль став прихованим — спробуємо наступного разу
      log.warn('steam.sync', `Синхронізація для ${user.email} не вдалась: ${err.message}`, { userId: user.id });
    }
    if (!config.demoStores) await sleep(1000);
  }
  return { users: users.length, added };
}
