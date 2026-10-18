// Імпорт списку бажаного Steam: посилання на профіль → ігри з цінами і галочками → стежити за вибраними.
import { get, post } from '../api.js';
import { state } from '../app.js';
import { $, $$, clearFormErrors, closeDialog, formatDate, formatUah, html, openDialog, setHtml, showFormError, toast, withLoading } from '../ui.js';
import { plural } from './watchlist.js';

const CONDITIONS = [
  ['', 'будь-яка знижка'],
  ['30', 'знижка від 30%'],
  ['50', 'знижка від 50%'],
  ['75', 'знижка від 75%'],
];

function itemRow(item, index) {
  const price = item.comingSoon
    ? html`<span class="muted">ще не вийшла</span>`
    : item.price == null
      ? html`<span class="muted">ціни немає</span>`
      : html`${item.discount > 0 ? html`<span class="discount">−${item.discount}%</span> ` : ''}<b>${item.price === 0 ? 'Безкоштовно' : formatUah(item.price)}</b>`;
  return html`
    <label class="wish-row ${item.inList ? 'in-list' : ''}">
      <input type="checkbox" data-i="${index}" ${item.inList ? html`disabled` : html`checked`} />
      <img src="${item.imageUrl || ''}" alt="" loading="lazy" />
      <span class="wish-title">
        <b>${item.title}</b>
        ${item.inList
          ? html`<span class="hint">уже у твоєму списку</span>`
          : item.discount > 0 && item.discountEndsAt
            ? html`<span class="hint">знижка до ${formatDate(item.discountEndsAt)}</span>`
            : ''}
      </span>
      <span class="wish-price">${price}</span>
    </label>`;
}

