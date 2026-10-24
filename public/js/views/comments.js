// Коментарі на сторінці гри: список, форма для тих, хто увійшов, видалення свого коментаря
// (адміністратор може видалити будь-який).
import { del, get, post } from '../api.js';
import { t, tp } from '../i18n.js';
import { state } from '../app.js';
import { $, avatar, clearFormErrors, confirmDialog, html, setHtml, showFormError, timeAgo, toast, withLoading } from '../ui.js';

const MAX_LENGTH = 1000; // те саме обмеження, що й на сервері

function comment(c) {
  return html`
    <article class="comment" data-id="${c.id}">
      <span class="avatar comment-avatar">${avatar({ name: c.author.name, avatarUrl: c.author.avatarUrl })}</span>
      <div class="comment-body">
        <div class="comment-head">
          <b>${c.author.name}</b>
          ${c.author.isAdmin ? html`<span class="pill pill-accent">${t('адмін')}</span>` : ''}
          ${c.mine ? html`<span class="pill">${t('ти')}</span>` : ''}
          <time class="hint" datetime="${c.createdAt}">${timeAgo(c.createdAt)}</time>
          ${c.canDelete
            ? html`<button class="btn btn-ghost btn-sm btn-danger comment-delete" type="button" data-delete="${c.id}">${t('Видалити')}</button>`
            : ''}
        </div>
        <p class="comment-text">${c.text}</p>
      </div>
    </article>
  `;
}

export function commentsSection() {
  return html`
    <section class="game-comments" id="comments" aria-labelledby="comments-title">
      <div class="section-title"><h2 id="comments-title">${t('Коментарі')}</h2><span class="count" id="comments-count"></span></div>
      ${state.user
        ? html`<form class="comment-form" id="comment-form" novalidate>
            <span class="avatar comment-avatar">${avatar(state.user)}</span>
            <div class="stack">
              <div class="form-error" role="alert" hidden></div>
              <div class="field">
                <label class="visually-hidden" for="comment-text">${t('Твій коментар')}</label>
                <textarea class="input" id="comment-text" name="text" rows="3" maxlength="${MAX_LENGTH}" required
                  placeholder="${t('Поділися думкою: чи варта гра своїх грошей, на якій знижці її брати…')}"></textarea>
              </div>
              <div class="comment-form-foot">
                <span class="hint" id="comment-left">0 / ${MAX_LENGTH}</span>
                <button class="btn btn-primary btn-sm" type="submit">${t('Надіслати')}</button>
              </div>
            </div>
          </form>`
        : html`<div class="comment-guest">
            <p class="muted">${t('Щоб написати коментар, увійди в акаунт.')}</p>
            <a class="btn btn-sm" href="#/login">${t('Увійти')}</a>
          </div>`}
      <div class="comments" id="comments-list" aria-live="polite"><div class="skeleton" style="height: 72px"></div></div>
    </section>
  `;
}

/** Завантажує коментарі гри і підключає форму. store/storeId — головна пропозиція сторінки гри. */
export async function mountComments(root, { store, storeId }) {
  const url = `/api/games/${encodeURIComponent(store)}/${encodeURIComponent(storeId)}/comments`;
  const list = $('#comments-list', root);
  let items = [];
  let total = 0;

  const draw = () => {
    $('#comments-count', root).textContent = total ? `${total} ${tp(total, 'коментар', 'коментарі', 'коментарів')}` : '';
    setHtml(list, items.length ? html`${items.map(comment)}` : html`<p class="muted comments-empty">${t('Коментарів ще немає — будь першим.')}</p>`);
  };

  try {
    ({ items, total } = await get(url));
    draw();
  } catch (err) {
    setHtml(list, html`<p class="form-error">${err.message}</p>`);
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const c = items.find((x) => x.id === Number(btn.dataset.delete));
    const ok = await confirmDialog({
      title: t('Видалити коментар?'),
      text: c.mine ? t('Коментар зникне назавжди.') : t('Коментар користувача {name} зникне назавжди.', { name: c.author.name }),
      confirmText: t('Видалити'),
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/api/comments/${c.id}`);
      items = items.filter((x) => x.id !== c.id);
      total -= 1;
      draw();
      toast(t('Коментар видалено'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const form = $('#comment-form', root);
  if (!form) return;
  const text = form.elements.text;
  const left = $('#comment-left', root);
  text.addEventListener('input', () => {
    left.textContent = `${text.value.length} / ${MAX_LENGTH}`;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const { comment: added } = await post(url, { text: text.value });
        items = [added, ...items];
        total += 1;
        draw();
        form.reset();
        left.textContent = `0 / ${MAX_LENGTH}`;
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}
