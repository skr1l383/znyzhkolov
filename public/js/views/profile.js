// Профіль: шапка з фото й підсумком списку та вкладки «Профіль», «Сповіщення», «Безпека», «Мої дані».
import { del, get, patch, post, upload } from '../api.js';
import { getLang, LANGS, t, tp } from '../i18n.js';
import { clearPrivateCache, go, iosInstallDialog, refreshMe, reload, state, switchLang } from '../app.js';
import { disablePush, enablePush, pushState, testPush } from '../push.js';
import { bindAccount, dataPanels, securityPanels } from './account.js';
import { $, avatar, bindDropZone, clearFormErrors, formatDate, formatSize, formatUah, html, setHtml, showFormError, toast, withLoading } from '../ui.js';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // те саме обмеження, що й на сервері

const svg = (path) => html`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const ICONS = {
  user: svg(html`<circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />`),
  bell: svg(html`<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" />`),
  lock: svg(html`<rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />`),
  data: svg(html`<ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />`),
  camera: svg(html`<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" /><circle cx="12" cy="12.5" r="3.5" />`),
  telegram: svg(html`<path d="m21 4-3 16-6.5-5.5L18 8l-8.5 5.5L3 11.5Z" />`),
  mail: svg(html`<rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m4 7 8 6 8-6" />`),
  gift: svg(html`<rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M3 9h18M12 9v11M12 9c-1.5-3-5-4-5-1.5S10 9 12 9Zm0 0c1.5-3 5-4 5-1.5S14 9 12 9Z" />`),
  tag: svg(html`<path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9Z" /><circle cx="7.5" cy="7.5" r="1.5" />`),
  phone: svg(html`<rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /><circle cx="17.5" cy="6" r="3" class="ico-dot" />`),
  logout: svg(html`<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10" />`),
};

const TABS = [
  ['main', 'Профіль', ICONS.user],
  ['alerts', 'Сповіщення', ICONS.bell],
  ['security', 'Безпека', ICONS.lock],
  ['data', 'Мої дані', ICONS.data],
];

// ---------- Шапка ----------

function hero(u) {
  return html`
    <section class="profile-hero" id="profile-hero">
      <div class="profile-cover" id="profile-cover" aria-hidden="true"></div>
      <div class="profile-id">
        <label class="profile-avatar" title="${t('Змінити фото')}">
          <input class="visually-hidden" type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp" aria-label="${t('Змінити фото')}" />
          <span class="profile-avatar-img">${avatar(u)}</span>
          <span class="profile-avatar-badge">${ICONS.camera}</span>
        </label>
        <div class="profile-who">
          <div class="profile-name">
            <h1>${u.name}</h1>
            ${u.role === 'admin' ? html`<span class="pill pill-accent">${t('Адміністратор')}</span>` : ''}
          </div>
          <p class="profile-email">
            <span>${u.email}</span>
            ${u.emailVerified
              ? html`<span class="pill pill-good">${t('підтверджено')}</span>`
              : html`<span class="pill pill-warn">${t('не підтверджено')}</span>`}
          </p>
          <p class="muted">${t('З нами з {date}', { date: formatDate(u.createdAt) })}</p>
        </div>
        <button class="btn profile-logout" type="button" id="logout">${ICONS.logout}<span>${t('Вийти')}</span></button>
      </div>
      <span class="dropzone-error profile-drop-error" role="alert" hidden></span>
      <div class="profile-drop-hint" aria-hidden="true">${t('Відпусти, щоб зробити це фото профілю')}</div>
      <div class="profile-stats" id="profile-stats">
        ${[1, 2, 3, 4].map(() => html`<div class="profile-stat skeleton"></div>`)}
      </div>
    </section>
  `;
}

