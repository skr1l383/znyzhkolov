// Адмін-панель: статистика, задачі за розкладом, користувачі та журнал подій.
import { get, patch, post } from '../api.js';
import { state } from '../app.js';
import { $, formatDate, html, setHtml, timeAgo, toast, withLoading } from '../ui.js';

function jobResult(job) {
  if (job.running) return html`<span class="pill pill-accent">виконується</span>`;
  if (job.lastError) return html`<span class="pill pill-danger">помилка</span> <span class="hint">${job.lastError}</span>`;
  const r = job.lastResult;
  if (!r) return html`<span class="hint">—</span>`;
  if (job.name === 'prices') return `перевірено ${r.checked}, змінилось ${r.changed}, сповіщень ${r.alerts}`;
  if (job.name === 'epic') return `зараз ${r.current}, скоро ${r.upcoming}`;
  if (job.name === 'rate') return `1 USD = ${r.rate} грн`;
  if (job.name === 'cleanup') return `видалено сесій: ${r.removedSessions}`;
  return '';
}

function eventsTable(events) {
  if (!events.length) return html`<div class="empty"><p>Подій за цим фільтром немає.</p></div>`;
  return html`
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Час</th><th>Подія</th><th>Опис</th><th>Користувач</th></tr></thead>
        <tbody>
          ${events.map(
            (e) => html`<tr>
              <td class="nowrap num" title="${formatDate(e.created_at, true)}">${new Date(e.created_at).toLocaleString('uk-UA')}</td>
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
          <h1>Адмін-панель</h1>
          <p>Доступна лише адміністраторам.</p>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><b>${stats.users}</b><span>користувачів</span></div>
        <div class="stat"><b>${stats.watchItems}</b><span>ігор відстежується</span></div>
        <div class="stat"><b>${stats.offers}</b><span>цін у магазинах</span></div>
        <div class="stat"><b>${stats.notifications24h}</b><span>сповіщень за добу</span></div>
        <div class="stat"><b>${stats.errors24h}</b><span>помилок за добу</span></div>
      </div>

      <div class="section-title"><h2>Задачі за розкладом</h2></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Задача</th><th>Як часто</th><th>Останній запуск</th><th>Наступний</th><th>Результат</th><th></th></tr></thead>
          <tbody>
            ${jobs.map(
              (j) => html`<tr>
                <td class="nowrap"><b>${j.title}</b></td>
                <td class="nowrap">кожні ${j.everyMinutes >= 60 ? `${j.everyMinutes / 60} год` : `${j.everyMinutes} хв`}</td>
                <td class="nowrap">${j.lastRun ? timeAgo(j.lastRun) : 'ще не запускалась'}</td>
                <td class="nowrap">${j.nextRun ? formatDate(j.nextRun, true) : 'під час найближчої перевірки'}</td>
                <td>${jobResult(j)}</td>
                <td><button class="btn btn-sm" type="button" data-job="${j.name}">Запустити</button></td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px">
        Telegram-бот: ${telegram.enabled ? (telegram.username ? `@${telegram.username}` : 'не вдалося підключитися') : 'вимкнено (немає токена)'}
        ${telegram.lastError ? ` · остання помилка: ${telegram.lastError}` : ''}
        · Курс: 1 USD = ${usdRate.rate} грн (${usdRate.source === 'nbu' ? `НБУ${usdRate.date ? `, ${usdRate.date}` : ''}` : 'запасне значення'})
      </p>

      <div class="section-title"><h2>Користувачі</h2><span class="count">${users.length}</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Ім'я</th><th>Пошта</th><th>Роль</th><th>Ігор</th><th>Telegram</th><th>Зареєстровано</th><th>Останній вхід</th></tr></thead>
          <tbody>
            ${users.map(
              (u) => html`<tr>
                <td>${u.name}</td>
                <td>${u.email}</td>
                <td>
                  <select class="select" data-user="${u.id}" aria-label="Роль ${u.email}" ${u.id === state.user.id ? 'disabled' : ''}>
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>Користувач</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Адміністратор</option>
                  </select>
                </td>
                <td class="num">${u.watch_count}</td>
                <td>${u.telegram ? 'так' : '—'}</td>
                <td class="nowrap">${formatDate(u.created_at)}</td>
                <td class="nowrap">${u.last_login_at ? timeAgo(u.last_login_at) : '—'}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>

      <div class="section-title"><h2>Журнал подій</h2></div>
      <form class="row" id="events-filter" style="margin-bottom:12px">
        <select class="select" name="level" aria-label="Рівень" style="width:auto">
          <option value="">Усі рівні</option>
          <option value="info">Інформація</option>
          <option value="warn">Попередження</option>
          <option value="error">Помилки</option>
        </select>
        <input class="input" name="type" placeholder="Тип події, напр. auth" aria-label="Тип події" style="width:auto;flex:1;min-width:160px" />
        <button class="btn" type="submit">Показати</button>
      </form>
      <div id="events"></div>
    `
  );

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
          toast('Задачу виконано');
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
        toast('Роль змінено');
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );

  await loadEvents();
}
