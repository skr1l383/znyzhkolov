// Сповіщення: зберігаються на сайті (сторінка «Сповіщення») і надсилаються в Telegram.
import { db, now } from '../db.js';
import { tr, userLang } from '../i18n.js';
import { log } from '../logger.js';
import { toUah } from '../stores/currency.js';
import { STORE_NAMES } from '../stores/index.js';
import { formatUah } from '../stores/util.js';
import { emailLayout, sendMail, siteLink } from './mailer.js';
import { escapeHtml, sendMessage } from './telegram.js';

const EMAIL_KINDS = new Set(['deal', 'free', 'epic']);

/** image — картинка гри (фото в Telegram, обкладинка в листі), buttonLabel — підпис кнопки з посиланням url. */
export async function notifyUser(user, { kind, gameId = null, title, body, html, url, image = null, buttonLabel = null }) {
  const lang = userLang(user);
  const button = url ? { label: buttonLabel || tr(lang, kind === 'epic' ? 'Забрати в Epic Games' : 'Відкрити в магазині'), url } : null;
  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, game_id, kind, title, body, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(user.id, gameId, kind, title, body || null, url || null, now());

  let sent = false;
  if (user.telegram_chat_id) {
    sent = await sendMessage(user.telegram_chat_id, html || escapeHtml(`${title}\n${body || ''}`), { photo: image, button });
    if (sent) db.prepare('UPDATE notifications SET sent_telegram = 1 WHERE id = ?').run(info.lastInsertRowid);
  }

  // Лист — лише про знижки й роздачі і лише на підтверджену пошту
  let emailed = false;
  if (EMAIL_KINDS.has(kind) && user.email_verified_at && user.notify_email !== 0) {
    const mail = emailLayout({
      lang,
      heading: title,
      image,
      paragraphs: [body].filter(Boolean),
      button,
      footnote: tr(lang, 'Ти отримав цей лист, бо стежиш за цінами в Знижколові. Вимкнути листи можна в профілі: {url}', { url: siteLink('#/profile') }),
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

function conditionText(watch, lang) {
  const parts = [];
  if (watch.min_discount != null) parts.push(tr(lang, 'знижка від {n}%', { n: watch.min_discount }));
  if (watch.max_price_uah != null) parts.push(tr(lang, 'ціна до {price}', { price: formatUah(watch.max_price_uah) }));
  if (watch.notify_free) parts.push(tr(lang, 'безкоштовна роздача'));
  return parts.join(tr(lang, ' або '));
}

/** Назва магазину для сповіщення: у ключів — сам продавець. */
const storeLabel = (o, lang) => (o.store === 'keys' && o.seller ? tr(lang, '{seller} (ключ Steam)', { seller: o.seller }) : STORE_NAMES[o.store]);

const priceLine = (o, lang) => {
  const store = storeLabel(o, lang);
  if (o.is_free) return tr(lang, '{store}: безкоштовно (було {price})', { store, price: formatUah(toUah(o.base_price, o.currency)) });
  const sale = o.discount > 0 ? ` (−${o.discount}%)` : '';
  return `${store}: ${formatUah(o.price_uah)}${sale}`;
};

/** «з 11.10.2026» — з якого дня спостерігаємо ціну. */
const sinceDate = (day) => day.split('-').reverse().join('.');

/**
 * Текст сповіщення про знижку для сайту і для Telegram мовою користувача.
 * lowSince — ціна є історичним мінімумом з цієї дати.
 */
export function dealMessage(game, watch, evaluation, offers, lowSince = null, lang = 'uk') {
  const t = evaluation.trigger.offer;
  const store = storeLabel(t, lang);
  const title = t.is_free
    ? tr(lang, '{game}: безкоштовно в {store}!', { game: game.title, store })
    : tr(lang, '{game}: {price} у {store}{sale}', { game: game.title, price: formatUah(t.price_uah), store, sale: t.discount > 0 ? ` (−${t.discount}%)` : '' });

  const others = offers.filter((o) => o.id !== t.id && o.available && o.price_uah != null).map((o) => priceLine(o, lang));
  const low = lowSince ? tr(lang, 'Історичний мінімум: дешевше не було з {date}.', { date: sinceDate(lowSince) }) : '';
  const condition = tr(lang, 'Твоя умова: {condition}', { condition: conditionText(watch, lang) });
  const body = [low, `${condition}.`, others.length ? tr(lang, 'Інші магазини: {list}.', { list: others.join('; ') }) : '']
    .filter(Boolean)
    .join(' ');

  const lines = [
    `${t.is_free ? '🎁' : '🔥'} <b>${escapeHtml(game.title)}</b>`,
    '',
    `<b>${escapeHtml(priceLine(t, lang))}</b>`,
    ...(low ? [`📉 ${escapeHtml(low)}`] : []),
    ...others.map(escapeHtml),
    '',
    escapeHtml(condition),
  ];
  // Посилання на магазин — кнопкою під повідомленням (notifyUser), картинка — з будь-якого магазину, де вона є
  const image = t.image_url || offers.find((o) => o.image_url)?.image_url || null;
  return { title, body, html: lines.join('\n'), url: t.url, image, buttonLabel: tr(lang, 'Відкрити в {store}', { store }) };
}
