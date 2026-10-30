// Сторінки входу та реєстрації.
import { post } from '../api.js';
import { getLang, t } from '../i18n.js';
import { go, refreshMe, state } from '../app.js';
import { $, clearFormErrors, html, setHtml, showFormError, toast, withLoading } from '../ui.js';

// Функція, а не константа: текст має бути мовою, вибраною на момент показу
const pitch = () => html`
  <section class="auth-pitch">
    <h1>${t('Знижки на ігри')} <em>${t('самі тебе знайдуть')}</em></h1>
    <p>
      ${t('Додай ігри, які хочеш купити, і вкажи свою умову: знижка від 50% або ціна до 300 ₴. Знижколов перевіряє Steam і GOG, стежить за безкоштовними роздачами Epic Games і пише в Telegram, щойно умова виконається.')}
    </p>
    <div class="sample game-card met" aria-label="${t('Приклад картки гри')}">
      <div class="prices">
        <div class="checked-at">${t('Приклад · Hollow Knight · умова «знижка від 40%»')}</div>
        <div class="price-row">
          <span class="store store-steam">Steam</span>
          <span class="price-values"><span class="price">279 ₴</span></span>
        </div>
        <div class="price-row best">
          <span class="store store-gog">GOG</span>
          <span class="price-values"
            ><span class="price-old">621 ₴</span><span class="discount">−50%</span><span class="price">311 ₴</span></span
          >
          <span class="price-note"><span class="best-label">${t('Найдешевше')}</span> · ${t('сповіщення вже в Telegram')}</span>
        </div>
      </div>
    </div>
  </section>
`;