function stats(s) {
  return html`
    <a class="profile-stat" href="#/list">
      <b>${s.games}</b><span>${t('{games} у списку', { games: tp(s.games, 'гра', 'гри', 'ігор') })}</span>
    </a>
    <a class="profile-stat ${s.met ? 'is-good' : ''}" href="#/list">
      <b>${s.met}</b><span>${tp(s.met, 'умова виконана', 'умови виконано', 'умов виконано')}</span>
    </a>
    <a class="profile-stat" href="#/notifications">
      <b>${s.alerts}</b><span>${tp(s.alerts, 'сповіщення', 'сповіщення', 'сповіщень')}${s.unread ? html` · <em>${t('нових: {n}', { n: s.unread })}</em>` : ''}</span>
    </a>
    <div class="profile-stat ${s.savingsUah > 0 ? 'is-accent' : ''}">
      <b>${formatUah(s.savingsUah)}</b><span>${t('можна заощадити зараз')}</span>
    </div>
  `;
}

/** Фон шапки — обкладинки ігор зі списку; якщо список порожній, лишається кольоровий градієнт. */
function cover(urls) {
  if (!urls.length) return '';
  return html`<div class="profile-covers" style="--n: ${urls.length}">${urls.map((src) => html`<img src="${src}" alt="" loading="lazy" />`)}</div>`;
}

// ---------- Вкладка «Профіль» ----------

function mainTab(u) {
  return html`
    <form class="panel stack" id="profile-form" novalidate>
      <div class="panel-head">
        <h2>${t('Особисті дані')}</h2>
        <p class="hint">${t('Ім’я бачать друзі, яким ти надішлеш посилання на свій список.')}</p>
      </div>
      <div class="form-error" role="alert" hidden></div>
      <div class="field-grid">
        <div class="field">
          <label for="p-name">${t("Ім'я")}</label>
          <input class="input" id="p-name" name="name" value="${u.name}" maxlength="40" autocomplete="nickname" required />
        </div>
        <div class="field">
          <label for="p-email-view">${t('Електронна пошта')}</label>
          <div class="input-with-action">
            <input class="input" id="p-email-view" value="${u.email}" disabled />
            <button class="btn btn-sm btn-ghost" type="button" data-goto="security">${t('Змінити')}</button>
          </div>
        </div>
      </div>
      <div><button class="btn btn-primary" type="submit">${t('Зберегти')}</button></div>
    </form>

    <section class="panel stack">
      <div class="panel-head">
        <h2>${t('Фото профілю')}</h2>
        <p class="hint">
          ${t('Натисни на фото в шапці профілю або перетягни на шапку картинку. PNG, JPG або WEBP, до {size}.', { size: formatSize(AVATAR_MAX_BYTES) })}
        </p>
      </div>
      <div class="row">
        <label class="btn" for="avatar-input">${ICONS.camera}<span>${u.avatarUrl ? t('Замінити фото') : t('Завантажити фото')}</span></label>
        ${u.avatarUrl ? html`<button class="btn btn-ghost btn-danger" type="button" id="avatar-remove">${t('Видалити фото')}</button>` : ''}
      </div>
    </section>

    <section class="panel stack">
      <div class="panel-head">
        <h2>${t('Мова інтерфейсу')}</h2>
        <p class="hint">${t('Запам’ятовується в профілі — на інших пристроях сайт відкриється цією ж мовою.')}</p>
      </div>
      <div class="segmented" role="group" aria-label="${t('Мова інтерфейсу')}">
        ${Object.entries(LANGS).map(([code, l]) => html`<button type="button" data-lang="${code}" aria-pressed="${String(getLang() === code)}">${l.name}</button>`)}
      </div>
    </section>
  `;
}

// ---------- Вкладка «Сповіщення» ----------

