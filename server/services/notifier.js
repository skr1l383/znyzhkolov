// Сповіщення: зберігаються на сайті (сторінка «Сповіщення») і надсилаються в Telegram.
import { db, now } from '../db.js';
import { log } from '../logger.js';
import { toUah } from '../stores/currency.js';
import { STORE_NAMES } from '../stores/index.js';
import { formatUah } from '../stores/util.js';
import { escapeHtml, sendMessage } from './telegram.js';

export async function notifyUser(user, { kind, gameId = null, title, body, html, url }) {
  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, game_id, kind, title, body, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(user.id, gameId, kind, title, body || null, url || null, now());

  let sent = false;
  if (user.telegram_chat_id) {
    sent = await sendMessage(user.telegram_chat_id, html || escapeHtml(`${title}\n${body || ''}`));
    if (sent) db.prepare('UPDATE notifications SET sent_telegram = 1 WHERE id = ?').run(info.lastInsertRowid);
  }
  log.info('notify.sent', `Сповіщення «${title}» для ${user.email}${sent ? ' (+Telegram)' : ''}`, {
    userId: user.id,
    meta: { kind, gameId },
  });
  return { id: Number(info.lastInsertRowid), telegram: sent };
}

function conditionText(watch) {
  const parts = [];
  if (watch.min_discount != null) parts.push(`знижка від ${watch.min_discount}%`);
  if (watch.max_price_uah != null) parts.push(`ціна до ${formatUah(watch.max_price_uah)}`);
  if (watch.notify_free) parts.push('безкоштовна роздача');
  return parts.join(' або ');
}

const priceLine = (o) => {
  if (o.is_free) return `${STORE_NAMES[o.store]}: безкоштовно (було ${formatUah(toUah(o.base_price, o.currency))})`;
  const sale = o.discount > 0 ? ` (−${o.discount}%)` : '';
  return `${STORE_NAMES[o.store]}: ${formatUah(o.price_uah)}${sale}`;
};

/** Текст сповіщення про знижку для сайту і для Telegram. */
export function dealMessage(game, watch, evaluation, offers) {
  const t = evaluation.trigger.offer;
  const storeName = STORE_NAMES[t.store];
  const title = t.is_free
    ? `${game.title}: безкоштовно в ${storeName}!`
    : `${game.title}: ${formatUah(t.price_uah)} у ${storeName}${t.discount > 0 ? ` (−${t.discount}%)` : ''}`;

  const others = offers.filter((o) => o.id !== t.id && o.available && o.price_uah != null).map(priceLine);
  const body = [`Твоя умова: ${conditionText(watch)}.`, others.length ? `Інші магазини: ${others.join('; ')}.` : '']
    .filter(Boolean)
    .join(' ');

  const lines = [
    `${t.is_free ? '🎁' : '🔥'} <b>${escapeHtml(game.title)}</b>`,
    '',
    `<b>${escapeHtml(priceLine(t))}</b>`,
    ...others.map(escapeHtml),
    '',
    `Твоя умова: ${escapeHtml(conditionText(watch))}`,
  ];
  if (t.url) lines.push(`<a href="${escapeHtml(t.url)}">Відкрити в ${escapeHtml(storeName)}</a>`);

  return { title, body, html: lines.join('\n'), url: t.url };
}
