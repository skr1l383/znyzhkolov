// Історія сповіщень: фільтр за типом, групи за днями, обкладинки ігор. Справа — куди надходять сповіщення
// і про що ми повідомляємо. Ті самі повідомлення надходять у Telegram і на пошту, якщо їх підключено.
import { get, post } from '../api.js';
import { locale, t } from '../i18n.js';
import { setUnread, state } from '../app.js';
import { $, cover, formatDate, gameHref, html, setHtml, timeAgo } from '../ui.js';

const ICONS = { deal: '🔥', free: '🎁', epic: '🎮', system: '✓' };
const FILTERS = [
  ['all', 'Усі'],
  ['deal', 'Знижки'],
  ['epic', 'Роздачі Epic'],
  ['system', 'Інше'],
];
// «Безкоштовно» — теж знижка (100%), тож фільтр у них спільний
const group = (n) => (n.kind === 'free' ? 'deal' : n.kind in ICONS ? n.kind : 'system');

function notice(n) {
  const kind = group(n);
  return html`
    <article class="notice notice-${kind} ${n.read ? '' : 'unread'}">
      <span class="notice-icon" aria-hidden="true">${ICONS[n.kind] || ICONS.system}</span>
      <div class="notice-text">
        <div class="notice-title">${n.title}</div>
        ${n.body ? html`<div class="notice-body">${n.body}</div>` : ''}
        <div class="notice-meta">
          <time datetime="${n.createdAt}" title="${formatDate(n.createdAt, true)}">${timeAgo(n.createdAt)}</time>
          ${n.telegram ? html`<span>${t('надіслано в Telegram')}</span>` : ''}
          ${n.game ? html`<a href="${gameHref(n.game.store, n.game.storeId)}">${t('Сторінка гри')}</a>` : ''}
          ${n.url ? html`<a href="${n.url}" target="_blank" rel="noopener noreferrer">${t('Відкрити магазин')}</a>` : ''}
        </div>
      </div>
      ${n.imageUrl ? html`<span class="notice-cover">${cover(n.imageUrl, n.title)}</span>` : ''}
    </article>
  `;
}

/** «Сьогодні», «Вчора» або дата — заголовок групи сповіщень. */
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return t('Сьогодні');
  if (days === 1) return t('Вчора');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

function listHtml(items) {
  const days = [];
  for (const n of items) {
    const label = dayLabel(n.createdAt);
    if (days.at(-1)?.label === label) days.at(-1).items.push(n);
    else days.push({ label, items: [n] });
  }
  return html`${days.map((d) => html`<h2 class="notice-day">${d.label}</h2><div class="notice-list">${d.items.map(notice)}</div>`)}`;
}

function emptyState() {
  return html`
    <div class="notice-empty">
      <span class="notice-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      </span>
      <h2>${t('Сповіщень ще немає')}</h2>
      <p>${t("Тут з'являться знижки на ігри з твого списку та нові роздачі Epic Games.")}</p>
      <div class="row" style="justify-content: center">
        <a class="btn btn-primary" href="#/search">${t('Знайти гру')}</a>
        <a class="btn" href="#/list">${t('Мій список')}</a>
      </div>
    </div>
  `;
}

function channels() {
  const u = state.user;
  const row = (icon, name, on, text, link) => html`
    <li class="notify-channel ${on ? 'is-on' : ''}">
      <span class="notify-channel-icon" aria-hidden="true">${icon}</span>
      <span class="notify-channel-text"><b>${name}</b><small>${text}</small></span>
      ${link ? html`<a class="btn btn-sm" href="${link[0]}">${link[1]}</a>` : html`<span class="notify-channel-dot" title="${t('Увімкнено')}"></span>`}
    </li>`;
  return html`
    <section class="epic-card">
      <h2>${t('Куди надходять сповіщення')}</h2>
      <ul class="notify-channels">
        ${row('🔔', t('На сайті'), true, t('Завжди, на цій сторінці'), null)}
        ${u.telegramLinked
          ? row('✈️', 'Telegram', true, u.telegramUsername ? `@${u.telegramUsername}` : t('Підключено'), null)
          : row('✈️', 'Telegram', false, t('Миттєво на телефон'), ['#/profile', t('Підключити')])}
        ${u.notifyEmail && u.emailVerified
          ? row('✉️', t('Пошта'), true, u.email, null)
          : row('✉️', t('Пошта'), false, u.emailVerified ? t('Вимкнено') : t('Пошту не підтверджено'), ['#/profile', t('Налаштувати')])}
      </ul>
    </section>
    <section class="epic-card">
      <h2>${t('Про що ми повідомляємо')}</h2>
      <ul class="notice-kinds">
        <li><span aria-hidden="true">🔥</span>${t('Гра з твого списку подешевшала до твоєї умови')}</li>
        <li><span aria-hidden="true">📉</span>${t('Ціна — історичний мінімум, дешевше не бувало')}</li>
        <li><span aria-hidden="true">🎁</span>${t('Гра стала безкоштовною')}</li>
        <li>
          <span aria-hidden="true">🎮</span>${t('Нова роздача в Epic Games')}
          ${u.notifyEpicFree ? '' : html` · <a href="#/epic">${t('увімкнути')}</a>`}
        </li>
      </ul>
    </section>
  `;
}

export async function render(root) {
  setHtml(root, html`<div class="stack"><div class="skeleton"></div></div>`);
  const { items, unread } = await get('/api/notifications?limit=100');
  const counts = Object.fromEntries(FILTERS.map(([key]) => [key, key === 'all' ? items.length : items.filter((n) => group(n) === key).length]));

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>${t('Сповіщення')}</h1>
          <p>
            ${unread
              ? t('Нових: {n}. Ми відмітили їх прочитаними.', { n: unread })
              : t('Знижки на ігри з твого списку й нові роздачі — усе в одному місці.')}
          </p>
        </div>
      </div>
      <div class="epic-layout">
        <div class="epic-main">
          ${items.length
            ? html`<div class="segmented notice-filter" role="group" aria-label="${t('Тип сповіщень')}">
                  ${FILTERS.filter(([key]) => key === 'all' || counts[key]).map(
                    ([key, label]) => html`<button type="button" data-filter="${key}" aria-pressed="${key === 'all'}">
                      ${t(label)} <span class="count">${counts[key]}</span>
                    </button>`
                  )}
                </div>
                <div id="notice-days">${listHtml(items)}</div>`
            : emptyState()}
        </div>
        <aside class="epic-side">${channels()}</aside>
      </div>
    `
  );

  root.querySelector('.notice-filter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const key = btn.dataset.filter;
    setHtml($('#notice-days', root), listHtml(key === 'all' ? items : items.filter((n) => group(n) === key)));
  });

  if (unread) {
    post('/api/notifications/read')
      .then(() => setUnread(0))
      .catch(() => {});
  }
}