export function steamImportDialog(onImported) {
  const dialog = openDialog(html`
    <form class="dialog-body" novalidate id="wish-step1">
      <div><p class="muted">Мій список</p><h2>Імпорт зі Steam</h2></div>
      <p class="muted">
        Встав посилання на свій профіль Steam — покажемо твій список бажаного з поточними цінами,
        і ти одним натисканням почнеш стежити за знижками на всі ці ігри.
      </p>
      <div class="form-error" role="alert" hidden></div>
      <div class="field">
        <label for="wish-profile">Профіль Steam</label>
        <input class="input" id="wish-profile" name="profile" placeholder="https://steamcommunity.com/id/твоє-ім’я"
          value="${state.user?.steamId ? `https://steamcommunity.com/profiles/${state.user.steamId}` : ''}" autocomplete="off" required />
        <span class="hint">
          Де взяти: у Steam натисни на своє ім’я → «Профіль» і скопіюй адресу сторінки.
          Список бажаного має бути відкритим: «Редагувати профіль» → «Приватність» → «Інформація про ігри: Відкрита».
        </span>
      </div>
      <div id="wish-help" aria-live="polite"></div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Скасувати</button>
        <button class="btn btn-primary" type="submit">Показати список</button>
      </div>
    </form>
  `);
  $('[data-close]', dialog).addEventListener('click', closeDialog);
  const form = $('#wish-step1', dialog);
  form.elements.profile.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const data = await get(`/api/steam/wishlist?profile=${encodeURIComponent(form.elements.profile.value.trim())}`);
        if (state.user) state.user.steamId = data.profile.steamId;
        showList(dialog, data, onImported);
      } catch (err) {
        if (err.details?.code !== 'wishlist_hidden') {
          setHtml($('#wish-help', form), '');
          showFormError(form, err);
          return;
        }
        // Steam однаково відповідає і на порожній, і на прихований список — підказуємо, що перевірити
        clearFormErrors(form);
        setHtml(
          $('#wish-help', form),
          html`<div class="wish-help">
            <strong>${err.message}</strong>
            <ol>
              <li>
                Відкрий <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener noreferrer">налаштування приватності Steam</a>
                (там треба бути в акаунті Steam).
              </li>
              <li>
                ${err.details.profilePublic ? html`«Мій профіль» уже відкритий ✓. ` : html`«Мій профіль» → <b>Відкритий</b>. `}
                Нижче <b>«Інформація про ігри»</b> (англійською Game details) → <b>Відкрита</b>. Саме цей пункт відкриває список бажаного.
              </li>
              <li>Перевір, що у твоєму <a href="https://store.steampowered.com/wishlist/" target="_blank" rel="noopener noreferrer">списку бажаного</a> справді є ігри.</li>
              <li>Steam застосовує зміни приватності не одразу — зачекай 2–5 хвилин і натисни «Показати список» ще раз.</li>
            </ol>
          </div>`
        );
      }
    });
  });
}

function showList(dialog, data, onImported) {
  const { profile, items, total } = data;
  const available = items.filter((i) => !i.inList);
  setHtml(
    dialog,
    html`
      <div class="dialog-body">
        <div class="wish-profile">
          ${profile.avatar ? html`<img src="${profile.avatar}" alt="" />` : ''}
          <div>
            <p class="muted">Список бажаного Steam</p>
            <h2>${profile.name}</h2>
            <p class="hint">
              ${total} ${plural(total, 'гра', 'гри', 'ігор')}${total > items.length ? `, показано ${items.length}` : ''}
              · зі знижкою зараз: ${items.filter((i) => i.discount > 0).length}
            </p>
          </div>
        </div>
        <div class="wish-tools">
          <label class="check"><input type="checkbox" id="wish-all" ${available.length ? 'checked' : 'disabled'} /><span>Вибрати всі</span></label>
          <label class="wish-cond">Сповістити, коли
            <select class="select" id="wish-cond">
              ${CONDITIONS.map(([v, label]) => html`<option value="${v}" ${v === '50' ? 'selected' : ''}>${label}</option>`)}
            </select>
          </label>
        </div>
        <div class="wish-list">${items.map(itemRow)}</div>
        <div class="dialog-foot">
          <button class="btn" type="button" data-close>Скасувати</button>
          <button class="btn btn-primary" type="button" id="wish-import"></button>
        </div>
      </div>
    `
  );
  $('[data-close]', dialog).addEventListener('click', closeDialog);
  const boxes = () => $$('.wish-list input[data-i]:not(:disabled)', dialog);
  const importBtn = $('#wish-import', dialog);
  const update = () => {
    const n = boxes().filter((b) => b.checked).length;
    importBtn.textContent = n ? `Стежити за ${n} ${plural(n, 'грою', 'іграми', 'іграми')}` : 'Вибери ігри';
    importBtn.disabled = !n;
    const all = $('#wish-all', dialog);
    all.checked = n === boxes().length && n > 0;
    all.indeterminate = n > 0 && n < boxes().length;
  };
  $('#wish-all', dialog).addEventListener('change', (e) => {
    boxes().forEach((b) => (b.checked = e.target.checked));
    update();
  });
  $('.wish-list', dialog).addEventListener('change', update);
  update();

  importBtn.addEventListener('click', () =>
    withLoading(importBtn, async () => {
      const appids = boxes()
        .filter((b) => b.checked)
        .map((b) => items[Number(b.dataset.i)].storeId);
      try {
        const result = await post('/api/steam/wishlist/import', { appids, minDiscount: $('#wish-cond', dialog).value || null });
        setHtml(
          dialog,
          html`<div class="dialog-body">
            <h2>Готово!</h2>
            <p>Тепер ти стежиш за <b>${result.added.length}</b> ${plural(result.added.length, 'грою', 'іграми', 'іграми')} зі свого списку бажаного.</p>
            ${result.skipped.length ? html`<p class="muted">Пропущено: ${result.skipped.map((s) => `${s.title} (${s.reason})`).join(', ')}.</p>` : ''}
            <p class="hint">Ці ж ігри в GOG шукаємо у фоні — за кілька хвилин у списку з’являться й ціни GOG для порівняння.</p>
            <div class="dialog-foot"><button class="btn btn-primary" type="button" data-close>До мого списку</button></div>
          </div>`
        );
        $('[data-close]', dialog).addEventListener('click', closeDialog);
        if (result.added.length) onImported();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}
