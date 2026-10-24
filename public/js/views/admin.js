// Адмін-панель: статистика, задачі за розкладом, користувачі та журнал подій.
import { get, patch, post } from '../api.js';
import { locale, t } from '../i18n.js';
import { state } from '../app.js';
import { $, formatDate, html, setHtml, timeAgo, toast, withLoading } from '../ui.js';

function jobResult(job) {
  if (job.running) return html`<span class="pill pill-accent">${t('виконується')}</span>`;
  if (job.lastError) return html`<span class="pill pill-danger">${t('помилка')}</span> <span class="hint">${job.lastError}</span>`;
  const r = job.lastResult;
  if (!r) return html`<span class="hint">—</span>`;
  if (job.name === 'prices') return t('перевірено {checked}, змінилось {changed}, сповіщень {alerts}', r);
  if (job.name === 'epic') return t('зараз {current}, скоро {upcoming}', r);
  if (job.name === 'rate') return t('1 USD = {rate} грн', r);
  if (job.name === 'cleanup') return t('видалено сесій: {removedSessions}', r);
  if (job.name === 'deals') return `Steam ${r.steam ?? 0}, GOG ${r.gog ?? 0}`;
  return '';
}

function eventsTable(events) {
  if (!events.length) return html`<div class="empty"><p>${t('Подій за цим фільтром немає.')}</p></div>`;
  return html`
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>${t('Час')}</th><th>${t('Подія')}</th><th>${t('Опис')}</th><th>${t('Користувач')}</th></tr></thead>
        <tbody>
          ${events.map(
            (e) => html`<tr>
              <td class="nowrap num" title="${formatDate(e.created_at, true)}">${new Date(e.created_at).toLocaleString(locale())}</td>
              <td class="nowrap"><span class="level level-${e.level}"></span>${e.type}</td>
              <td>${e.message}</td>
              <td class="nowrap">${e.email || '—'}</td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>
  `;
}

export async function render(root) {
  const [overview, { users }] = await Promise.all([get('/api/admin/overview'), get('/api/admin/users')]);
  const { stats, jobs, telegram, usdRate } = overview;

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>${t('Адмін-панель')}</h1>
          <p>${t('Доступна лише адміністраторам.')}</p>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><b>${stats.users}</b><span>${t('користувачів')}</span></div>
        <div class="stat"><b>${stats.watchItems}</b><span>${t('ігор відстежується')}</span></div>
        <div class="stat"><b>${stats.offers}</b><span>${t('цін у магазинах')}</span></div>
        <div class="stat"><b>${stats.notifications24h}</b><span>${t('сповіщень за добу')}</span></div>
        <div class="stat"><b>${stats.errors24h}</b><span>${t('помилок за добу')}</span></div>
      </div>

      <div class="section-title"><h2>${t('Задачі за розкладом')}</h2></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${t('Задача')}</th><th>${t('Як часто')}</th><th>${t('Останній запуск')}</th><th>${t('Наступний')}</th><th>${t('Результат')}</th><th></th></tr></thead>
          <tbody>
            ${jobs.map(
              (j) => html`<tr>
                <td class="nowrap"><b>${t(j.title)}</b></td>
                <td class="nowrap">${j.everyMinutes >= 60 ? t('кожні {n} год', { n: j.everyMinutes / 60 }) : t('кожні {n} хв', { n: j.everyMinutes })}</td>
                <td class="nowrap">${j.lastRun ? timeAgo(j.lastRun) : t('ще не запускалась')}</td>
                <td class="nowrap">${j.nextRun ? formatDate(j.nextRun, true) : t('під час найближчої перевірки')}</td>
                <td>${jobResult(j)}</td>
                <td><button class="btn btn-sm" type="button" data-job="${j.name}">${t('Запустити')}</button></td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px">
        ${t('Telegram-бот:')} ${telegram.enabled ? (telegram.username ? `@${telegram.username}` : t('не вдалося підключитися')) : t('вимкнено (немає токена)')}
        ${telegram.lastError ? ` · ${t('остання помилка:')} ${telegram.lastError}` : ''}
        · ${t('Курс: 1 USD = {rate} грн', { rate: usdRate.rate })} (${usdRate.source === 'nbu' ? `${t('НБУ')}${usdRate.date ? `, ${usdRate.date}` : ''}` : t('запасне значення')})
      </p>

      <div class="section-title"><h2>${t('Користувачі')}</h2><span class="count">${users.length}</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${t("Ім'я")}</th><th>${t('Пошта')}</th><th>${t('Роль')}</th><th>${t('Ігор')}</th><th>Telegram</th><th>${t('Зареєстровано')}</th><th>${t('Останній вхід')}</th></tr></thead>
          <tbody>
            ${users.map(
              (u) => html`<tr>
                <td>${u.name}</td>
                <td>${u.email}</td>
                <td>
                  <select class="select" data-user="${u.id}" aria-label="${t('Роль')} ${u.email}" ${u.id === state.user.id ? 'disabled' : ''}>
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>${t('Користувач')}</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>${t('Адміністратор')}</option>
                  </select>
                </td>
                <td class="num">${u.watch_count}</td>
                <td>${u.telegram ? t('так') : '—'}</td>
                <td class="nowrap">${formatDate(u.created_at)}</td>
                <td class="nowrap">${u.last_login_at ? timeAgo(u.last_login_at) : '—'}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>

      <div class="section-title"><h2>${t('Листи')}</h2></div>
      <div id="outbox"></div>

      <div class="section-title"><h2>${t('Журнал подій')}</h2></div>
      <form class="row" id="events-filter" style="margin-bottom:12px">
        <select class="select" name="level" aria-label="${t('Рівень')}" style="width:auto">
          <option value="">${t('Усі рівні')}</option>
          <option value="info">${t('Інформація')}</option>
          <option value="warn">${t('Попередження')}</option>
          <option value="error">${t('Помилки')}</option>
        </select>
        <input class="input" name="type" placeholder="${t('Тип події, напр. auth')}" aria-label="${t('Тип події')}" style="width:auto;flex:1;min-width:160px" />
        <button class="btn" type="submit">${t('Показати')}</button>
      </form>
      <div id="events"></div>
    `
  );

  // Листи: поки не налаштовано поштовий сервіс, вони лежать тут, і з них можна перейти за посиланням
  const KIND = { verify: 'Підтвердження пошти', reset: 'Відновлення пароля', deal: 'Знижка', free: 'Безкоштовно', epic: 'Роздача Epic', security: 'Безпека' };
  const loadOutbox = async () => {
    const { provider, items } = await get('/api/admin/outbox');
    setHtml(
      $('#outbox', root),
      html`
        <p class="hint">${provider === 'outbox'
          ? t('Поштовий сервіс не налаштовано (BREVO_API_KEY або RESEND_API_KEY у .env), тому листи не надсилаються, а складаються сюди — це тестова скринька.')
          : t('Листи надсилаються через {provider}. Нижче — листи, збережені до налаштування сервісу.', { provider: provider === 'brevo' ? 'Brevo' : 'Resend' })}</p>
        ${items.length
          ? html`<div class="outbox">${items.map(
              (m) => html`<details class="outbox-item">
                <summary>
                  <span class="pill">${t(KIND[m.kind] || m.kind || 'Лист')}</span>
                  <b>${m.subject}</b>
                  <span class="muted">→ ${m.to} · ${timeAgo(m.createdAt)}</span>
                </summary>
                <div class="row">${m.links.map((l) => html`<a class="btn btn-sm" href="${l}" target="_blank" rel="noopener">${l.includes('#/verify') ? t('Підтвердити пошту') : l.includes('#/reset') ? t('Змінити пароль') : t('Відкрити посилання')}</a>`)}</div>
                <iframe class="outbox-preview" sandbox srcdoc="${m.html}" title="${t('Лист')}: ${m.subject}"></iframe>
              </details>`
            )}</div>`
          : html`<p class="muted">${t('Листів поки немає.')}</p>`}
      `
    );
  };
  loadOutbox().catch(() => setHtml($('#outbox', root), html`<p class="muted">${t('Не вдалося завантажити листи.')}</p>`));

  const loadEvents = async () => {
    const f = $('#events-filter', root);
    const p = new URLSearchParams({ limit: '150' });
    if (f.elements.level.value) p.set('level', f.elements.level.value);
    if (f.elements.type.value.trim()) p.set('type', f.elements.type.value.trim());
    const { events } = await get(`/api/admin/events?${p}`);
    setHtml($('#events', root), eventsTable(events));
  };

  $('#events-filter', root).addEventListener('submit', (e) => {
    e.preventDefault();
    loadEvents().catch((err) => toast(err.message, 'error'));
  });

  root.querySelectorAll('[data-job]').forEach((btn) =>
    btn.addEventListener('click', () =>
      withLoading(btn, async () => {
        try {
          await post(`/api/admin/jobs/${btn.dataset.job}/run`);
          toast(t('Задачу виконано'));
          render(root);
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    )
  );

  root.querySelectorAll('[data-user]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await patch(`/api/admin/users/${sel.dataset.user}`, { role: sel.value });
        toast(t('Роль змінено'));
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );

  await loadEvents();
}
