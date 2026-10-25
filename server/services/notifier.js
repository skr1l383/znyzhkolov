// Сповіщення: зберігаються на сайті (сторінка «Сповіщення») і надсилаються в Telegram.
import { db, now } from '../db.js';
import { log } from '../logger.js';
import { toUah } from '../stores/currency.js';
import { STORE_NAMES } from '../stores/index.js';
import { formatUah } from '../stores/util.js';
import { emailLayout, sendMail, siteLink } from './mailer.js';
import { escapeHtml, sendMessage } from './telegram.js';

const EMAIL_KINDS = new Set(['deal', 'free', 'epic']);

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

  // Лист — лише про знижки й роздачі і лише на підтверджену пошту
  let emailed = false;
  if (EMAIL_KINDS.has(kind) && user.email_verified_at && user.notify_email !== 0) {
    const mail = emailLayout({
      heading: title,
      paragraphs: [body].filter(Boolean),
      button: url ? { label: kind === 'epic' ? 'Забрати в Epic Games' : 'Відкрити в магазині', url } : null,
      footnote: `Ти отримав цей лист, бо стежиш за цінами в Знижколові. Вимкнути листи можна в профілі: ${siteLink('#/profile')}`,
    });
    emailed = (await sendMail({ to: user.email, subject: title, ...mail, kind, userId: user.id })).ok;
    if (emailed) db.prepare('UPDATE notifications SET sent_email = 1 WHERE id = ?').run(info.lastInsertRowid);
  }
  log.info('notify.sent', `Сповіщення «${title}» для ${user.email}${sent ? ' (+Telegram)' : ''}${emailed ? ' (+лист)' : ''}`, {
    userId: user.id,
    meta: { kind, gameId },
  });
  return { id: Number(info.lastInsertRowid), telegram: sent, email: emailed };
}

function conditionText(watch) {
  const parts = [];
  if (watch.min_discount != null) parts.push(`знижка від ${watch.min_discount}%`);
  if (watch.max_price_uah != null) parts.push(`ціна до ${formatUah(watch.max_price_uah)}`);
  if (watch.notify_free) parts.push('безкоштовна роздача');
  return parts.join(' або ');
}

/** Назва магазину для сповіщення: у ключів — сам продавець. */
const storeLabel = (o) => (o.store === 'keys' && o.seller ? `${o.seller} (ключ Steam)` : STORE_NAMES[o.store]);

const priceLine = (o) => {
  if (o.is_free) return `${storeLabel(o)}: безкоштовно (було ${formatUah(toUah(o.base_price, o.currency))})`;
  const sale = o.discount > 0 ? ` (−${o.discount}%)` : '';
  return `${storeLabel(o)}: ${formatUah(o.price_uah)}${sale}`;
};

/** Текст сповіщення про знижку для сайту і для Telegram. */
export function dealMessage(game, watch, evaluation, offers) {
  const t = evaluation.trigger.offer;
  const storeName = storeLabel(t);
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
