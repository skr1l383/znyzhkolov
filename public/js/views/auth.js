// Сторінки входу та реєстрації.
import { post } from '../api.js';
import { t } from '../i18n.js';
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

function bindForm(root, url, fields, onDone) {
  const form = $('form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const data = Object.fromEntries(fields.map((f) => [f, form.elements[f].value]));
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const result = await post(url, data);
        await refreshMe();
        onDone?.(result);
        go('#/');
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
          <label for="login-email">${t('Електронна пошта')}</label>
          <input class="input" id="login-email" name="email" type="email" autocomplete="email" required />
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
          <label for="reg-name">${t("Ім'я")}</label>
          <input class="input" id="reg-name" name="name" autocomplete="nickname" maxlength="40" required />
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
  bindForm(root, '/api/auth/register', ['name', 'email', 'password'], ({ user }) =>
    toast(t('Ми надіслали лист на {email} — натисни в ньому «Підтвердити пошту»', { email: user.email }))
  );
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

export async function renderVerify(root, params) {
  setHtml(root, html`<div class="empty"><h2>${t('Підтверджуємо пошту…')}</h2></div>`);
  try {
    const { user } = await post('/api/auth/verify', { token: params.token });
    await refreshMe().catch(() => {});
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
