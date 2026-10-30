// Безкоштовні роздачі Epic Games: велика картка того, що можна забрати зараз (з таймером),
// що буде далі, історія минулих роздач і скільки Epic уже роздав, поки ми стежимо.
import { get, patch } from '../api.js';
import { setBackdrop } from '../backdrop.js';
import { locale, t, tp } from '../i18n.js';
import { state } from '../app.js';
import { $, $$, cover, formatDate, formatUah, html, setHtml, timeAgo, toast } from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');

/** Скільки лишилось до кінця роздачі: дні, години, хвилини, секунди. */
function countdown(iso) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  return {
    over: ms === 0,
    parts: [
      [Math.floor(ms / 864e5), t('дн')],
      [Math.floor((ms % 864e5) / 36e5), t('год')],
      [Math.floor((ms % 36e5) / 6e4), t('хв')],
      [Math.floor((ms % 6e4) / 1e3), t('с')],
    ],
  };
}

function timerHtml(iso) {
  const c = countdown(iso);
  if (c.over) return html`<span class="pill">${t('закінчилась')}</span>`;
  return html`${c.parts.map(([n, label]) => html`<span class="epic-timer-cell"><b>${pad(n)}</b><small>${label}</small></span>`)}`;
}

/** «22–29 жовтня» — період роздачі. */
function period(f) {
  if (!f.startsAt || !f.endsAt) return '';
  try {
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' }).formatRange(new Date(f.startsAt), new Date(f.endsAt));
  } catch {
    return `${formatDate(f.startsAt)} – ${formatDate(f.endsAt)}`;
  }
}

const usualPrice = (f) => (f.originalPrice && f.currency === 'UAH' ? f.originalPrice : null);

function nowCard(f) {
  const price = usualPrice(f);
  return html`
    <article class="epic-now">
      <div class="epic-now-art">${cover(f.imageUrl, f.title)}</div>
      <div class="epic-now-body">
        <span class="pill pill-good">${t('Безкоштовно зараз')}</span>
        <h2>${f.title}</h2>
        ${price ? html`<p class="epic-save">${t('Зазвичай')} <s>${formatUah(price)}</s> · <b>${t('заощадиш {sum}', { sum: formatUah(price) })}</b></p>` : ''}
        <div class="epic-timer" data-ends="${f.endsAt}" role="timer" aria-label="${t('Залишилось')}">${timerHtml(f.endsAt)}</div>
        <p class="hint">${t('Забрати можна до {date}', { date: formatDate(f.endsAt, true) })}</p>
        <a class="btn btn-primary btn-lg" href="${f.url}" target="_blank" rel="noopener noreferrer">${t('Забрати в Epic Games')}</a>
      </div>
    </article>
  `;
}

function soonCard(f) {
  const price = usualPrice(f);
  return html`
    <article class="freebie epic-soon">
      ${cover(f.imageUrl, f.title)}
      <div class="epic-soon-body">
        <span class="pill pill-accent">${t('Почнеться {when}', { when: timeAgo(f.startsAt) })}</span>
        <h3>${f.title}</h3>
        <p class="hint">${period(f)}${price ? html` · <s>${formatUah(price)}</s>` : ''}</p>
      </div>
    </article>
  `;
}

function pastRow(f) {
  const price = usualPrice(f);
  return html`
    <a class="epic-past" href="${f.url}" target="_blank" rel="noopener noreferrer">
      ${cover(f.imageUrl, f.title)}
      <span class="epic-past-text">
        <b>${f.title}</b>
        <small>${period(f)}</small>
      </span>
      ${price ? html`<s class="epic-past-price">${formatUah(price)}</s>` : ''}
    </a>
  `;
}

function statsCard(stats) {
  if (!stats?.count) return '';
  return html`
    <section class="epic-card epic-stats">
      <div>
        <b>${stats.count}</b>
        <span>${tp(stats.count, 'гра', 'гри', 'ігор')}</span>
      </div>
      ${stats.totalUah ? html`<div><b>${formatUah(stats.totalUah)}</b><span>${t('загальна вартість')}</span></div>` : ''}
      <p class="hint">${t('Стільки Epic роздав, відколи Знижколов стежить за роздачами ({date}).', { date: formatDate(stats.since) })}</p>
    </section>
  `;
}

function howTo() {
  const steps = [
    [t('Натисни «Забрати в Epic Games»'), t('Відкриється сторінка гри в магазині Epic.')],
    [t('Увійди й натисни «Отримати»'), t('Потрібен лише безкоштовний акаунт Epic, картка не потрібна.')],
    [t('Гра твоя назавжди'), t('Вона лишиться в бібліотеці, навіть коли роздача закінчиться.')],
  ];
  return html`
    <section class="epic-card">
      <h2>${t('Як забрати гру')}</h2>
      <ol class="epic-steps">
        ${steps.map(([title, text]) => html`<li><b>${title}</b><span>${text}</span></li>`)}
      </ol>
    </section>
  `;
}

export async function render(root) {
  setHtml(root, html`<div class="stack"><div class="skeleton" style="height: 320px"></div><div class="skeleton"></div></div>`);
  const { items, past = [], stats, lastCheck } = await get('/api/epic');
  const current = items.filter((i) => i.status === 'current');
  const upcoming = items.filter((i) => i.status === 'upcoming');
  if (current[0]?.imageUrl) setBackdrop(current[0].imageUrl);

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>${t('Роздачі Epic Games')}</h1>
          <p>${t('Щотижня Epic віддає ігри безкоштовно. Забрана гра залишається в бібліотеці назавжди.')}</p>
        </div>
      </div>

      ${current.length
        ? html`<div class="epic-hero ${current.length === 1 ? 'is-single' : ''}">${current.map(nowCard)}</div>`
        : html`<div class="empty"><p>${t('Зараз активних роздач немає або Epic Games не відповідає. Ми перевіримо ще раз автоматично.')}</p></div>`}

      <div class="epic-layout">
        <div class="epic-main">
          ${upcoming.length
            ? html`<div class="section-title"><h2>${t('Скоро')}</h2><span class="count">${upcoming.length}</span></div>
                <div class="freebies">${upcoming.map(soonCard)}</div>`
            : ''}
          ${past.length
            ? html`<div class="section-title"><h2>${t('Уже роздавали')}</h2><span class="count">${past.length}</span></div>
                <div class="epic-past-list">${past.map(pastRow)}</div>`
            : ''}
          ${lastCheck ? html`<p class="hint">${t('Дані оновлено {when}. Перевіряємо автоматично кілька разів на день.', { when: timeAgo(lastCheck) })}</p>` : ''}
        </div>

        <aside class="epic-side">
          <section class="epic-card epic-notify">
            <h2>${t('Не пропусти наступну')}</h2>
            <label class="check">
              <input type="checkbox" id="epic-notify" ${state.user.notifyEpicFree ? 'checked' : ''} />
              <span>${t('Повідомляти мене про нові роздачі')}</span>
            </label>
            <p class="hint">${t('Напишемо на сайті, у Telegram і на пошту — як налаштовано в профілі.')}</p>
          </section>
          ${statsCard(stats)}
          ${howTo()}
        </aside>
      </div>
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

  // Таймер іде щосекунди, поки людина на сторінці
  const tick = setInterval(() => {
    for (const el of $$('.epic-timer', root)) setHtml(el, timerHtml(el.dataset.ends));
  }, 1000);
  return () => clearInterval(tick);
}
