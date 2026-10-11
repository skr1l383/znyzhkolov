// Головний модуль інтерфейсу: стан користувача, навігація між сторінками, тема.
import { get } from './api.js';
import { $, $$, avatar, closeDialog, html, initials, setHtml } from './ui.js';
import * as admin from './views/admin.js';
import * as auth from './views/auth.js';
import * as epic from './views/epic.js';
import * as notifications from './views/notifications.js';
import * as profile from './views/profile.js';
import * as search from './views/search.js';
import * as watchlist from './views/watchlist.js';

export const state = {
  user: null,
  app: { demo: false, telegram: { enabled: false, username: null } },
};

const routes = {
  login: { view: auth.renderLogin, public: true, title: 'Вхід' },
  register: { view: auth.renderRegister, public: true, title: 'Реєстрація' },
  '': { view: watchlist.render, nav: 'watch', title: 'Мій список' },
  search: { view: search.render, nav: 'search', title: 'Знайти гру' },
  epic: { view: epic.render, nav: 'epic', title: 'Роздачі Epic' },
  notifications: { view: notifications.render, nav: 'notifications', title: 'Сповіщення' },
  profile: { view: profile.render, nav: 'profile', title: 'Профіль' },
  admin: { view: admin.render, nav: 'admin', title: 'Адмін-панель', admin: true },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { name: path.split('/')[0] || '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let cleanup = null;
let lastRoute = null;

async function navigate() {
  const { name, params } = parseHash();
  const route = routes[name];
  if (!route) return go('#/');
  if (!route.public && !state.user) return go('#/login');
  if (route.public && state.user) return go('#/');
  if (route.admin && state.user.role !== 'admin') return go('#/');

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  closeDialog();
  renderChrome(route.nav);
  document.title = `${route.title} · Знижколов`;

  const root = $('#view');
  if (lastRoute !== name) window.scrollTo(0, 0);
  lastRoute = name;
  try {
    cleanup = (await route.view(root, params)) || null;
  } catch (err) {
    setHtml(
      root,
      html`<div class="empty"><h2>Не вдалося відкрити сторінку</h2><p>${err.message}</p>
        <button class="btn" type="button" id="retry">Спробувати ще раз</button></div>`
    );
    $('#retry', root)?.addEventListener('click', navigate);
  }
}

export function go(hash) {
  if (location.hash === hash) navigate();
  else location.hash = hash;
}

/** Перемальовує сторінку, на якій користувач зараз перебуває. */
export const reload = () => navigate();

export async function refreshMe() {
  const data = await get('/api/me');
  state.user = data.user;
  state.app = data.app;
  renderChrome();
}

function renderChrome(activeNav) {
  const loggedIn = Boolean(state.user);
  $('#nav').hidden = !loggedIn;
  document.body.classList.toggle('has-nav', loggedIn);
  $('#nav-profile').hidden = !loggedIn;
  $('#nav-admin').hidden = state.user?.role !== 'admin';
  $('#demo-banner').hidden = !state.app.demo;
  if (loggedIn) setHtml($('#nav-profile'), avatar(state.user));
  if (activeNav !== undefined) {
    $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === activeNav));
  }
}

export function setUnread(n) {
  const badge = $('#unread-count');
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
}

async function pollUnread() {
  if (!state.user) return;
  try {
    const { unread } = await get('/api/notifications?limit=1');
    setUnread(unread);
  } catch {
    // тимчасова помилка — спробуємо наступного разу
  }
}

// ---------- Тема ----------
function effectiveTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = effectiveTheme() === 'dark' ? '#0c111d' : '#f2f4f8';
}

$('#theme-toggle').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('zk-theme', next);
  } catch {
    // без збереження теми
  }
  applyThemeColor();
});

// ---------- Запуск ----------
window.addEventListener('zk:unauthorized', () => {
  if (!state.user) return;
  state.user = null;
  renderChrome();
  go('#/login');
});

window.addEventListener('hashchange', navigate);

// Файл, кинутий повз зону завантаження, браузер відкрив би замість сайту — не дозволяємо
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => {
    if (e.dataTransfer?.types.includes('Files') && !e.target.closest?.('.dropzone')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
    }
  });
}

// Якщо обкладинка гри не завантажилась (немає інтернету, картинку прибрали),
// показуємо заглушку з літерами назви замість «битої» картинки
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover')) return;
    const box = document.createElement('div');
    box.className = `${img.className} cover-placeholder`;
    box.setAttribute('aria-hidden', 'true');
    box.textContent = initials(img.closest('[data-title]')?.dataset.title || img.dataset.title || '');
    img.replaceWith(box);
  },
  true
);

async function start() {
  applyThemeColor();
  try {
    await refreshMe();
  } catch (err) {
    setHtml(
      $('#view'),
      html`<div class="empty"><h2>Сервер не відповідає</h2><p>${err.message}</p>
        <button class="btn btn-primary" type="button" id="reload-page">Оновити сторінку</button></div>`
    );
    $('#reload-page').addEventListener('click', () => location.reload());
    return;
  }
  await navigate();
  pollUnread();
  setInterval(pollUnread, 60000);
}

start();
