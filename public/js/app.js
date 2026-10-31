// Головний модуль інтерфейсу: стан користувача, навігація між сторінками, тема.
import { syncAdvisor } from './advisor.js';
import { get, patch, post } from './api.js';
import { setPageBackdrop } from './backdrop.js';
import { LANGS, getLang, setLang, t, translateStatic } from './i18n.js';
import { $, $$, avatar, closeDialog, html, initials, openDialog, setHtml, toast } from './ui.js';
import * as admin from './views/admin.js';
import * as auth from './views/auth.js';
import * as epic from './views/epic.js';
import * as game from './views/game.js';
import * as notifications from './views/notifications.js';
import * as privacy from './views/privacy.js';
import * as profile from './views/profile.js';
import * as search from './views/search.js';
import * as share from './views/share.js';
import * as showcase from './views/showcase.js';
import * as watchlist from './views/watchlist.js';

export const state = {
  user: null,
  app: { demo: false, telegram: { enabled: false, username: null } },
};

const routes = {
  login: { view: auth.renderLogin, public: true, title: 'Вхід' },
  register: { view: auth.renderRegister, public: true, title: 'Реєстрація' },
  forgot: { view: auth.renderForgot, public: true, title: 'Відновлення пароля' },
  reset: { view: auth.renderReset, open: true, title: 'Новий пароль' },
  verify: { view: auth.renderVerify, open: true, title: 'Підтвердження пошти' },
  'check-email': { view: auth.renderCheckEmail, open: true, title: 'Перевір пошту' },
  privacy: { view: privacy.render, open: true, title: 'Конфіденційність' },
  // open — сторінка доступна і гостям, і тим, хто увійшов
  '': { view: showcase.render, nav: 'showcase', title: 'Знижки зараз', open: true },
  list: { view: watchlist.render, nav: 'watch', title: 'Мій список' },
  game: { view: game.render, nav: 'showcase', title: 'Гра', open: true },
  shared: { view: share.render, nav: 'watch', title: 'Список друга', open: true },
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
  if (!route.public && !route.open && !state.user) return go('#/login');
  if (route.public && state.user) return go('#/');
  if (route.admin && state.user.role !== 'admin') return go('#/');

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  closeDialog();
  renderChrome(route.nav);
  document.title = `${t(route.title)} · ${t('Знижколов')}`;

  // Вітрина і сторінка гри потім ставлять власний фон
  setPageBackdrop(name || 'home');
  const root = $('#view');
  if (lastRoute !== name) window.scrollTo(0, 0);
  lastRoute = name;
  try {
    cleanup = (await route.view(root, params)) || null;
  } catch (err) {
    setHtml(
      root,
      html`<div class="empty"><h2>${t('Не вдалося відкрити сторінку')}</h2><p>${t(err.message)}</p>
        <button class="btn" type="button" id="retry">${t('Спробувати ще раз')}</button></div>`
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
  $('#nav-guest').hidden = loggedIn;
  document.body.classList.toggle('has-nav', loggedIn);
  $('#nav-profile').hidden = !loggedIn;
  $('#nav-admin').hidden = state.user?.role !== 'admin';
  $('#demo-banner').hidden = !state.app.demo;
  syncAdvisor(); // кнопка ШІ-порадника в кутку
  // Нагадування про непідтверджену пошту (можна сховати до кінця сеансу)
  let hidden = false;
  try {
    hidden = sessionStorage.getItem('zk-verify-hidden') === '1';
  } catch {
    // без sessionStorage просто показуємо
  }
  $('#verify-banner').hidden = !loggedIn || state.user.emailVerified || hidden;
  if (loggedIn) $('#verify-email').textContent = state.user.email;
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
  clearPrivateCache();
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
    // Спершу пробуємо запасну картинку, якщо вона є
    if (img.dataset.fallback) {
      img.src = img.dataset.fallback;
      delete img.dataset.fallback;
      return;
    }
    const box = document.createElement('div');
    box.className = `${img.className} cover-placeholder`;
    box.setAttribute('aria-hidden', 'true');
    box.textContent = initials(img.closest('[data-title]')?.dataset.title || img.dataset.title || '');
    img.replaceWith(box);
  },
  true
);

// ---------- Мова інтерфейсу ----------
function updateLangButton() {
  const btn = $('#lang-toggle');
  const other = getLang() === 'uk' ? 'en' : 'uk';
  btn.textContent = LANGS[other].short;
  // Назва кнопки для читачів екрана починається з видимого напису (EN), як радить WCAG
  btn.setAttribute('aria-label', `${LANGS[other].short} — ${other === 'en' ? 'Switch to English' : 'Перемкнути на українську'}`);
  btn.title = btn.getAttribute('aria-label');
}

/** Перемикає мову: зберігає вибір (і в профілі, якщо увійшли) та перемальовує сторінку. */
export async function switchLang(next) {
  setLang(next);
  translateStatic();
  updateLangButton();
  if (state.user) {
    state.user.lang = next;
    patch('/api/me', { lang: next }).catch(() => {}); // на інших пристроях — та сама мова
  }
  renderChrome();
  await navigate();
}

function setupLang() {
  translateStatic();
  updateLangButton();
  $('#lang-toggle').addEventListener('click', () => switchLang(getLang() === 'uk' ? 'en' : 'uk'));
}

// ---------- Застосунок (PWA) ----------
/** Дані акаунта, збережені для офлайну, прибираємо при виході — щоб їх не побачив наступний користувач пристрою. */
export async function clearPrivateCache() {
  try {
    await caches.delete('zk-api');
  } catch {
    // Cache API недоступний (наприклад, сайт відкрито не через https) — нічого прибирати
  }
}

/**
 * Пошту підтверджують в іншій вкладці (з листа), тож ця вкладка про це не знає.
 * Дізнаємось двома шляхами: повідомлення від іншої вкладки (BroadcastChannel)
 * і тиха перевірка /api/me, коли користувач повертається на вкладку або раз на 15 с, поки вона відкрита.
 */
function watchVerification() {
  let busy = false;
  const check = async () => {
    if (busy || !state.user || state.user.emailVerified || document.hidden) return;
    busy = true;
    try {
      const { user } = await get('/api/me');
      if (user?.emailVerified) {
        state.user = user;
        renderChrome();
        toast(t('Пошту підтверджено ✓'));
        window.dispatchEvent(new CustomEvent('zk:verified'));
      }
    } catch {
      // немає зв'язку — перевіримо наступного разу
    } finally {
      busy = false;
    }
  };
  try {
    new BroadcastChannel('zk-account').addEventListener('message', (e) => e.data === 'verified' && check());
  } catch {
    // без BroadcastChannel лишаються перевірки нижче
  }
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  setInterval(check, 15000);
}

function setupVerifyBanner() {
  $('#verify-resend').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await post('/api/auth/verify/resend');
      toast(state.app.mail === 'outbox' ? t('Лист у тестовій скриньці (адмін-панель)') : t('Лист надіслано — перевір пошту і папку «Спам»'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTimeout(() => (btn.disabled = false), 3000);
    }
  });
  $('#verify-hide').addEventListener('click', () => {
    $('#verify-banner').hidden = true;
    try {
      sessionStorage.setItem('zk-verify-hidden', '1');
    } catch {
      // нагадування знову з'явиться після перезавантаження — не страшно
    }
  });
}

