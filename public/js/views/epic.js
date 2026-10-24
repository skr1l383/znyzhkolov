// Безкоштовні роздачі Epic Games: що можна забрати зараз і що буде далі.
import { get, patch } from '../api.js';
import { t } from '../i18n.js';
import { state } from '../app.js';
import { $, cover, formatDate, formatUah, html, setHtml, timeAgo, toast } from '../ui.js';

function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('закінчилась');
  const days = Math.floor(ms / 864e5);
  const hours = Math.floor((ms % 864e5) / 36e5);
  if (days > 0) return t('ще {days} дн. {hours} год.', { days, hours });
  return t('ще {hours} год.', { hours });
}

function freebieCard(f) {
  const usual = f.originalPrice && f.currency === 'UAH' ? html`<span class="price-old">${formatUah(f.originalPrice)}</span>` : '';
  if (f.status === 'current') {
    return html`
      <article class="freebie">
        ${cover(f.imageUrl, f.title)}
        <h3>${f.title}</h3>
        <div class="freebie-meta">
          <span class="price-values"><span class="pill pill-good">${t('Безкоштовно')}</span> ${usual}</span>
          <span class="hint">${timeLeft(f.endsAt)}</span>
        </div>
        <a class="btn btn-primary" href="${f.url}" target="_blank" rel="noopener noreferrer">${t('Забрати в Epic Games')}</a>
      </article>
    `;
  }
  return html`
    <article class="freebie">
      ${cover(f.imageUrl, f.title)}
      <h3>${f.title}</h3>
      <div class="freebie-meta">
        <span class="pill pill-accent">${t('З {date}', { date: formatDate(f.startsAt) })}</span>
        ${usual}
      </div>
      <a class="btn" href="${f.url}" target="_blank" rel="noopener noreferrer">${t('Сторінка гри')}</a>
    </article>
  `;
}

export async function render(root) {
  setHtml(root, html`<div class="freebies">${[1, 2, 3].map(() => html`<div class="skeleton"></div>`)}</div>`);
  const { items, lastCheck } = await get('/api/epic');
  const current = items.filter((i) => i.status === 'current');
  const upcoming = items.filter((i) => i.status === 'upcoming');

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>${t('Роздачі Epic Games')}</h1>
          <p>${t('Щотижня Epic віддає ігри безкоштовно. Забрана гра залишається в бібліотеці назавжди.')}</p>
        </div>
        <label class="check">
          <input type="checkbox" id="epic-notify" ${state.user.notifyEpicFree ? 'checked' : ''} />
          <span>${t('Повідомляти мене про нові роздачі')}</span>
        </label>
      </div>

      <div class="section-title"><h2>${t('Зараз безкоштовно')}</h2><span class="count">${current.length}</span></div>
      ${current.length
        ? html`<div class="freebies">${current.map(freebieCard)}</div>`
        : html`<div class="empty"><p>${t('Зараз активних роздач немає або Epic Games не відповідає. Ми перевіримо ще раз автоматично.')}</p></div>`}

      ${upcoming.length
        ? html`<div class="section-title"><h2>${t('Скоро')}</h2><span class="count">${upcoming.length}</span></div>
            <div class="freebies">${upcoming.map(freebieCard)}</div>`
        : ''}

      ${lastCheck ? html`<p class="hint" style="margin-top:24px">${t('Дані оновлено {when}. Перевіряємо автоматично кілька разів на день.', { when: timeAgo(lastCheck) })}</p>` : ''}
    `
  );

  $('#epic-notify', root).addEventListener('change', async (e) => {
    try {
      const { user } = await patch('/api/me', { notifyEpicFree: e.target.checked });
      state.user = user;
      toast(user.notifyEpicFree ? t('Повідомлятимемо про нові роздачі') : t('Сповіщення про роздачі вимкнено'));
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, 'error');
    }
  });
}