function telegramChannel() {
  const tg = state.app.telegram;
  const u = state.user;
  let status;
  let actions = '';
  if (!tg.enabled) {
    status = html`<span class="pill">${t('бот не налаштований')}</span>`;
  } else if (u.telegramLinked) {
    status = html`<span class="pill pill-good">${t('Підключено')}${u.telegramUsername ? ` · @${u.telegramUsername}` : ''}</span>`;
    actions = html`
      <button class="btn btn-sm" type="button" id="tg-test">${t('Тестове повідомлення')}</button>
      <button class="btn btn-sm btn-ghost btn-danger" type="button" id="tg-unlink">${t('Відключити')}</button>`;
  } else {
    status = html`<span class="pill">${t('не підключено')}</span>`;
    actions = html`<button class="btn btn-sm btn-primary" type="button" id="tg-link">${t('Підключити')}</button>`;
  }
  return html`
    <div class="channel">
      <span class="channel-icon is-telegram">${ICONS.telegram}</span>
      <div class="channel-text">
        <div class="channel-title"><b>Telegram</b>${status}</div>
        <p class="hint">
          ${!tg.enabled
            ? t('Адміністратору потрібно створити бота через @BotFather і вписати токен у файл .env (TELEGRAM_BOT_TOKEN). Покрокова інструкція є в README.')
            : u.telegramLinked
              ? t('Сповіщення приходять миттєво. У боті працюють команди /list і /free.')
              : t('Миттєві сповіщення на телефон — найзручніший спосіб.')}
        </p>
        <div id="tg-link-box" class="stack"></div>
      </div>
      <div class="channel-actions">${actions}</div>
    </div>
  `;
}

/** Рядок «Пуш на цьому пристрої»: стан залежить від браузера, тож заповнюється після показу сторінки. */
async function mountPushChannel(root) {
  const box = $('#push-channel', root);
  if (!box) return;
  const st = await pushState();
  const PILLS = {
    on: html`<span class="pill pill-good">${t('Увімкнено')}</span>`,
    off: html`<span class="pill">${t('вимкнено')}</span>`,
    denied: html`<span class="pill">${t('заборонено в браузері')}</span>`,
    'ios-install': html`<span class="pill">${t('потрібне встановлення')}</span>`,
    unsupported: html`<span class="pill">${t('не підтримується')}</span>`,
  };
  const HINTS = {
    on: t('Сповіщення з’являтимуться на цьому пристрої, навіть коли сайт закрито.'),
    off: t('Сповіщення як від звичайного застосунку — навіть коли сайт закрито.'),
    denied: t('Сповіщення для цього сайту заблоковані в налаштуваннях браузера. Дозволь їх там (значок біля адреси сайту) і онови сторінку.'),
    'ios-install': t('На iPhone пуш-сповіщення працюють, коли Знижколов додано на головний екран (iOS 16.4 і новіші).'),
    unsupported: t('Цей браузер не вміє пуш-сповіщення. Спробуй Chrome, Edge, Firefox або Safari.'),
  };
  const ACTIONS = {
    on: html`<button class="btn btn-sm" type="button" data-push="test">${t('Тестове сповіщення')}</button>
      <button class="btn btn-sm btn-ghost btn-danger" type="button" data-push="off">${t('Вимкнути')}</button>`,
    off: html`<button class="btn btn-sm btn-primary" type="button" data-push="on">${t('Увімкнути')}</button>`,
    'ios-install': html`<button class="btn btn-sm" type="button" data-push="install">${t('Як встановити')}</button>`,
  };
  setHtml($('#push-status', box), PILLS[st]);
  $('#push-hint', box).textContent = HINTS[st];
  setHtml($('#push-actions', box), ACTIONS[st] || '');

  box.onclick = (e) => {
    const btn = e.target.closest('[data-push]');
    if (!btn) return;
    const action = btn.dataset.push;
    if (action === 'install') return iosInstallDialog();
    withLoading(btn, async () => {
      try {
        if (action === 'on') {
          await enablePush();
          toast(t('Пуш-сповіщення увімкнено на цьому пристрої'));
        } else if (action === 'off') {
          await disablePush();
          toast(t('Пуш-сповіщення на цьому пристрої вимкнено'));
        } else {
          await testPush();
          toast(t('Сповіщення надіслано — зараз з’явиться'));
        }
      } catch (err) {
        toast(err.message, 'error');
      }
      mountPushChannel(root);
    });
  };
}

