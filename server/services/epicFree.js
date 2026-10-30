// Безкоштовні роздачі Epic Games: зберігаємо в базі й повідомляємо про нові.
import { db, now, tx } from '../db.js';
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

const dateUk = (iso) => (iso ? new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) : '?');

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
      const price = f.original_price && f.currency === 'UAH' ? ` (зазвичай ${formatUah(f.original_price)})` : '';
      const title = `Epic Games роздає ${f.title} безкоштовно`;
      const body = `Забрати можна до ${dateUk(f.ends_at)}${price}.`;
      const html = `🎁 <b>${escapeHtml(f.title)}</b> — безкоштовно в Epic Games${escapeHtml(price)}\nДо ${escapeHtml(dateUk(f.ends_at))}`;
      for (const u of users) {
        await notifyUser(u, { kind: 'epic', title, body, html, url: f.url, image: f.image_url });
        sent += 1;
      }
      db.prepare('UPDATE epic_freebies SET announced = 1 WHERE id = ?').run(f.id);
    }
  }

  const current = items.filter((i) => i.status === 'current').length;
  log.info('epic.check', `Роздачі Epic: зараз ${current}, скоро ${items.length - current}, нових сповіщень ${sent}`);
  return { current, upcoming: items.length - current, newAnnounced: fresh.length, notifications: sent };
}
