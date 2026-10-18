// Сторінки входу та реєстрації.
import { post } from '../api.js';
import { go, refreshMe, state } from '../app.js';
import { $, clearFormErrors, html, setHtml, showFormError, toast, withLoading } from '../ui.js';

const pitch = html`
  <section class="auth-pitch">
    <h1>Знижки на ігри <em>самі тебе знайдуть</em></h1>
    <p>
      Додай ігри, які хочеш купити, і вкажи свою умову: знижка від 50% або ціна до 300 ₴. Знижколов
      перевіряє Steam і GOG, стежить за безкоштовними роздачами Epic Games і пише в Telegram, щойно умова
      виконається.
    </p>
    <div class="sample game-card met" aria-label="Приклад картки гри">
      <div class="prices">
        <div class="checked-at">Приклад · Hollow Knight · умова «знижка від 40%»</div>
        <div class="price-row">
          <span class="store store-steam">Steam</span>
          <span class="price-values"><span class="price">279 ₴</span></span>
        </div>
        <div class="price-row best">
          <span class="store store-gog">GOG</span>
          <span class="price-values"
            ><span class="price-old">621 ₴</span><span class="discount">−50%</span><span class="price">311 ₴</span></span
          >
          <span class="price-note"><span class="best-label">Найдешевше</span> · сповіщення вже в Telegram</span>
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
      ${pitch}
      <form class="auth-form" novalidate>
        <h2>Вхід</h2>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="login-email">Електронна пошта</label>
          <input class="input" id="login-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="login-password">Пароль</label>
          <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">Увійти</button>
        <p class="auth-switch"><a href="#/forgot">Забули пароль?</a></p>
        <p class="auth-switch">Ще немає акаунта? <a href="#/register">Зареєструватися</a></p>
      </form>
    </div>`
  );
  bindForm(root, '/api/auth/login', ['email', 'password']);
}

export function renderRegister(root) {
  setHtml(
    root,
    html`<div class="auth">
      ${pitch}
      <form class="auth-form" novalidate>
        <h2>Реєстрація</h2>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="reg-name">Ім'я</label>
          <input class="input" id="reg-name" name="name" autocomplete="nickname" maxlength="40" required />
        </div>
        <div class="field">
          <label for="reg-email">Електронна пошта</label>
          <input class="input" id="reg-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="reg-password">Пароль</label>
          <input class="input" id="reg-password" name="password" type="password" autocomplete="new-password" minlength="8" required />
          <span class="hint">Щонайменше 8 символів</span>
        </div>
        <button class="btn btn-primary" type="submit">Створити акаунт</button>
        <p class="auth-switch">Уже є акаунт? <a href="#/login">Увійти</a></p>
      </form>
    </div>`
  );
  bindForm(root, '/api/auth/register', ['name', 'email', 'password'], ({ user }) =>
    toast(`Ми надіслали лист на ${user.email} — натисни в ньому «Підтвердити пошту»`)
  );
}

// ---------- Відновлення пароля і підтвердження пошти ----------

export function renderForgot(root) {
  setHtml(
    root,
    html`<div class="auth auth-narrow">
      <form class="auth-form" novalidate>
        <h2>Відновлення пароля</h2>
        <p class="muted">Впиши пошту, з якою реєструвався, — надішлемо лист із посиланням для зміни пароля.</p>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="forgot-email">Електронна пошта</label>
          <input class="input" id="forgot-email" name="email" type="email" autocomplete="email" required />
        </div>
        <button class="btn btn-primary" type="submit">Надіслати лист</button>
        <p class="auth-switch"><a href="#/login">Повернутися до входу</a></p>
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
          html`<h2>Перевір пошту</h2>
            <p>${message}</p>
            ${state.app.mail === 'outbox'
              ? html`<p class="hint">Поштовий сервіс ще не налаштовано: лист лежить у тестовій скриньці в адмін-панелі.</p>`
              : ''}
            <p class="auth-switch"><a href="#/login">Повернутися до входу</a></p>`
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
        <h2>Новий пароль</h2>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="reset-password">Новий пароль</label>
          <input class="input" id="reset-password" name="password" type="password" autocomplete="new-password" minlength="8" required />
          <span class="hint">Щонайменше 8 символів</span>
        </div>
        <div class="field">
          <label for="reset-repeat">Ще раз</label>
          <input class="input" id="reset-repeat" name="repeat" type="password" autocomplete="new-password" required />
        </div>
        <button class="btn btn-primary" type="submit">Зберегти пароль</button>
        <p class="hint">Після зміни пароля всі інші пристрої вийдуть з акаунта.</p>
      </form>
    </div>`
  );
  const form = $('form', root);
  form.elements.password.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    if (form.elements.password.value !== form.elements.repeat.value) {
      showFormError(form, { field: 'repeat', message: 'Паролі не збігаються' });
      return;
    }
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        await post('/api/auth/reset', { token: params.token, password: form.elements.password.value });
        await refreshMe();
        toast('Пароль змінено — ти вже увійшов');
        go('#/');
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

export async function renderVerify(root, params) {
  setHtml(root, html`<div class="empty"><h2>Підтверджуємо пошту…</h2></div>`);
  try {
    const { user } = await post('/api/auth/verify', { token: params.token });
    await refreshMe().catch(() => {});
    setHtml(
      root,
      html`<div class="empty">
        <h2>Пошту підтверджено ✓</h2>
        <p>${user.email} — тепер ми можемо надсилати тобі сповіщення про знижки й допомогти з паролем.</p>
        <a class="btn btn-primary" href="${state.user ? '#/list' : '#/login'}">${state.user ? 'До мого списку' : 'Увійти'}</a>
      </div>`
    );
  } catch (err) {
    setHtml(
      root,
      html`<div class="empty">
        <h2>Не вдалося підтвердити пошту</h2>
        <p>${err.message}</p>
        <a class="btn" href="${state.user ? '#/profile' : '#/login'}">${state.user ? 'До профілю' : 'Увійти'}</a>
      </div>`
    );
  }
}
