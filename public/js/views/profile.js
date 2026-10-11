// Профіль: ім'я, підключення Telegram, налаштування сповіщень, вихід.
import { get, patch, post } from '../api.js';
import { go, refreshMe, reload, state } from '../app.js';
import { $, clearFormErrors, formatDate, html, setHtml, showFormError, toast, withLoading } from '../ui.js';

function telegramPanel() {
  const tg = state.app.telegram;
  const u = state.user;
  if (!tg.enabled) {
    return html`
      <p class="muted">Telegram-бот ще не налаштований на цьому сервері.</p>
      <p class="hint">Адміністратору потрібно створити бота через @BotFather і вписати токен у файл .env (TELEGRAM_BOT_TOKEN). Покрокова інструкція є в README.</p>
    `;
  }
  if (u.telegramLinked) {
    return html`
      <div class="row"><span class="pill pill-good">Підключено</span>${u.telegramUsername ? html`<span class="muted">@${u.telegramUsername}</span>` : ''}</div>
      <p class="muted">Сповіщення про знижки та роздачі приходять у Telegram. У боті працюють команди /list і /free.</p>
      <div class="row">
        <button class="btn" type="button" id="tg-test">Надіслати тестове повідомлення</button>
        <button class="btn btn-ghost btn-danger" type="button" id="tg-unlink">Відключити</button>
      </div>
    `;
  }
  return html`
    <p class="muted">Підключи Telegram, щоб отримувати сповіщення на телефон миттєво.</p>
    <div id="tg-link-box" class="stack">
      <button class="btn btn-primary" type="button" id="tg-link">Підключити Telegram</button>
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
          <h1>Профіль</h1>
          <p>Акаунт створено ${formatDate(u.createdAt)}</p>
        </div>
        <button class="btn" type="button" id="logout">Вийти з акаунта</button>
      </div>

      <div class="profile-grid">
        <form class="panel stack" id="profile-form" novalidate>
          <h2>Особисті дані</h2>
          <div class="form-error" role="alert" hidden></div>
          <div class="field">
            <label for="p-name">Ім'я</label>
            <input class="input" id="p-name" name="name" value="${u.name}" maxlength="40" required />
          </div>
          <div class="field">
            <label for="p-email">Електронна пошта</label>
            <input class="input" id="p-email" value="${u.email}" disabled />
          </div>
          <div class="row">
            <span class="pill ${u.role === 'admin' ? 'pill-accent' : ''}">${u.role === 'admin' ? 'Адміністратор' : 'Користувач'}</span>
          </div>
          <div><button class="btn btn-primary" type="submit">Зберегти</button></div>
        </form>

        <section class="panel stack">
          <h2>Telegram</h2>
          ${telegramPanel()}
        </section>

        <section class="panel stack">
          <h2>Сповіщення</h2>
          <label class="check">
            <input type="checkbox" id="p-epic" ${u.notifyEpicFree ? 'checked' : ''} />
            <span>Повідомляти про нові безкоштовні роздачі Epic Games</span>
          </label>
          <p class="hint">Про знижки на ігри зі списку повідомляємо завжди, коли виконується твоя умова.</p>
        </section>
      </div>
    `
  );

  $('#logout', root).addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
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
        toast('Збережено');
      } catch (err) {
        showFormError(form, err);
      }
    });
  });

  $('#p-epic', root).addEventListener('change', async (e) => {
    try {
      const { user } = await patch('/api/me', { notifyEpicFree: e.target.checked });
      state.user = user;
      toast('Налаштування збережено');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, 'error');
    }
  });

  $('#tg-test', root)?.addEventListener('click', (e) =>
    withLoading(e.currentTarget, async () => {
      try {
        await post('/api/me/telegram/test');
        toast('Повідомлення надіслано, перевір Telegram');
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );

  $('#tg-unlink', root)?.addEventListener('click', async () => {
    try {
      await post('/api/me/telegram/unlink');
      toast('Telegram відключено');
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
            ${url ? html`<a class="btn btn-primary" href="${url}" target="_blank" rel="noopener noreferrer">Відкрити бота в Telegram</a>` : ''}
            <p class="hint">Натисни «Start» у боті. Якщо кнопка не відкрилась, надішли боту цю команду:</p>
            <div class="tg-code"><span id="tg-command">${command}</span>
              <button class="btn btn-sm" type="button" id="tg-copy">Копіювати</button></div>
            <p class="hint" id="tg-wait">Чекаємо підтвердження від бота…</p>
          `
        );
        $('#tg-copy', root).addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(command);
            toast('Скопійовано');
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
            if (wait) wait.textContent = 'Код діє, але ми перестали чекати. Онови сторінку після того, як надішлеш команду боту.';
            return;
          }
          try {
            const me = await get('/api/me');
            if (me.user?.telegramLinked) {
              clearInterval(poll);
              toast('Telegram підключено!');
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
