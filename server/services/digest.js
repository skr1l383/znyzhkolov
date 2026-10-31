// Тижневий дайджест: щонеділі після 10:00 (за Києвом) — що зі знижкою з твого списку і найкращі знижки тижня.
// Приходить листом (з обкладинками), у Telegram, пушем і на сторінку сповіщень. Вимикається в профілі.
import { db, now } from '../db.js';
import { tr, userLang } from '../i18n.js';
import { log } from '../logger.js';
import { formatUah } from '../stores/util.js';
import { STORE_NAMES } from '../stores/index.js';
import { normalizeTitle } from '../stores/match.js';
import { listDeals } from './deals.js';
import { listFreebies } from './epicFree.js';
import { siteLink } from './mailer.js';
import { notifyUser } from './notifier.js';
import { escapeHtml } from './telegram.js';
import { listWatch } from './watch.js';

const DAY_MS = 864e5;

const bestOffer = (w) => w.offers.filter((o) => o.available && o.priceUah != null).sort((a, b) => a.priceUah - b.priceUah)[0] || null;
const gameLink = (store, storeId) => siteLink(`#/game?store=${store}&id=${storeId}`);
// Суми в листі не мають розриватися між рядками («1 609 ₴»)
const money = (minor) => formatUah(minor).replace(/\s/g, ' ');

/** Дані дайджесту для однієї людини. null — якщо списку немає (тоді й писати нема про що). */
export function buildDigest(user) {
  const items = listWatch(user.id).filter((w) => w.active);
  if (!items.length) return null;
  const onSale = items
    .map((w) => ({ w, best: bestOffer(w) }))
    .filter((x) => x.best?.discount > 0)
    .sort((a, b) => b.best.discount - a.best.discount);
  const savings = onSale.reduce((s, x) => s + Math.max(0, (x.best.basePriceUah ?? x.best.priceUah) - x.best.priceUah), 0);
  // Популярні ігри з великою знижкою й добрими відгуками, яких у списку ще немає (і в іншому магазині теж)
  const mine = new Set(items.map((w) => normalizeTitle(w.title)));
  const deals = listDeals({ minDiscount: 50, sort: 'popular', limit: 40, userId: user.id })
    .items.filter((d) => !d.watching && !mine.has(normalizeTitle(d.title)) && (d.rating ?? 0) >= 80)
    .slice(0, 5);
  return {
    total: items.length,
    onSale: onSale.slice(0, 5),
    onSaleCount: onSale.length,
    met: items.filter((w) => w.conditionMet).length,
    savings,
    deals,
    freebies: listFreebies().filter((f) => f.status === 'current'),
  };
}

const priceText = (lang, priceUah, discount, store) =>
  `${priceUah === 0 ? tr(lang, 'безкоштовно') : money(priceUah)} · −${discount}% · ${STORE_NAMES[store] || store}`;

/** Текст і лист дайджесту мовою людини. */
export function digestMessage(user, d) {
  const lang = userLang(user);
  const title = tr(lang, 'Тижневий дайджест Знижколова');
  const summary = d.onSaleCount
    ? tr(lang, 'Зі знижкою зараз {n} з твого списку ({total} у стеженні), можна заощадити {sum}.', { n: d.onSaleCount, total: d.total, sum: money(d.savings) })
    : tr(lang, 'Цього тижня жодна гра з твого списку ({total}) не має знижки — продовжуємо стежити.', { total: d.total });
  const mine = d.onSale.map(({ w, best }) => ({
    title: w.title,
    line: priceText(lang, best.priceUah, best.discount, best.store) + (w.conditionMet ? ` · ${tr(lang, 'умову виконано')}` : ''),
    image: w.imageUrl,
    url: gameLink(w.offers[0].store, w.offers[0].storeId),
  }));
  const top = d.deals.map((g) => ({ title: g.title, line: priceText(lang, g.priceUah, g.discount, g.store), image: g.imageUrl, url: gameLink(g.store, g.storeId) }));
  const free = d.freebies.map((f) => ({ title: f.title, line: tr(lang, 'безкоштовно в Epic Games'), image: f.imageUrl, url: f.url }));

  const sections = [
    mine.length && { heading: tr(lang, 'З твого списку'), rows: mine },
    top.length && { heading: tr(lang, 'Найкращі знижки тижня'), rows: top },
    free.length && { heading: tr(lang, 'Безкоштовно в Epic Games'), rows: free },
  ].filter(Boolean);

  const tgLines = (rows) => rows.map((r) => `• <a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a> — ${escapeHtml(r.line)}`).join('\n');
  const html = [`📬 <b>${escapeHtml(title)}</b>`, escapeHtml(summary), ...sections.map((s) => `\n<b>${escapeHtml(s.heading)}</b>\n${tgLines(s.rows)}`)].join('\n');
  return { title, summary, sections, html };
}

/** Чи зараз неділя після 10:00 за Києвом. */
function digestTime(at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at).map((p) => [p.type, p.value])
  );
  return parts.weekday === 'Sun' && Number(parts.hour) >= 10;
}

/**
 * Задача щогодини: у неділю після 10:00 надсилає дайджест тим, хто його ще не отримав цього тижня.
 * Запуск вручну (з адмін-панелі) не чекає неділі, але й не надсилає повторно раніше ніж через 6 днів.
 */
export async function runDigest({ trigger = 'schedule', at = new Date() } = {}) {
  if (trigger === 'schedule' && !digestTime(at)) return { skipped: true, reason: 'не час' };
  const users = db
    .prepare('SELECT * FROM users WHERE notify_digest = 1 AND (digest_sent_at IS NULL OR digest_sent_at < ?)')
    .all(new Date(at.getTime() - 6 * DAY_MS).toISOString());
  let sent = 0;
  for (const user of users) {
    try {
      const d = buildDigest(user);
      if (!d) continue;
      const m = digestMessage(user, d);
      await notifyUser(user, { kind: 'digest', title: m.title, body: m.summary, html: m.html, url: siteLink('#/list'), sections: m.sections });
      db.prepare('UPDATE users SET digest_sent_at = ? WHERE id = ?').run(now(), user.id);
      sent += 1;
    } catch (err) {
      log.warn('digest.error', `Дайджест для ${user.email} не надіслано: ${err.message}`, { userId: user.id });
    }
  }
  if (sent) log.info('digest.sent', `Тижневий дайджест надіслано: ${sent}`);
  return { sent };
}
