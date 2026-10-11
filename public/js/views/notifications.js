// Історія сповіщень. Ті самі повідомлення надходять у Telegram, якщо його підключено.
import { get, post } from '../api.js';
import { setUnread, state } from '../app.js';
import { formatDate, html, setHtml, timeAgo } from '../ui.js';

const ICONS = { deal: '🔥', free: '🎁', epic: '🎮', system: '✓' };

function notice(n) {
  return html`
    <article class="notice ${n.read ? '' : 'unread'}">
      <span class="notice-icon" aria-hidden="true">${ICONS[n.kind] || '•'}</span>
      <div>
        <div class="notice-title">${n.title}</div>
        ${n.body ? html`<div class="notice-body">${n.body}</div>` : ''}
        <div class="notice-meta">
          <time datetime="${n.createdAt}" title="${formatDate(n.createdAt, true)}">${timeAgo(n.createdAt)}</time>
          ${n.telegram ? html`<span>надіслано в Telegram</span>` : ''}
          ${n.url ? html`<a href="${n.url}" target="_blank" rel="noopener noreferrer">Відкрити магазин</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

export async function render(root) {
  setHtml(root, html`<div class="stack"><div class="skeleton"></div></div>`);
  const { items, unread } = await get('/api/notifications?limit=100');

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>Сповіщення</h1>
          <p>
            ${state.user.telegramLinked
              ? 'Усі сповіщення також надходять тобі в Telegram.'
              : html`Підключи Telegram у <a href="#/profile">профілі</a>, щоб отримувати їх миттєво на телефон.`}
          </p>
        </div>
      </div>
      ${items.length
        ? html`<div class="notice-list">${items.map(notice)}</div>`
        : html`<div class="empty"><h2>Сповіщень ще немає</h2><p>Тут з'являться знижки на ігри з твого списку та нові роздачі Epic Games.</p></div>`}
    `
  );

  if (unread) {
    post('/api/notifications/read')
      .then(() => setUnread(0))
      .catch(() => {});
  }
}