/** extra — дані, яких немає серед полів форми (наприклад, мова сайту). */
function bindForm(root, url, fields, onDone, extra = {}) {
  const form = $('form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const data = Object.fromEntries(fields.map((f) => [f, form.elements[f].value]));
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const result = await post(url, { ...data, ...extra });
        await refreshMe();
        // onDone може повернути адресу, куди перейти далі (після реєстрації — «Перевір пошту»)
        go(onDone?.(result) || '#/');
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
  form.elements[fields[0]].focus();
}

export function renderLogin(root) {
  setHtml(
    root,
    html`<div class="auth">
      ${pitch()}
      <form class="auth-form" novalidate>
        <h2>${t('Вхід')}</h2>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="login-email">${t('Пошта або нік')}</label>
          <input class="input" id="login-email" name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="login-password">${t('Пароль')}</label>
          <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">${t('Увійти')}</button>
        <p class="auth-switch"><a href="#/forgot">${t('Забули пароль?')}</a></p>
        <p class="auth-switch">${t('Ще немає акаунта?')} <a href="#/register">${t('Зареєструватися')}</a></p>
      </form>
    </div>`
  );
  bindForm(root, '/api/auth/login', ['email', 'password']);
}

export function renderRegister(root) {
  setHtml(
    root,
    html`<div class="auth">
      ${pitch()}
      <form class="auth-form" novalidate>
        <h2>${t('Реєстрація')}</h2>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="reg-name">${t('Нік')}</label>
          <input class="input" id="reg-name" name="name" autocomplete="nickname" maxlength="40" required />
          <p class="hint">${t('Твоє ім’я на сайті. Ним, як і поштою, можна входити')}</p>
        </div>
        <div class="field">
          <label for="reg-email">${t('Електронна пошта')}</label>
          <input class="input" id="reg-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="reg-password">${t('Пароль')}</label>
          <input class="input" id="reg-password" name="password" type="password" autocomplete="new-password" minlength="8" required />
          <span class="hint">${t('Щонайменше 8 символів')}</span>
        </div>
        <button class="btn btn-primary" type="submit">${t('Створити акаунт')}</button>
        <p class="hint">${t('Створюючи акаунт, ти погоджуєшся з тим, як ми працюємо з даними:')} <a href="#/privacy">${t('конфіденційність')}</a>.</p>
        <p class="auth-switch">${t('Уже є акаунт?')} <a href="#/login">${t('Увійти')}</a></p>
      </form>
    </div>`
  );
  bindForm(root, '/api/auth/register', ['name', 'email', 'password'], () => '#/check-email', { lang: getLang() });
}

// ---------- Відновлення пароля і підтвердження пошти ----------

export function renderForgot(root) {
  setHtml(
    root,
    html`<div class="auth auth-narrow">
      <form class="auth-form" novalidate>
        <h2>${t('Відновлення пароля')}</h2>
        <p class="muted">${t('Впиши пошту, з якою реєструвався, — надішлемо лист із посиланням для зміни пароля.')}</p>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="forgot-email">${t('Електронна пошта')}</label>
          <input class="input" id="forgot-email" name="email" type="email" autocomplete="email" required />
        </div>
        <button class="btn btn-primary" type="submit">${t('Надіслати лист')}</button>
        <p class="auth-switch"><a href="#/login">${t('Повернутися до входу')}</a></p>
      </form>
    </div>`
  );
  const form = $('form', root);
  form.elements.email.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const { message } = await post('/api/auth/forgot', { email: form.elements.email.value });
        setHtml(
          form,
          html`<h2>${t('Перевір пошту')}</h2>
            <p>${t(message)}</p>
            ${state.app.mail === 'outbox'
              ? html`<p class="hint">${t('Поштовий сервіс ще не налаштовано: лист лежить у тестовій скриньці в адмін-панелі.')}</p>`
              : ''}
            <p class="auth-switch"><a href="#/login">${t('Повернутися до входу')}</a></p>`
        );
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

export function renderReset(root, params) {
  setHtml(
    root,
    html`<div class="auth auth-narrow">
      <form class="auth-form" novalidate>
        <h2>${t('Новий пароль')}</h2>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="reset-password">${t('Новий пароль')}</label>
          <input class="input" id="reset-password" name="password" type="password" autocomplete="new-password" minlength="8" required />
          <span class="hint">${t('Щонайменше 8 символів')}</span>
        </div>
        <div class="field">
          <label for="reset-repeat">${t('Ще раз')}</label>
          <input class="input" id="reset-repeat" name="repeat" type="password" autocomplete="new-password" required />
        </div>
        <button class="btn btn-primary" type="submit">${t('Зберегти пароль')}</button>
        <p class="hint">${t('Після зміни пароля всі інші пристрої вийдуть з акаунта.')}</p>
      </form>
    </div>`
  );
  const form = $('form', root);
  form.elements.password.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    if (form.elements.password.value !== form.elements.repeat.value) {
      showFormError(form, { field: 'repeat', message: t('Паролі не збігаються') });
      return;
    }
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        await post('/api/auth/reset', { token: params.token, password: form.elements.password.value });
        await refreshMe();
        toast(t('Пароль змінено — ти вже увійшов'));
        go('#/');
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

// Пошти, для яких можна одразу відкрити скриньку в браузері
const WEBMAIL = {
  'gmail.com': ['Gmail', 'https://mail.google.com/'],
  'googlemail.com': ['Gmail', 'https://mail.google.com/'],
  'ukr.net': ['ukr.net', 'https://mail.ukr.net/'],
  'outlook.com': ['Outlook', 'https://outlook.live.com/mail/'],
  'hotmail.com': ['Outlook', 'https://outlook.live.com/mail/'],
  'live.com': ['Outlook', 'https://outlook.live.com/mail/'],
  'yahoo.com': ['Yahoo', 'https://mail.yahoo.com/'],
  'icloud.com': ['iCloud', 'https://www.icloud.com/mail'],
  'proton.me': ['Proton', 'https://mail.proton.me/'],
};

/** Повідомляє інші вкладки сайту, що пошту підтверджено, — вони одразу ховають нагадування. */
function announceVerified() {
  try {
    new BroadcastChannel('zk-account').postMessage('verified');
  } catch {
    // старий браузер — інші вкладки дізнаються, коли на них повернешся
  }
}

/** Екран після реєстрації: куди пішов лист, що робити далі, і живе очікування підтвердження. */
export function renderCheckEmail(root) {
  if (!state.user) return go('#/login');
  if (state.user.emailVerified) return go('#/');
  const email = state.user.email;
  const webmail = WEBMAIL[email.split('@')[1]?.toLowerCase()];
  const outbox = state.app.mail === 'outbox';
  setHtml(
    root,
    html`<section class="check-email">
      <div class="check-email-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
      </div>
      <h1>${t('Перевір пошту')}</h1>
      <p class="check-email-lead">${t('Ми надіслали лист на')} <b>${email}</b>.<br />${t('Натисни в ньому «Підтвердити пошту» — і зможеш отримувати сповіщення про знижки на пошту.')}</p>
      ${outbox
        ? html`<p class="hint">${t('Сайт працює без поштового сервісу: лист лежить у тестовій скриньці адмін-панелі.')}</p>`
        : html`<p class="hint">${t('Не бачиш листа за хвилину? Глянь у папки «Спам» і «Промоакції».')}</p>`}
      <div class="check-email-actions">
        ${webmail && !outbox
          ? html`<a class="btn btn-primary" href="${webmail[1]}" target="_blank" rel="noopener noreferrer">${t('Відкрити {mail}', { mail: webmail[0] })}</a>`
          : ''}
        <button class="btn" type="button" id="check-resend">${t('Надіслати ще раз')}</button>
        <a class="btn btn-ghost" href="#/">${t('Пізніше — на сайт')}</a>
      </div>
      <p class="check-email-wait" role="status"><span class="spinner" aria-hidden="true"></span>${t('Чекаємо на підтвердження — ця сторінка оновиться сама')}</p>
    </section>`
  );

  $('#check-resend', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await post('/api/auth/verify/resend');
      toast(outbox ? t('Лист у тестовій скриньці (адмін-панель)') : t('Лист надіслано — перевір пошту і папку «Спам»'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTimeout(() => (btn.disabled = false), 3000);
    }
  });

  // Щойно пошту підтверджено (у цій чи іншій вкладці) — показуємо це і пропонуємо, що робити далі
  const onVerified = () => {
    if (!root.isConnected || !state.user?.emailVerified) return;
    setHtml(
      root,
      html`<section class="check-email">
        <div class="check-email-icon ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></div>
        <h1>${t('Пошту підтверджено ✓')}</h1>
        <p class="check-email-lead">${t('Тепер сповіщення про знижки приходитимуть і на пошту.')}</p>
        <div class="check-email-actions"><a class="btn btn-primary" href="#/search">${t('Знайти першу гру')}</a><a class="btn" href="#/">${t('На вітрину')}</a></div>
      </section>`
    );
  };
  window.addEventListener('zk:verified', onVerified);
  return () => window.removeEventListener('zk:verified', onVerified);
}

export async function renderVerify(root, params) {
  setHtml(root, html`<div class="empty"><h2>${t('Підтверджуємо пошту…')}</h2></div>`);
  try {
    const { user } = await post('/api/auth/verify', { token: params.token });
    await refreshMe().catch(() => {});
    announceVerified();
    setHtml(
      root,
      html`<div class="empty">
        <h2>${t('Пошту підтверджено ✓')}</h2>
        <p>${t('{email} — тепер ми можемо надсилати тобі сповіщення про знижки й допомогти з паролем.', { email: user.email })}</p>
        <a class="btn btn-primary" href="${state.user ? '#/list' : '#/login'}">${state.user ? t('До мого списку') : t('Увійти')}</a>
      </div>`
    );
  } catch (err) {
    setHtml(
      root,
      html`<div class="empty">
        <h2>${t('Не вдалося підтвердити пошту')}</h2>
        <p>${err.message}</p>
        <a class="btn" href="${state.user ? '#/profile' : '#/login'}">${state.user ? t('До профілю') : t('Увійти')}</a>
      </div>`
    );
  }
}
