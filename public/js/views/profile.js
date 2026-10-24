// Профіль: ім'я, підключення Telegram, налаштування сповіщень, вихід.
import { del, get, patch, post, upload } from '../api.js';
import { t } from '../i18n.js';
import { clearPrivateCache, go, refreshMe, reload, state } from '../app.js';
import { accountPanels, bindAccount } from './account.js';
import {
  $,
  avatar,
  bindDropZone,
  clearFormErrors,
  dropZone,
  formatDate,
  formatSize,
  html,
  setHtml,
  showFormError,
  toast,
  withLoading,
} from '../ui.js';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // те саме обмеження, що й на сервері

function avatarPanel(u) {
  return html`
    <h2>${t('Фото профілю')}</h2>
    <div class="avatar-edit">
      <div class="avatar-big">${avatar(u)}</div>
      <div class="stack">
        ${dropZone({
          title: u.avatarUrl ? t('Замінити фото') : t('Завантажити фото'),
          hint: t('Перетягни картинку сюди або натисни, щоб вибрати. PNG, JPG або WEBP, до {size}', { size: formatSize(AVATAR_MAX_BYTES) }),
          accept: 'image/png,image/jpeg,image/webp',
        })}
        ${u.avatarUrl ? html`<div><button class="btn btn-sm btn-ghost btn-danger" type="button" id="avatar-remove">${t('Видалити фото')}</button></div>` : ''}
      </div>
    </div>
  `;
}