/** Інструкція для iPhone: «Поділитися» → «На початковий екран» → «Додати». */
function iosInstallDialog() {
  const share = html`<svg class="ios-share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5v10h14V11h-1" /></svg>`;
  const dialog = openDialog(html`
    <div class="dialog-body ios-install">
      <div class="dialog-head">
        <img class="ios-install-icon" src="/img/icon-192.png" alt="" width="56" height="56" />
        <div><p class="muted">${t('Встановити на iPhone')}</p><h2>${t('Знижколов на головному екрані')}</h2></div>
      </div>
      <ol class="epic-steps">
        <li><b>${t('Натисни «Поділитися»')} ${share}</b><span>${t('Кнопка зі стрілкою вгору — внизу екрана в Safari.')}</span></li>
        <li><b>${t('Вибери «На початковий екран»')}</b><span>${t('Якщо не видно — прогорни список дій нижче.')}</span></li>
        <li><b>${t('Натисни «Додати»')}</b><span>${t('Знижколов з’явиться серед застосунків і відкриватиметься на весь екран.')}</span></li>
      </ol>
      <p class="hint">${t('Якщо кнопки «Поділитися» немає, відкрий сайт у Safari.')}</p>
      <div class="dialog-foot"><button class="btn btn-primary" type="button" data-close>${t('Зрозуміло')}</button></div>
    </div>
  `);
  $('[data-close]', dialog).addEventListener('click', closeDialog);
}

function setupPwa() {
  // Service worker працює лише на https або localhost
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // Нова версія service worker повідомляє, що активувалася, — перезавантажуємо сторінку один раз,
    // щоб вона одразу працювала з новою версією (інакше знадобилося б оновити вручну двічі).
    // Повідомлення браузер притримує, доки сторінка не підпишеться, тож воно не загубиться.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type !== 'sw-activated' || !hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Кнопка «Встановити»: браузер сам повідомляє, що сайт можна встановити як застосунок
  let installPrompt = null;
  const installBtn = $('#install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
  });
  // iPhone і iPad не повідомляють, що сайт можна встановити, і не дають викликати встановлення з кнопки.
  // Тож там кнопка показує, як додати Знижколов на головний екран через «Поділитися».
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (isIos && !standalone) installBtn.hidden = false;
  installBtn.addEventListener('click', async () => {
    if (isIos && !installPrompt) return iosInstallDialog();
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
  });

  // Смужка «немає зв'язку»: зникає, щойно сервер знову відповідає
  const banner = $('#offline-banner');
  const setOffline = (offline) => {
    if (banner.hidden === !offline) return;
    banner.hidden = !offline;
    // Повернувся зв'язок — перемальовуємо сторінку зі свіжими даними
    if (!offline && state.user) navigate();
  };
  window.addEventListener('zk:offline', () => setOffline(true));
  window.addEventListener('zk:online', () => setOffline(false));
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => refreshMe().catch(() => {}));
}

async function start() {
  applyThemeColor();
  setupLang();
  setupPwa();
  setupVerifyBanner();
  watchVerification();
  try {
    await refreshMe();
  } catch (err) {
    setHtml(
      $('#view'),
      html`<div class="empty"><h2>${t('Сервер не відповідає')}</h2><p>${t(err.message)}</p>
        <button class="btn btn-primary" type="button" id="reload-page">${t('Оновити сторінку')}</button></div>`
    );
    $('#reload-page').addEventListener('click', () => location.reload());
    return;
  }
  // Мова з профілю — якщо на цьому пристрої її ще не вибирали
  let savedHere = false;
  try {
    savedHere = Boolean(localStorage.getItem('zk-lang'));
  } catch {
    // без localStorage — беремо з профілю
  }
  if (!savedHere && state.user?.lang && state.user.lang !== getLang()) {
    setLang(state.user.lang);
    translateStatic();
    updateLangButton();
  }
  await navigate();
  pollUnread();
  setInterval(pollUnread, 60000);
}

start();