function alertsTab(u) {
  return html`
    <section class="panel stack">
      <div class="panel-head">
        <h2>${t('Куди надсилати')}</h2>
        <p class="hint">${t('Сповіщення про знижку приходить у всі підключені канали одразу.')}</p>
      </div>
      <div class="channels">
        <div class="channel">
          <span class="channel-icon">${ICONS.bell}</span>
          <div class="channel-text">
            <div class="channel-title"><b>${t('На сайті')}</b><span class="pill pill-good">${t('завжди')}</span></div>
            <p class="hint">${t('Розділ «Сповіщення» в меню, з лічильником нових.')}</p>
          </div>
        </div>
        ${telegramChannel()}
        <div class="channel" id="push-channel">
          <span class="channel-icon is-push">${ICONS.phone}</span>
          <div class="channel-text">
            <div class="channel-title"><b>${t('Пуш на цьому пристрої')}</b><span id="push-status"></span></div>
            <p class="hint" id="push-hint">${t('Сповіщення як від звичайного застосунку — навіть коли сайт закрито.')}</p>
          </div>
          <div class="channel-actions" id="push-actions"></div>
        </div>
        <div class="channel">
          <span class="channel-icon">${ICONS.mail}</span>
          <div class="channel-text">
            <div class="channel-title"><b>${t('Пошта')}</b></div>
            <p class="hint">
              ${u.emailVerified
                ? t('Листи приходять на {email}.', { email: u.email })
                : t('Щоб отримувати листи, підтверди пошту {email}.', { email: u.email })}
            </p>
            ${u.emailVerified ? '' : html`<div><button class="btn btn-sm" type="button" id="p-resend">${t('Надіслати лист ще раз')}</button></div>`}
          </div>
          <label class="switch" title="${t('Надсилати сповіщення про знижки й роздачі на пошту')}">
            <input type="checkbox" role="switch" id="p-notify-email" ${u.notifyEmail && u.emailVerified ? 'checked' : ''} ${u.emailVerified ? '' : 'disabled'}
              aria-label="${t('Надсилати сповіщення про знижки й роздачі на пошту')}" />
          </label>
        </div>
      </div>
    </section>

    <section class="panel stack">
      <div class="panel-head"><h2>${t('Про що повідомляти')}</h2></div>
      <div class="channels">
        <div class="channel">
          <span class="channel-icon">${ICONS.tag}</span>
          <div class="channel-text">
            <div class="channel-title"><b>${t('Знижки на ігри зі списку')}</b><span class="pill pill-good">${t('завжди')}</span></div>
            <p class="hint">${t('Коли виконується умова, яку ти задав для гри. Умови змінюються в розділі')} <a href="#/list">${t('Мій список')}</a>.</p>
          </div>
        </div>
        <div class="channel">
          <span class="channel-icon">${ICONS.gift}</span>
          <div class="channel-text">
            <div class="channel-title"><b>${t('Роздачі Epic Games')}</b></div>
            <p class="hint">${t('Щотижня Epic віддає ігри безкоштовно — повідомимо про кожну нову.')}</p>
          </div>
          <label class="switch">
            <input type="checkbox" role="switch" id="p-epic" ${u.notifyEpicFree ? 'checked' : ''} aria-label="${t('Повідомляти про нові безкоштовні роздачі Epic Games')}" />
          </label>
        </div>
        <div class="channel">
          <span class="channel-icon">${ICONS.mail}</span>
          <div class="channel-text">
            <div class="channel-title"><b>${t('Тижневий дайджест')}</b></div>
            <p class="hint">${t('Щонеділі зранку: що зі знижкою з твого списку і найкращі знижки тижня.')}</p>
          </div>
          <label class="switch">
            <input type="checkbox" role="switch" id="p-digest" ${u.notifyDigest ? 'checked' : ''} aria-label="${t('Надсилати тижневий дайджест')}" />
          </label>
        </div>
      </div>
    </section>
  `;
}