/** Малює блок фото і підключає до нього завантаження та видалення. */
function mountAvatar(box) {
  setHtml(box, avatarPanel(state.user));
  const updated = (user, message) => {
    state.user = user;
    refreshMe().catch(() => {});
    mountAvatar(box);
    toast(message);
  };
  bindDropZone($('.dropzone', box), {
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    maxBytes: AVATAR_MAX_BYTES,
    typeError: t('Цей формат не підтримується. Вибери картинку PNG, JPG або WEBP'),
    onFile: async (file) => updated((await upload('/api/me/avatar', file)).user, t('Фото профілю оновлено')),
  });
  $('#avatar-remove', box)?.addEventListener('click', async () => {
    try {
      updated((await del('/api/me/avatar')).user, t('Фото видалено'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function telegramPanel() {
  const tg = state.app.telegram;
  const u = state.user;
  if (!tg.enabled) {
    return html`
      <p class="muted">${t('Telegram-бот ще не налаштований на цьому сервері.')}</p>
      <p class="hint">${t('Адміністратору потрібно створити бота через @BotFather і вписати токен у файл .env (TELEGRAM_BOT_TOKEN). Покрокова інструкція є в README.')}</p>
    `;
  }
  if (u.telegramLinked) {
    return html`
      <div class="row"><span class="pill pill-good">${t('Підключено')}</span>${u.telegramUsername ? html`<span class="muted">@${u.telegramUsername}</span>` : ''}</div>
      <p class="muted">${t('Сповіщення про знижки та роздачі приходять у Telegram. У боті працюють команди /list і /free.')}</p>
      <div class="row">
        <button class="btn" type="button" id="tg-test">${t('Надіслати тестове повідомлення')}</button>
        <button class="btn btn-ghost btn-danger" type="button" id="tg-unlink">${t('Відключити')}</button>
      </div>
    `;
  }
  return html`
    <p class="muted">${t('Підключи Telegram, щоб отримувати сповіщення на телефон миттєво.')}</p>
    <div id="tg-link-box" class="stack">
      <button class="btn btn-primary" type="button" id="tg-link">${t('Підключити Telegram')}</button>
    </div>
  `;
}

export async function render(root) {
  await refreshMe();
  const u = state.user;
  let poll = null;

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>${t('Профіль')}</h1>
          <p>${t('Акаунт створено {date}', { date: formatDate(u.createdAt) })}</p>
        </div>
        <button class="btn" type="button" id="logout">${t('Вийти з акаунта')}</button>
      </div>

      <div class="profile-grid">
        <form class="panel stack" id="profile-form" novalidate>
          <h2>${t('Особисті дані')}</h2>
          <div class="form-error" role="alert" hidden></div>
          <div class="field">
            <label for="p-name">${t("Ім'я")}</label>
            <input class="input" id="p-name" name="name" value="${u.name}" maxlength="40" required />
          </div>
          <div class="field">
            <label for="p-email">${t('Електронна пошта')}</label>
            <input class="input" id="p-email" value="${u.email}" disabled />
          </div>
          <div class="row">
            <span class="pill ${u.role === 'admin' ? 'pill-accent' : ''}">${u.role === 'admin' ? t('Адміністратор') : t('Користувач')}</span>
          </div>
          <div><button class="btn btn-primary" type="submit">${t('Зберегти')}</button></div>
        </form>

        <section class="panel stack" id="avatar-box"></section>

        <section class="panel stack">
          <h2>${t('Telegram')}</h2>
          ${telegramPanel()}
        </section>

        <section class="panel stack">
          <h2>${t('Сповіщення')}</h2>
          <label class="check">
            <input type="checkbox" id="p-epic" ${u.notifyEpicFree ? 'checked' : ''} />
            <span>${t('Повідомляти про нові безкоштовні роздачі Epic Games')}</span>
          </label>
          <label class="check">
            <input type="checkbox" id="p-email" ${u.notifyEmail ? 'checked' : ''} ${u.emailVerified ? '' : 'disabled'} />
            <span>${t('Надсилати сповіщення про знижки й роздачі на пошту')}</span>
          </label>
          ${u.emailVerified
            ? html`<p class="hint"><span class="pill pill-good">${t('Пошту підтверджено')}</span> ${t('Листи приходять на {email}.', { email: u.email })}</p>`
            : html`<p class="hint">${t('Щоб отримувати листи, підтверди пошту {email}.', { email: u.email })}
                <button class="btn btn-sm" type="button" id="p-resend">${t('Надіслати лист ще раз')}</button></p>`}
          <p class="hint">${t('Про знижки на ігри зі списку повідомляємо на сайті завжди, коли виконується твоя умова.')}</p>
        </section>

        ${accountPanels(u)}
      </div>
    `
  );

  mountAvatar($('#avatar-box', root));
  bindAccount(root);

  $('#logout', root).addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
    await clearPrivateCache();
    state.user = null;
    await refreshMe().catch(() => {});
    go('#/login');
  });

  const form = $('#profile-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const { user } = await patch('/api/me', { name: form.elements.name.value });
        state.user = user;
        await refreshMe();
        toast(t('Збережено'));
      } catch (err) {
        showFormError(form, err);
      }
    });
  });

  $('#p-email', root).addEventListener('change', async (e) => {
    try {
      const { user } = await patch('/api/me', { notifyEmail: e.target.checked });
      state.user = user;
      toast(user.notifyEmail ? t('Листи про знижки увімкнено') : t('Листи про знижки вимкнено'));
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, 'error');
    }
  });
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

  $('#p-epic', root).addEventListener('change', async (e) => {
    try {
      const { user } = await patch('/api/me', { notifyEpicFree: e.target.checked });
      state.user = user;
      toast(t('Налаштування збережено'));
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, 'error');
    }
  });

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
        setHtml(
          $('#tg-link-box', root),
          html`
            ${url ? html`<a class="btn btn-primary" href="${url}" target="_blank" rel="noopener noreferrer">${t('Відкрити бота в Telegram')}</a>
              <div class="tg-qr"><img src="/api/qr.svg?text=${encodeURIComponent(url)}" alt="${t('QR-код для відкриття бота')}" width="140" height="140" />
                <p class="hint">${t('Або відскануй код телефоном — бот відкриється в Telegram на телефоні.')}</p></div>` : ''}
            <p class="hint">${t('Натисни «Start» у боті. Якщо кнопка не відкрилась, надішли боту цю команду:')}</p>
            <div class="tg-code"><span id="tg-command">${command}</span>
              <button class="btn btn-sm" type="button" id="tg-copy">${t('Копіювати')}</button></div>
            <p class="hint" id="tg-wait">${t('Чекаємо підтвердження від бота…')}</p>
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
