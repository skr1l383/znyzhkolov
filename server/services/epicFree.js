// Безкоштовні роздачі Epic Games: зберігаємо в базі й повідомляємо про нові.
import { db, now, tx } from '../db.js';
import { dateLocale, tr, userLang } from '../i18n.js';
import { log } from '../logger.js';
import { getEpicFreebies } from '../stores/index.js';
import { formatUah } from '../stores/util.js';
import { notifyUser } from './notifier.js';
import { escapeHtml } from './telegram.js';

export function listFreebies() {
  return db
    .prepare("SELECT * FROM epic_freebies WHERE status IN ('current', 'upcoming') ORDER BY status, ends_at")
    .all()
    .map((f) => ({
      id: f.id,
      title: f.title,
      url: f.url,
      imageUrl: f.image_url,
      originalPrice: f.original_price,
      currency: f.currency,
      startsAt: f.starts_at,
      endsAt: f.ends_at,
      status: f.status,
    }));
}

/** Роздачі, що вже закінчились, — найсвіжіші першими. */
export function listPastFreebies(limit = 12) {
  return db
    .prepare("SELECT * FROM epic_freebies WHERE status = 'ended' ORDER BY ends_at DESC LIMIT ?")
    .all(limit)
    .map((f) => ({
      id: f.id,
      title: f.title,
      url: f.url,
      imageUrl: f.image_url,
      originalPrice: f.original_price,
      currency: f.currency,
      startsAt: f.starts_at,
      endsAt: f.ends_at,
      status: f.status,
    }));
}

/** Скільки ігор Epic роздав (і роздає зараз), поки ми стежимо, і скільки вони коштували б у гривнях. */
export function freebieStats() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, SUM(CASE WHEN currency = 'UAH' THEN original_price END) AS total, MIN(first_seen_at) AS since
       FROM epic_freebies WHERE status IN ('current', 'ended')`
    )
    .get();
  return { count: row.count, totalUah: row.total || 0, since: row.since };
}

const dateText = (iso, lang) => (iso ? new Date(iso).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'long' }) : '?');

/** Текст сповіщення про роздачу мовою користувача. */
function freebieMessage(f, lang) {
  const price = f.original_price && f.currency === 'UAH' ? tr(lang, ' (зазвичай {price})', { price: formatUah(f.original_price) }) : '';
  const until = dateText(f.ends_at, lang);
  return {
    title: tr(lang, 'Epic Games роздає {title} безкоштовно', { title: f.title }),
    body: tr(lang, 'Забрати можна до {date}{price}.', { date: until, price }),
    html: `🎁 <b>${escapeHtml(f.title)}</b> — ${tr(lang, 'безкоштовно в Epic Games')}${escapeHtml(price)}\n${escapeHtml(tr(lang, 'До {date}', { date: until }))}`,
  };
}

export async function runEpicCheck() {
  const items = await getEpicFreebies();
  const stamp = now();
  const seen = new Set(items.map((i) => i.id));

  tx(() => {
    for (const f of items) {
      db.prepare(
        `INSERT INTO epic_freebies (id, title, url, image_url, original_price, currency, starts_at, ends_at, status, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, image_url = excluded.image_url,
           original_price = excluded.original_price, currency = excluded.currency, starts_at = excluded.starts_at,
           ends_at = excluded.ends_at, status = excluded.status, updated_at = excluded.updated_at`
      ).run(f.id, f.title, f.url, f.imageUrl, f.originalPrice, f.currency, f.startsAt, f.endsAt, f.status, stamp, stamp);
    }
    // Те, чого більше немає у відповіді Epic, вважаємо завершеним
    for (const row of db.prepare("SELECT id FROM epic_freebies WHERE status <> 'ended'").all()) {
      if (!seen.has(row.id)) db.prepare("UPDATE epic_freebies SET status = 'ended', updated_at = ? WHERE id = ?").run(stamp, row.id);
    }
  });

  // Повідомляємо про роздачі, які вже почалися і про які ще не повідомляли
  const fresh = db.prepare("SELECT * FROM epic_freebies WHERE status = 'current' AND announced = 0").all();
  let sent = 0;
  if (fresh.length) {
    const users = db.prepare('SELECT * FROM users WHERE notify_epic_free = 1').all();
    for (const f of fresh) {
      const messages = { uk: freebieMessage(f, 'uk'), en: freebieMessage(f, 'en') };
      for (const u of users) {
        await notifyUser(u, { kind: 'epic', ...messages[userLang(u)], url: f.url, image: f.image_url });
        sent += 1;
      }
      db.prepare('UPDATE epic_freebies SET announced = 1 WHERE id = ?').run(f.id);
    }
  }

  const current = items.filter((i) => i.status === 'current').length;
  log.info('epic.check', `Роздачі Epic: зараз ${current}, скоро ${items.length - current}, нових сповіщень ${sent}`);
  return { current, upcoming: items.length - current, newAnnounced: fresh.length, notifications: sent };
}