// ---------- Сторінка ----------

export async function render(root, params) {
  await refreshMe();
  const u = state.user;
  const first = TABS.some(([name]) => name === params.tab) ? params.tab : 'main';
  let poll = null;

  setHtml(
    root,
    html`
      ${hero(u)}
      <div class="profile-layout">
        <nav class="profile-tabs" role="tablist" aria-label="${t('Розділи профілю')}">
          ${TABS.map(
            ([name, label, icon]) => html`<button type="button" role="tab" id="tab-${name}" data-tab="${name}" aria-controls="panel-${name}"
              aria-selected="${String(name === first)}" tabindex="${name === first ? '0' : '-1'}">${icon}<span>${t(label)}</span></button>`
          )}
        </nav>
        <div class="profile-panels">
          <div class="profile-panel" role="tabpanel" id="panel-main" data-panel="main" aria-labelledby="tab-main">${mainTab(u)}</div>
          <div class="profile-panel" role="tabpanel" id="panel-alerts" data-panel="alerts" aria-labelledby="tab-alerts">${alertsTab(u)}</div>
          <div class="profile-panel profile-panel-pair" role="tabpanel" id="panel-security" data-panel="security" aria-labelledby="tab-security">${securityPanels(u)}</div>
          <div class="profile-panel" role="tabpanel" id="panel-data" data-panel="data" aria-labelledby="tab-data">${dataPanels()}</div>
        </div>
      </div>
    `
  );

  // ---- Вкладки: адреса запам'ятовує відкриту, стрілки на клавіатурі перемикають ----
  const tabs = [...root.querySelectorAll('[data-tab]')];
  const selectTab = (name, focus = false) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    root.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
    history.replaceState(null, '', name === 'main' ? '#/profile' : `#/profile?tab=${name}`);
  };
  selectTab(first);
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      selectTab(tabs[(i + step + tabs.length) % tabs.length].dataset.tab, true);
    });
  });
  root.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      selectTab(b.dataset.goto);
      $('#email-card', root)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#em-new', root)?.focus({ preventScroll: true });
    })
  );

  // ---- Підсумок у шапці ----
  get('/api/me/summary')
    .then((s) => {
      setHtml($('#profile-stats', root), stats(s));
      setHtml($('#profile-cover', root), cover(s.covers));
    })
    .catch(() => ($('#profile-stats', root).hidden = true));

  // ---- Фото: натиснути на нього або перетягнути картинку на шапку ----
  const heroBox = $('#profile-hero', root);
  bindDropZone(heroBox, {
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    maxBytes: AVATAR_MAX_BYTES,
    typeError: t('Цей формат не підтримується. Вибери картинку PNG, JPG або WEBP'),
    onFile: async (file) => {
      state.user = (await upload('/api/me/avatar', file)).user;
      await refreshMe().catch(() => {});
      toast(t('Фото профілю оновлено'));
      reload();
    },
  });
  $('#avatar-remove', root)?.addEventListener('click', async () => {
    try {
      state.user = (await del('/api/me/avatar')).user;
      await refreshMe().catch(() => {});
      toast(t('Фото видалено'));
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#logout', root).addEventListener('click', async () => {
    // Пуші цього пристрою прив'язані до акаунта — після виходу вони не мають приходити сюди
    await disablePush().catch(() => {});
    await post('/api/auth/logout').catch(() => {});
    await clearPrivateCache();
    state.user = null;
    await refreshMe().catch(() => {});
    go('#/login');
  });

  // ---- Особисті дані й мова ----
  const form = $('#profile-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const { user } = await patch('/api/me', { name: form.elements.name.value });
        state.user = user;
        await refreshMe();
        $('.profile-name h1', root).textContent = user.name;
        toast(t('Збережено'));
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
  root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => switchLang(b.dataset.lang)));

  bindAccount(root);

  // ---- Сповіщення ----
  const toggle = (input, field, message) =>
    input?.addEventListener('change', async () => {
      try {
        const { user } = await patch('/api/me', { [field]: input.checked });
        state.user = user;
        toast(message(user));
      } catch (err) {
        input.checked = !input.checked;
        toast(err.message, 'error');
      }
    });
  toggle($('#p-notify-email', root), 'notifyEmail', (user) => (user.notifyEmail ? t('Листи про знижки увімкнено') : t('Листи про знижки вимкнено')));
  toggle($('#p-epic', root), 'notifyEpicFree', (user) => (user.notifyEpicFree ? t('Повідомлятимемо про нові роздачі') : t('Сповіщення про роздачі вимкнено')));
  toggle($('#p-digest', root), 'notifyDigest', (user) => (user.notifyDigest ? t('Дайджест приходитиме щонеділі') : t('Тижневий дайджест вимкнено')));

  $('#p-resend', root)?.addEventListener('click', (e) =>
    withLoading(e.currentTarget, async () => {
      try {
        await post('/api/auth/verify/resend');
        toast(state.app.mail === 'outbox' ? t('Лист у тестовій скриньці (адмін-панель)') : t('Лист надіслано — перевір пошту'));
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );

  mountPushChannel(root);

  $('#tg-test', root)?.addEventListener('click', (e) =>
    withLoading(e.currentTarget, async () => {
      try {
        await post('/api/me/telegram/test');
        toast(t('Повідомлення надіслано, перевір Telegram'));
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );

  $('#tg-unlink', root)?.addEventListener('click', async () => {
    try {
      await post('/api/me/telegram/unlink');
      toast(t('Telegram відключено'));
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#tg-link', root)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await withLoading(btn, async () => {
      try {
        const { code, url } = await post('/api/me/telegram/link');
        const command = `/start ${code}`;
        btn.hidden = true;
        setHtml(
          $('#tg-link-box', root),
          html`
            <div class="tg-connect">
              ${url
                ? html`<img class="tg-qr" src="/api/qr.svg?text=${encodeURIComponent(url)}" alt="${t('QR-код для відкриття бота')}" width="132" height="132" />`
                : ''}
              <div class="stack">
                ${url ? html`<div><a class="btn btn-primary" href="${url}" target="_blank" rel="noopener noreferrer">${t('Відкрити бота в Telegram')}</a></div>
                  <p class="hint">${t('Або відскануй код телефоном — бот відкриється в Telegram на телефоні.')}</p>` : ''}
                <p class="hint">${t('Натисни «Start» у боті. Якщо кнопка не відкрилась, надішли боту цю команду:')}</p>
                <div class="tg-code"><span id="tg-command">${command}</span>
                  <button class="btn btn-sm" type="button" id="tg-copy">${t('Копіювати')}</button></div>
                <p class="hint" id="tg-wait"><span class="dot-pulse" aria-hidden="true"></span> ${t('Чекаємо підтвердження від бота…')}</p>
              </div>
            </div>
          `
        );
        $('#tg-copy', root).addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(command);
            toast(t('Скопійовано'));
          } catch {
            const range = document.createRange();
            range.selectNodeContents($('#tg-command', root));
            getSelection().removeAllRanges();
            getSelection().addRange(range);
          }
        });

        const started = Date.now();
        poll = setInterval(async () => {
          if (Date.now() - started > 10 * 60 * 1000) {
            clearInterval(poll);
            const wait = $('#tg-wait', root);
            if (wait) wait.textContent = t('Код діє, але ми перестали чекати. Онови сторінку після того, як надішлеш команду боту.');
            return;
          }
          try {
            const me = await get('/api/me');
            if (me.user?.telegramLinked) {
              clearInterval(poll);
              toast(t('Telegram підключено!'));
              reload();
            }
          } catch {
            // спробуємо ще
          }
        }, 3000);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  return () => clearInterval(poll);
}
