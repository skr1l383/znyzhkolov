// Сторінки входу та реєстрації.
import { post } from '../api.js';
import { go, refreshMe } from '../app.js';
import { $, clearFormErrors, html, setHtml, showFormError, withLoading } from '../ui.js';

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

function bindForm(root, url, fields) {
  const form = $('form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const data = Object.fromEntries(fields.map((f) => [f, form.elements[f].value]));
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        await post(url, data);
        await refreshMe();
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
  bindForm(root, '/api/auth/register', ['name', 'email', 'password']);
}
