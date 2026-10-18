// Панелі профілю «Пароль і пошта», «Мої дані», «Видалення акаунта» та їхня поведінка.
import { post } from '../api.js';
import { clearPrivateCache, go, refreshMe, state } from '../app.js';
import { $, clearFormErrors, closeDialog, html, openDialog, showFormError, toast, withLoading } from '../ui.js';

export function accountPanels(u) {
  return html`
    <section class="panel stack">
      <h2>Пароль</h2>
      <form class="stack" id="password-form" novalidate>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="pw-current">Поточний пароль</label>
          <input class="input" id="pw-current" name="current" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="pw-new">Новий пароль</label>
          <input class="input" id="pw-new" name="password" type="password" autocomplete="new-password" minlength="8" required />
          <span class="hint">Щонайменше 8 символів</span>
        </div>
        <div class="field">
          <label for="pw-repeat">Новий пароль ще раз</label>
          <input class="input" id="pw-repeat" name="repeat" type="password" autocomplete="new-password" required />
        </div>
        <div><button class="btn btn-primary" type="submit">Змінити пароль</button></div>
        <p class="hint">На інших пристроях буде виконано вихід.</p>
      </form>
    </section>

    <section class="panel stack">
      <h2>Пошта</h2>
      <form class="stack" id="email-form" novalidate>
        <p class="muted">Зараз: <b>${u.email}</b>${u.emailVerified ? html` <span class="pill pill-good">підтверджено</span>` : ''}</p>
        <div class="form-error" role="alert" hidden></div>
        <div class="field">
          <label for="em-new">Нова пошта</label>
          <input class="input" id="em-new" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="em-current">Поточний пароль</label>
          <input class="input" id="em-current" name="current" type="password" autocomplete="current-password" required />
        </div>
        <div><button class="btn btn-primary" type="submit">Змінити пошту</button></div>
        <p class="hint">На нову пошту прийде лист для підтвердження, на стару — попередження про зміну.</p>
      </form>
    </section>

    <section class="panel stack">
      <h2>Мої дані</h2>
      <p class="muted">
        Усе, що Знижколов знає про тебе: профіль, список ігор з умовами, сповіщення й активні входи — одним файлом JSON.
      </p>
      <div><a class="btn" href="/api/me/export.json" download>Завантажити мої дані</a></div>
      <p class="hint">Як ми зберігаємо й використовуємо дані — на сторінці <a href="#/privacy">«Конфіденційність»</a>.</p>
    </section>

    <section class="panel stack danger-zone">
      <h2>Видалення акаунта</h2>
      <p class="muted">
        Акаунт, список ігор, сповіщення й фото буде видалено назавжди. Відновити їх не вийде.
      </p>
      <div><button class="btn btn-ghost btn-danger" type="button" id="delete-account">Видалити акаунт</button></div>
    </section>
  `;
}

function deleteDialog() {
  const dialog = openDialog(html`
    <form class="dialog-body" novalidate>
      <h2>Видалити акаунт назавжди?</h2>
      <p class="muted">
        Буде видалено акаунт ${state.user.email}, усі ігри зі списку, сповіщення, фото профілю і посилання «Поділитися».
        Перед цим можна <a href="/api/me/export.json" download>завантажити свої дані</a>.
      </p>
      <div class="form-error" role="alert" hidden></div>
      <div class="field">
        <label for="del-current">Поточний пароль</label>
        <input class="input" id="del-current" name="current" type="password" autocomplete="current-password" required />
      </div>
      <label class="check">
        <input type="checkbox" name="sure" />
        <span>Розумію, що це назавжди</span>
      </label>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Скасувати</button>
        <button class="btn btn-danger solid" type="submit" disabled>Видалити акаунт</button>
      </div>
    </form>
  `);
  const form = $('form', dialog);
  const submit = $('button[type="submit"]', form);
  $('[data-close]', form).addEventListener('click', closeDialog);
  form.elements.sure.addEventListener('change', (e) => (submit.disabled = !e.target.checked));
  form.elements.current.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    await withLoading(submit, async () => {
      try {
        await post('/api/me/delete', { current: form.elements.current.value });
        closeDialog();
        await clearPrivateCache();
        state.user = null;
        await refreshMe().catch(() => {});
        toast('Акаунт видалено. Дякуємо, що були з нами!');
        go('#/');
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

export function bindAccount(root) {
  const pw = $('#password-form', root);
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(pw);
    if (pw.elements.password.value !== pw.elements.repeat.value) {
      showFormError(pw, { field: 'repeat', message: 'Паролі не збігаються' });
      return;
    }
    await withLoading($('button[type="submit"]', pw), async () => {
      try {
        await post('/api/me/password', { current: pw.elements.current.value, password: pw.elements.password.value });
        pw.reset();
        toast('Пароль змінено. На інших пристроях виконано вихід');
      } catch (err) {
        showFormError(pw, err);
      }
    });
  });

  const em = $('#email-form', root);
  em.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(em);
    await withLoading($('button[type="submit"]', em), async () => {
      try {
        const { user } = await post('/api/me/email', { email: em.elements.email.value, current: em.elements.current.value });
        state.user = user;
        await refreshMe();
        toast(`Пошту змінено на ${user.email}. Підтверди її — лист уже надіслано`);
        go('#/profile');
      } catch (err) {
        showFormError(em, err);
      }
    });
  });

  $('#delete-account', root).addEventListener('click', deleteDialog);
}
